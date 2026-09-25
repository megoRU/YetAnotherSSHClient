import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import { vault } from './vault.js'
import { t } from './i18n-main.js'
import type { EncryptedSecret, SSHConfig } from '../../src/types.js'

export type PrivateKeyFailure = 'read' | 'decrypt' | 'locked' | 'invalid' | 'missing' | 'passphrase'

export class PrivateKeyError extends Error {
    readonly failure: PrivateKeyFailure

    constructor(failure: PrivateKeyFailure, message: string) {
        super(message)
        this.name = 'PrivateKeyError'
        this.failure = failure
    }
}

/** Ошибка с уже локализованным сообщением — privateKeyErrorMessage возвращает его без оборачивания. */
export class LocalizedError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'LocalizedError'
    }
}

const PEM_HEADER = /^-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[ \t\r]*$/m
const PEM_FOOTER = /-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[ \t\r]*$/
const PPK_HEADER = /^PuTTY-User-Key-File-\d+:[^\r\n]*/m
const PPK_ENCRYPTION = /^Encryption:[ \t]*\S+/m
const PPK_PUBLIC_LINES = /^Public-Lines:[ \t]*\d+$/m
const PPK_PRIVATE_LINES = /^Private-Lines:[ \t]*\d+$/m
const OPENSSH_MAGIC = Buffer.from('openssh-key-v1\x00', 'utf8')

/**
 * Проверка структуры OpenSSH-контейнера ("BEGIN OPENSSH PRIVATE KEY"),
 * который node:crypto не умеет парсить (только PKCS#1/PKCS#8/SEC1).
 * Разбор: base64-тело -> magic "openssh-key-v1\0" -> string-поля заголовка -> число ключей.
 * Это именно проверка структуры контейнера, а не криптографическая валидация ключа.
 */
export function isSupportedOpenSSHPrivateKeyFormat(content: string): boolean {
    const match = content.match(/-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/)
    if (!match) return false
    const body = match[1].replace(/\s+/g, '')
    if (!/^[A-Za-z0-9+/]+={0,3}$/.test(body) || body.length < 32) return false

    let buf: Buffer
    try {
        buf = Buffer.from(body, 'base64')
    } catch {
        return false
    }
    if (!buf.subarray(0, OPENSSH_MAGIC.length).equals(OPENSSH_MAGIC)) return false

    // Полный структурный разбор: заголовок, N публичных ключей и приватный блок.
    // Буфер должен быть израсходован ровно — обрезанный/повреждённый ключ отбраковывается.
    try {
        let offset = OPENSSH_MAGIC.length

        const readString = (): void => {
            const len = buf.readUInt32BE(offset)
            offset += 4
            if (len > buf.length - offset) throw new Error('out of bounds')
            offset += len
        }

        readString() // ciphername
        readString() // kdfname
        readString() // kdfoptions

        const keyCount = buf.readUInt32BE(offset)
        offset += 4
        if (keyCount < 1) return false
        for (let i = 0; i < keyCount; i++) {
            readString() // публичный ключ
        }
        readString() // приватный блок

        return offset === buf.length
    } catch {
        return false
    }
}

/**
 * Проверка формата содержимого приватного ключа в main-процессе.
 *
 * Проверяется только структурная пригодность формата для хранения/загрузки,
 * а не достоверность ключа: PKCS#1/PKCS#8/SEC1 и PEM с passphrase парсится через
 * node:crypto; OpenSSH проверяется только по структуре контейнера, PuTTY PPK — по
 * заголовкам (crypto их не понимает). Не создаёт гарантии, что ключ рабочий/signable.
 */
