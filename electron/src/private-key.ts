import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import { vault } from './vault.js'
import { t } from './i18n-main.js'
import type { EncryptedSecret, SSHConfig } from '../../src/types.js'

export type PrivateKeyFailure = 'read' | 'decrypt' | 'locked' | 'invalid' | 'missing'

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
 * Структурная валидация OpenSSH-формата ("BEGIN OPENSSH PRIVATE KEY"),
 * который node:crypto не умеет парсить (только PKCS#1/PKCS#8/SEC1).
 * Разбор: base64-тело -> magic "openssh-key-v1\0" -> string-поля заголовка -> число ключей.
 */
export function validateOpenSSHPrivateKey(content: string): boolean {
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
 * Функция подтверждает только структурную пригодность формата (не подпись/ключ):
 * PKCS#1/PKCS#8/SEC1 и PEM с passphrase парсится через node:crypto,
 * OpenSSH-формат и PuTTY PPK — структурно (crypto их не поддерживает).
 */
export function isSupportedPrivateKeyFormat(content: string): boolean {
    if (typeof content !== 'string') return false
    const trimmed = content.trim()
    if (trimmed.length === 0) return false

    if (trimmed.startsWith('PuTTY-User-Key-File')) {
        return PPK_HEADER.test(trimmed)
            && PPK_ENCRYPTION.test(trimmed)
            && PPK_PUBLIC_LINES.test(trimmed)
            && PPK_PRIVATE_LINES.test(trimmed)
    }

    if (!PEM_HEADER.test(trimmed) || !PEM_FOOTER.test(trimmed)) return false

    // node:crypto не понимает OpenSSH-формат — валидируем структуру вручную
    if (/-----BEGIN OPENSSH PRIVATE KEY-----/.test(trimmed)) {
        return validateOpenSSHPrivateKey(trimmed)
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

/** Удаляет из favorites ключи, не являющиеся EncryptedSecret, чтобы open key не попал в хранилище. */
export function stripPlaintextPrivateKeys(favorites: SSHConfig[]): void {
    for (const favorite of favorites) {
        if (favorite.privateKey === undefined) continue
        if (!isEncryptedSecret(favorite.privateKey)) {
            delete favorite.privateKey
        }
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
        }
    }
    const message = err instanceof Error ? err.message : String(err)
    // ssh2 на непарсируемом ключе бросает синоним "Cannot parse privateKey: ..."
    if (message.startsWith('Cannot parse privateKey')) {
        return t('errors.invalidPrivateKey')
    }
    return t('errors.readPrivateKeyFailed', { message })
}
