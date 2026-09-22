import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import { vault } from './vault.js'
import { t } from './i18n-main.js'
import type { EncryptedSecret, SSHConfig } from '../../src/types.js'

export type PrivateKeyFailure = 'read' | 'decrypt' | 'locked' | 'invalid'

export class PrivateKeyError extends Error {
    readonly failure: PrivateKeyFailure

    constructor(failure: PrivateKeyFailure, message: string) {
        super(message)
        this.name = 'PrivateKeyError'
        this.failure = failure
    }
}

const PEM_HEADER = /^-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[ \t\r]*$/m
const PEM_FOOTER = /-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[ \t\r]*$/
const PPK_HEADER = /^PuTTY-User-Key-File-\d+:[^\r\n]*/m
const PPK_ENCRYPTION = /^Encryption:[ \t]*\S+/m
const PPK_PUBLIC_LINES = /^Public-Lines:[ \t]*\d+$/m
const PPK_PRIVATE_LINES = /^Private-Lines:[ \t]*\d+$/m

/**
 * Надёжная валидация содержимого приватного ключа в main-процессе.
 * PEM/OpenSSH парсится через node:crypto, PuTTY PPK — структурно (crypto их не поддерживает).
 */
export function validatePrivateKeyContent(content: string): boolean {
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
 * Зашифрованный blob — основной источник; legacy privateKeyPath остаётся
 * fallback-ом до завершения миграции, поэтому недоступный blob не роняет соединение.
 */
export function resolvePrivateKey(config: SSHConfig): Buffer {
    if (config.privateKey) {
        if (vault.isUnlocked()) {
            const content = tryDecryptEncryptedSecret(config.privateKey)
            if (content !== null) {
                return Buffer.from(content, 'utf8')
            }
        }

        if (config.privateKeyPath) {
            try {
                return fs.readFileSync(config.privateKeyPath)
            } catch (err) {
                throw new PrivateKeyError('read', err instanceof Error ? err.message : String(err))
            }
        }

        throw new PrivateKeyError(
            vault.isUnlocked() ? 'decrypt' : 'locked',
            'PRIVATE_KEY_UNRESOLVED'
        )
    }

    if (config.privateKeyPath) {
        try {
            return fs.readFileSync(config.privateKeyPath)
        } catch (err) {
            throw new PrivateKeyError('read', err instanceof Error ? err.message : String(err))
        }
    }

    throw new PrivateKeyError('read', 'PRIVATE_KEY_NOT_FOUND')
}

export function privateKeyErrorMessage(err: unknown): string {
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
        }
    }
    return t('errors.readPrivateKeyFailed', {
        message: err instanceof Error ? err.message : String(err)
    })
}