export function isSupportedPrivateKeyFormat(content: string): boolean {
    if (typeof content !== 'string') return false
    const trimmed = content.trim()
    if (trimmed.length === 0) return false

    if (trimmed.startsWith('PuTTY-User-Key-File')) {
        // PPK — только синтаксическая проверка заголовков (как у ssh2/ssh-agent),
        // фактическая работоспособность ключа не проверяется.
        return PPK_HEADER.test(trimmed)
            && PPK_ENCRYPTION.test(trimmed)
            && PPK_PUBLIC_LINES.test(trimmed)
            && PPK_PRIVATE_LINES.test(trimmed)
    }

    if (!PEM_HEADER.test(trimmed) || !PEM_FOOTER.test(trimmed)) return false

    // node:crypto не понимает OpenSSH-формат — проверяем только структуру контейнера
    if (/-----BEGIN OPENSSH PRIVATE KEY-----/.test(trimmed)) {
        return isSupportedOpenSSHPrivateKeyFormat(trimmed)
    }

    // Ключ с passphrase: node:crypto без пароля его не прочитает, но это валидный формат.
    if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(trimmed)
        || /Proc-Type:[ \t]*4,ENCRYPTED/.test(trimmed)
        || /DEK-Info:/.test(trimmed)) {
        return true
    }

    try {
        crypto.createPrivateKey({ key: Buffer.from(trimmed, 'utf8'), format: 'pem' })
        return true
    } catch {
        return false
    }
}

export function isEncryptedSecret(value: unknown): value is EncryptedSecret {
    if (typeof value !== 'object' || value === null) return false
    const record = value as Record<string, string | undefined>
    return typeof record.iv === 'string'
        && typeof record.tag === 'string'
        && typeof record.data === 'string'
}

/**
 * Не допускает записи plaintext private key в конфиг/кэш/экспорт.
 * Если ключ не является зашифрованным blob'ом, но это plaintext-строка и vault открыт —
 * ключ сохраняется (шифруется на лету), чтобы не терять введённый пользователем ключ.
 * Удаление происходит только если сохранить его безопасно невозможно (vault locked,
 * повреждённые данные, ошибка шифрования); в этом случае ключ не записывается.
 */
export function stripPlaintextPrivateKeys(favorites: SSHConfig[]): void {
    for (const favorite of favorites) {
        if (favorite.privateKey === undefined) continue
        if (isEncryptedSecret(favorite.privateKey)) continue

        if (typeof favorite.privateKey === 'string' && vault.isUnlocked()) {
            try {
                favorite.privateKey = vault.encrypt(favorite.privateKey)
                continue
            } catch {
                // шифрование не удалось — не записываем plaintext, удаляем
            }
        }
        console.warn(`[Config] Removed non-encrypted private key for server ${favorite.id || favorite.host}`)
        delete favorite.privateKey
    }
}

/** Пытается расшифровать blob; возвращает null при любой ошибке (locked/битый/mis-encrypted). */
export function tryDecryptEncryptedSecret(secret: EncryptedSecret | undefined): string | null {
    if (!secret || !isEncryptedSecret(secret)) return null
    try {
        return vault.decrypt(secret)
    } catch {
        return null
    }
}

/**
 * Единая точка резолва приватного ключа для SSH/SFTP/MCP/port-forwarding.
 *
 * Зашифрованный blob (SSHConfig.privateKey) — единственный authoritative источник:
 * если он присутствует, `privateKeyPath` не используется, даже когда blob нельзя
 * расшифровать (locked) или он повреждён (decrypt) — в этих случаях возвращается
 * понятная ошибка. `privateKeyPath` читается только для legacy-серверов, у которых
 * поле `privateKey` полностью отсутствует.
 */
export function resolvePrivateKey(config: SSHConfig): Buffer {
    if (config.privateKey) {
        if (!vault.isUnlocked()) {
            throw new PrivateKeyError('locked', 'PRIVATE_KEY_VAULT_LOCKED')
        }
        const content = tryDecryptEncryptedSecret(config.privateKey)
        if (content === null) {
            throw new PrivateKeyError('decrypt', 'PRIVATE_KEY_DECRYPT_FAILED')
        }
        return Buffer.from(content, 'utf8')
    }

    if (config.privateKeyPath) {
        try {
            return fs.readFileSync(config.privateKeyPath)
        } catch (err) {
            throw new PrivateKeyError('read', err instanceof Error ? err.message : String(err))
        }
    }

    throw new PrivateKeyError('missing', 'PRIVATE_KEY_NOT_FOUND')
}

