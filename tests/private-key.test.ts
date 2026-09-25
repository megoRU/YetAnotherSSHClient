import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as crypto from 'node:crypto'
import * as path from 'node:path'

vi.mock('../electron/src/config.js', () => ({
    loadConfig: (): { language: 'ru' } => ({ language: 'ru' })
}))

import {
    decryptSessionSecret,
    isEncryptedPrivateKeyContent,
    isEncryptedSecret,
    isSupportedOpenSSHPrivateKeyFormat,
    isSupportedPrivateKeyFormat,
    LocalizedError,
    PrivateKeyError,
    privateKeyErrorMessage,
    resolvePrivateKey,
    stripPlaintextPrivateKeys
} from '../electron/src/private-key.js'
import { VaultService, vault } from '../electron/src/vault.js'
import type { SSHConfig } from '../src/types.js'

// Реальный ed25519-ключ в формате OpenSSH (openssh-key-v1 контейнер) намеренно НЕ
// хранится в репозитории — для проверок собираем синтетический контейнер программно.

/** Собирает структуру openssh-key-v1: openssh-key-v1\\0 + string-поля заголовка + N ключей + приватный блок. */
function buildOpenSshContainer(options: {
    magic?: Buffer
    keyCount?: number
    trailing?: number
    includePrivateBlock?: boolean
    ciphername?: string
    /** Перезаписывает длину первого string-поля (для проверки повреждённых контейнеров). */
    cipherLength?: number
} = {}): string {
    const str = (value: string | Buffer): Buffer => {
        const b = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, 'utf8')
        const len = Buffer.alloc(4)
        len.writeUInt32BE(b.length)
        return Buffer.concat([len, b])
    }
    const keyCount = options.keyCount ?? 1
    const count = Buffer.alloc(4)
    count.writeUInt32BE(keyCount)

    const ciphername = options.ciphername ?? 'none'
    const cipherLength = Buffer.alloc(4)
    cipherLength.writeUInt32BE(options.cipherLength ?? Buffer.from(ciphername, 'utf8').length)

    const parts: Buffer[] = [
        options.magic ?? Buffer.from('openssh-key-v1\x00'),
        cipherLength,
        Buffer.from(ciphername, 'utf8'),
        str('none'),
        str(''),
        count
    ]
    for (let i = 0; i < keyCount; i++) {
        parts.push(str(`public-key-${i}`))
    }
    if (options.includePrivateBlock !== false) {
        parts.push(str('private-block'))
    }
    if (options.trailing) {
        parts.push(Buffer.alloc(options.trailing, 0x00))
    }

    const body = Buffer.concat(parts).toString('base64')
    return `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----`
}

/** Собирает PEM-подобную строку с синтетическим (не настоящим) телом ключа. */
function makePem(keyword: string, body: string, withFooter = true): string {
    const lines = [`-----BEGIN ${keyword} PRIVATE KEY-----`, body]
    if (withFooter) lines.push(`-----END ${keyword} PRIVATE KEY-----`)
    return lines.join('\n')
}

function randomBody(): string {
    return crypto.randomBytes(24).toString('base64')
}

function pemOf(key: crypto.KeyObject): string {
    return key.export({ format: 'pem', type: 'pkcs8' }) as string
}

/** Проверяет, что fn бросает PrivateKeyError с конкретным failure-кодом. */
function throwsWithFailure(fn: () => void, failure: PrivateKeyError['failure']): boolean {
    try {
        fn()
        return false
    } catch (err) {
        return err instanceof PrivateKeyError && err.failure === failure
    }
}

/** Существующий файл проекта для проверки чтения через privateKeyPath. */
const EXISTING_PATH = path.join(process.cwd(), 'electron', 'src', 'private-key.ts')

describe('isSupportedOpenSSHPrivateKeyFormat', () => {
    it('принимает валидный контейнер openssh-key-v1', () => {
        expect(isSupportedOpenSSHPrivateKeyFormat(buildOpenSshContainer())).toBe(true)
    })

    it('отклоняет повреждённые контейнеры', () => {
        expect(isSupportedOpenSSHPrivateKeyFormat(buildOpenSshContainer({ magic: Buffer.from('wrong-magic\x00') }))).toBe(false)
        expect(isSupportedOpenSSHPrivateKeyFormat(buildOpenSshContainer({ keyCount: 0 }))).toBe(false)
        expect(isSupportedOpenSSHPrivateKeyFormat(buildOpenSshContainer({ trailing: 4 }))).toBe(false)
        expect(isSupportedOpenSSHPrivateKeyFormat(buildOpenSshContainer({ includePrivateBlock: false }))).toBe(false)
        expect(isSupportedOpenSSHPrivateKeyFormat(makePem('OPENSSH', randomBody()))).toBe(false)
        expect(isSupportedOpenSSHPrivateKeyFormat('not a key')).toBe(false)
    })
})