/**
 * Проверяет, что содержимое приватного ключа зашифровано и для его использования
 * нужна парольная фраза.
 *
 * Определяются все три варианта, которые понимает ssh2: PKCS#8 («ENCRYPTED PRIVATE
 * KEY»), classic PEM с заголовками Proc-Type/DEK-Info, контейнер OpenSSH с
 * непустым ciphername и PPK с секцией Encryption.
 */
export function isEncryptedPrivateKeyContent(content: string): boolean {
    if (typeof content !== 'string' || content.length === 0) return false
    const trimmed = content.trim()
    if (trimmed.length === 0) return false

    if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(trimmed)) return true
    if (/Proc-Type:[ \t]*4,ENCRYPTED/.test(trimmed)) return true
    if (/^DEK-Info:/m.test(trimmed)) return true
    if (PPK_ENCRYPTION.test(trimmed)) return true

    return isEncryptedOpenSSHPrivateKey(trimmed)
}

/**
 * Проверяет, что контейнер OpenSSH («BEGIN OPENSSH PRIVATE KEY») зашифрован:
 * поле ciphername в заголовке отличается от "none".
 *
 * Повреждённый контейнер парольной фразы не требует: вернуть true можно только
 * после успешного чтения структуры контейнера, иначе пользователю предложат ввести
 * парольную фразу для ключа, который невозможно разобрать.
 */
function isEncryptedOpenSSHPrivateKey(trimmed: string): boolean {
    const match = trimmed.match(/-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/)
    if (!match) return false

    // Повреждённая структура контейнера: дальше читать ciphername бессмысленно
    if (!isSupportedOpenSSHPrivateKeyFormat(trimmed)) return false

    const body = match[1].replace(/\s+/g, '')
    if (!/^[A-Za-z0-9+/]+={0,3}$/.test(body)) return false

    let buf: Buffer
    try {
        buf = Buffer.from(body, 'base64')
    } catch {
        return false
    }
    if (buf.length <= OPENSSH_MAGIC.length + 4) return false
    if (!buf.subarray(0, OPENSSH_MAGIC.length).equals(OPENSSH_MAGIC)) return false

    // Первая строка внутри контейнера — имя шифра: "none" означает открытый ключ.
    const cipherStart = OPENSSH_MAGIC.length + 4
    const cipherLength = buf.readUInt32BE(OPENSSH_MAGIC.length)
    if (cipherLength === 0 || cipherStart + cipherLength > buf.length) return false
    const cipherName = buf.subarray(cipherStart, cipherStart + cipherLength).toString('utf8')
    if (cipherName.length === 0) return false
    return cipherName !== 'none'
}

/** Расшифровывает blob, переданный рендерером для текущей попытки подключения. */
export function decryptSessionSecret(secret: EncryptedSecret): Buffer {
    if (!vault.isUnlocked()) {
        throw new PrivateKeyError('locked', 'PRIVATE_KEY_VAULT_LOCKED')
    }
    const content = tryDecryptEncryptedSecret(secret)
    if (content === null) {
        throw new PrivateKeyError('decrypt', 'PRIVATE_KEY_DECRYPT_FAILED')
    }
    return Buffer.from(content, 'utf8')
}

export function privateKeyErrorMessage(err: unknown): string {
    if (err instanceof LocalizedError) {
        return err.message
    }
    if (err instanceof PrivateKeyError) {
        switch (err.failure) {
            case 'read':
                return t('errors.readPrivateKeyFailed', { message: err.message })
            case 'decrypt':
                return t('errors.privateKeyDecryptFailed')
            case 'locked':
                return t('errors.vaultLocked')
            case 'invalid':
                return t('errors.invalidPrivateKey')
            case 'missing':
                return t('errors.privateKeyNotSet')
            case 'passphrase':
                return t('errors.keyPassphraseRequired')
        }
    }
    const message = err instanceof Error ? err.message : String(err)
    // ssh2 на непарсируемом ключе бросает синоним "Cannot parse privateKey: ..."
    if (message.startsWith('Cannot parse privateKey')) {
        return t('errors.invalidPrivateKey')
    }
    return t('errors.readPrivateKeyFailed', { message })
}