describe('isSupportedPrivateKeyFormat', () => {
    it('принимает PKCS#8 PEM (node:crypto парсит)', () => {
        const { privateKey } = crypto.generateKeyPairSync('ed25519')
        expect(isSupportedPrivateKeyFormat(pemOf(privateKey))).toBe(true)
    })

    it('принимает структурно валидный OpenSSH-контейнер по структуре openssh-key-v1', () => {
        expect(isSupportedPrivateKeyFormat(buildOpenSshContainer())).toBe(true)
    })

    it('принимает ENCRYPTED PRIVATE KEY (passphrase-защищённый)', () => {
        const encrypted = [
            '-----BEGIN ENCRYPTED PRIVATE KEY-----',
            crypto.randomBytes(24).toString('base64'),
            '-----END ENCRYPTED PRIVATE KEY-----'
        ].join('\n')
        expect(isSupportedPrivateKeyFormat(encrypted)).toBe(true)
    })

    it('принимает PPK-ключ только при полном наборе заголовков', () => {
        const ppk = [
            'PuTTY-User-Key-File-2: ssh-rsa',
            'Encryption: aes256-cbc',
            'Comment: imported',
            'Public-Lines: 2',
            'AAAA',
            'BBBB',
            'Private-Lines: 1',
            'CCCC',
            'Private-MAC: 0000'
        ].join('\n')
        expect(isSupportedPrivateKeyFormat(ppk)).toBe(true)

        expect(isSupportedPrivateKeyFormat(ppk.replace('Private-Lines: 1', 'Private-Lines: X'))).toBe(false)
        expect(isSupportedPrivateKeyFormat(ppk.replace('Encryption: aes256-cbc', ''))).toBe(false)
    })

    it('отклоняет мусор, пустые строки и ключ без футера', () => {
        expect(isSupportedPrivateKeyFormat('')).toBe(false)
        expect(isSupportedPrivateKeyFormat('   ')).toBe(false)
        expect(isSupportedPrivateKeyFormat(makePem('RSA', randomBody(), false))).toBe(false)
        expect(isSupportedPrivateKeyFormat(makePem('RSA', randomBody()) + '\n')).toBe(false)
    })
})

describe('isEncryptedPrivateKeyContent', () => {
    it('PKCS#8 «ENCRYPTED PRIVATE KEY» требует парольной фразы', () => {
        const encrypted = [
            '-----BEGIN ENCRYPTED PRIVATE KEY-----',
            crypto.randomBytes(24).toString('base64'),
            '-----END ENCRYPTED PRIVATE KEY-----'
        ].join('\n')
        expect(isEncryptedPrivateKeyContent(encrypted)).toBe(true)
    })

    it('classic PEM с Proc-Type/DEK-Info требует парольной фразы', () => {
        const classic = [
            '-----BEGIN RSA PRIVATE KEY-----',
            'Proc-Type: 4,ENCRYPTED',
            'DEK-Info: AES-128-CBC,0123456789ABCDEF0123456789ABCDEF',
            '',
            randomBody(),
            '-----END RSA PRIVATE KEY-----'
        ].join('\n')
        expect(isEncryptedPrivateKeyContent(classic)).toBe(true)
    })

    it('PPK с секцией Encryption требует парольной фразы', () => {
        const ppk = [
            'PuTTY-User-Key-File-2: ssh-rsa',
            'Encryption: aes256-cbc',
            'Public-Lines: 1',
            'AAAA',
            'Private-Lines: 1',
            'CCCC'
        ].join('\n')
        expect(isEncryptedPrivateKeyContent(ppk)).toBe(true)
    })

    it('контейнер OpenSSH определяется по имени шифра', () => {
        expect(isEncryptedPrivateKeyContent(buildOpenSshContainer({ ciphername: 'aes256-ctr' }))).toBe(true)
        expect(isEncryptedPrivateKeyContent(buildOpenSshContainer())).toBe(false)
    })

    it('повреждённый контейнер OpenSSH парольной фразы не требует', () => {
        // структурно битые контейнеры: парольная фраза не поможет их разобрать
        expect(isEncryptedPrivateKeyContent(buildOpenSshContainer({ ciphername: 'aes256-ctr', trailing: 4 }))).toBe(false)
        expect(isEncryptedPrivateKeyContent(buildOpenSshContainer({ ciphername: 'aes256-ctr', keyCount: 0 }))).toBe(false)
        expect(isEncryptedPrivateKeyContent(buildOpenSshContainer({ ciphername: 'aes256-ctr', includePrivateBlock: false }))).toBe(false)
        expect(isEncryptedPrivateKeyContent(buildOpenSshContainer({ magic: Buffer.from('wrong-magic\x00'), ciphername: 'aes256-ctr' }))).toBe(false)
        // длина имени шифра 0
        expect(isEncryptedPrivateKeyContent(buildOpenSshContainer({ ciphername: '' }))).toBe(false)
        // длина имени шифра выходит за пределы буфера
        expect(isEncryptedPrivateKeyContent(buildOpenSshContainer({ ciphername: 'aes256-ctr', cipherLength: 0xffffff }))).toBe(false)
    })

    it('незашифрованный ключ парольной фразы не требует', () => {
        const { privateKey } = crypto.generateKeyPairSync('ed25519')
        expect(isEncryptedPrivateKeyContent(pemOf(privateKey))).toBe(false)
    })

    it('пустые значения и мусор не считаются зашифрованным ключом', () => {
        expect(isEncryptedPrivateKeyContent('')).toBe(false)
        expect(isEncryptedPrivateKeyContent('   ')).toBe(false)
        expect(isEncryptedPrivateKeyContent('not a key')).toBe(false)
        expect(isEncryptedPrivateKeyContent(makePem('RSA', randomBody()))).toBe(false)
    })
})

describe('isEncryptedSecret', () => {
    it('распознаёт валидный blob', () => {
        expect(isEncryptedSecret({ iv: 'a', tag: 'b', data: 'c' })).toBe(true)
        expect(isEncryptedSecret({ iv: 'a', tag: 'b', data: 'c', extra: 1 })).toBe(true)
    })

    it('отклоняет невалидные значения', () => {
        expect(isEncryptedSecret(null)).toBe(false)
        expect(isEncryptedSecret(undefined)).toBe(false)
        expect(isEncryptedSecret('string')).toBe(false)
        expect(isEncryptedSecret({ iv: 'a', tag: 'b' })).toBe(false)
        expect(isEncryptedSecret({ iv: 1, tag: 'b', data: 'c' })).toBe(false)
    })
})

describe('resolvePrivateKey', () => {
    beforeEach(() => {
        vault.unlock(crypto.randomBytes(32).toString('base64'), crypto.randomBytes(16).toString('base64'))
    })

    function cfg(partial: Partial<SSHConfig>): SSHConfig {
        return { name: 's', user: 'u', host: 'h', port: 22, ...partial }
    }

    it('расшифровывает зашифрованный blob при разблокированном хранилище', () => {
        const plaintext = `synthetic-${crypto.randomBytes(16).toString('hex')}`
        const config = cfg({ privateKey: vault.encrypt(plaintext) })
        expect(resolvePrivateKey(config).toString('utf8')).toBe(plaintext)
    })

    it('использует blob при валидном privateKeyPath (blob приоритетнее path)', () => {
        const plaintext = `synthetic-${crypto.randomBytes(16).toString('hex')}`
        const config = cfg({ privateKey: vault.encrypt(plaintext), privateKeyPath: EXISTING_PATH })
        expect(resolvePrivateKey(config).toString('utf8')).toBe(plaintext)
    })

    it('бросает locked, если хранилище закрыто, даже при наличии privateKeyPath', () => {
        const blob = vault.encrypt('x')
        vault.lock()
        const config = cfg({ privateKey: blob, privateKeyPath: '/some/key' })
        expect(throwsWithFailure(() => resolvePrivateKey(config), 'locked')).toBe(true)
    })

    it('бросает decrypt для чужого/битого blob (blob приоритетнее path)', () => {
        const other = new VaultService()
        other.unlock(crypto.randomBytes(32).toString('base64'), crypto.randomBytes(16).toString('base64'))
        const config = cfg({ privateKey: other.encrypt('x'), privateKeyPath: '/some/key' })
        expect(throwsWithFailure(() => resolvePrivateKey(config), 'decrypt')).toBe(true)
    })

    it('читает файл по privateKeyPath для legacy-конфига', () => {
        const result = resolvePrivateKey(cfg({ privateKeyPath: EXISTING_PATH }))
        expect(result.toString('utf8')).toContain('resolvePrivateKey')
    })

    it('бросает read при несуществующем файле и missing при отсутствии ключа вообще', () => {
        expect(throwsWithFailure(() => resolvePrivateKey(cfg({ privateKeyPath: '/no/such/file-xyz' })), 'read')).toBe(true)
        expect(throwsWithFailure(() => resolvePrivateKey(cfg({})), 'missing')).toBe(true)
    })

    it('не использует path, когда blob не расшифровывается', () => {
        const brokenBlob = { iv: 'aa', tag: 'aa', data: 'aa' }
        expect(throwsWithFailure(() => resolvePrivateKey(cfg({ privateKey: brokenBlob, privateKeyPath: EXISTING_PATH })), 'decrypt')).toBe(true)
    })
})

describe('stripPlaintextPrivateKeys', () => {
    beforeEach(() => {
        vault.unlock(crypto.randomBytes(32).toString('base64'), crypto.randomBytes(16).toString('base64'))
    })

    it('шифрует plaintext-ключ на лету при открытом хранилище', () => {
        const favorites = [{ id: 's1', privateKey: 'PLAINTEXT' }]
        stripPlaintextPrivateKeys(favorites as unknown as SSHConfig[])
        const result = favorites[0].privateKey
        expect(isEncryptedSecret(result)).toBe(true)
        if (isEncryptedSecret(result)) {
            expect(vault.decrypt(result)).toBe('PLAINTEXT')
        }
    })

    it('удаляет plaintext-ключ при закрытом хранилище', () => {
        vault.lock()
        const favorites = [{ id: 's1', privateKey: 'PLAINTEXT' }]
        stripPlaintextPrivateKeys(favorites as unknown as SSHConfig[])
        expect(favorites[0].privateKey).toBeUndefined()
    })

    it('не трогает уже зашифрованные и отсутствующие ключи', () => {
        const blob = vault.encrypt('x')
        const favorites = [
            { id: 's1', privateKey: blob },
            { id: 's2' }
        ]
        stripPlaintextPrivateKeys(favorites as unknown as SSHConfig[])
        expect(favorites[0].privateKey).toEqual(blob)
        expect(favorites[1].privateKey).toBeUndefined()
    })
})

describe('privateKeyErrorMessage', () => {
    it('возвращает сообщение LocalizedError как есть', () => {
        expect(privateKeyErrorMessage(new LocalizedError('already-localized'))).toBe('already-localized')
    })

    it('мапит failure-коды на локализованные сообщения (ru)', () => {
        expect(privateKeyErrorMessage(new PrivateKeyError('locked', 'x'))).toBe('Хранилище заблокировано')
        expect(privateKeyErrorMessage(new PrivateKeyError('decrypt', 'x'))).toBe('Не удалось расшифровать приватный ключ')
        expect(privateKeyErrorMessage(new PrivateKeyError('missing', 'x'))).toBe('Ошибка: Приватный ключ не задан')
        expect(privateKeyErrorMessage(new PrivateKeyError('invalid', 'x'))).toBe('Ошибка: Приватный ключ не подходит')
        expect(privateKeyErrorMessage(new PrivateKeyError('passphrase', 'x'))).toBe('Ошибка: Ключ зашифрован, нужна парольная фраза')
        // readPrivateKeyFailed содержит только {message} — сообщение возвращается как есть
        expect(privateKeyErrorMessage(new PrivateKeyError('read', 'ENOENT'))).toBe('ENOENT')
    })

    it('мапит ssh2-синоним Cannot parse privateKey и прочие ошибки', () => {
        expect(privateKeyErrorMessage(new Error('Cannot parse privateKey: malformed PEM'))).toBe('Ошибка: Приватный ключ не подходит')
        expect(privateKeyErrorMessage(new Error('boom'))).toBe('boom')
    })
})

describe('decryptSessionSecret', () => {
    beforeEach(() => {
        vault.unlock(crypto.randomBytes(32).toString('base64'), crypto.randomBytes(16).toString('base64'))
    })

    it('возвращает содержимое blob, введённого пользователем', () => {
        const content = `session-key-${crypto.randomBytes(8).toString('hex')}`
        expect(decryptSessionSecret(vault.encrypt(content)).toString('utf8')).toBe(content)
    })

    it('закрытое хранилище и битый blob дают PrivateKeyError', () => {
        const blob = vault.encrypt('x')
        vault.lock()
        expect(throwsWithFailure(() => decryptSessionSecret(blob), 'locked')).toBe(true)
        vault.unlock(crypto.randomBytes(32).toString('base64'), crypto.randomBytes(16).toString('base64'))
        expect(throwsWithFailure(() => decryptSessionSecret({ iv: 'a', tag: 'b', data: 'c' }), 'decrypt')).toBe(true)
    })
})