import * as fs from 'node:fs'
import { loadConfig, initializeVaultAndMigrate } from './config.js'
import { vault } from './vault.js'
import { t } from './i18n-main.js'
import type { SSHConfig } from '../../src/types.js'

export type PrivateKeyFailure = 'read' | 'decrypt' | 'locked'

export class PrivateKeyError extends Error {
    readonly failure: PrivateKeyFailure

    constructor(failure: PrivateKeyFailure, message: string) {
        super(message)
        this.name = 'PrivateKeyError'
        this.failure = failure
    }
}

export function resolvePrivateKey(config: SSHConfig): Buffer {
    if (config.privateKey) {
        initializeVaultAndMigrate(loadConfig())
        if (!vault.isUnlocked()) {
            throw new PrivateKeyError('locked', 'VAULT_LOCKED')
        }
        try {
            const content = vault.decrypt(config.privateKey)
            return Buffer.from(content, 'utf8')
        } catch (err) {
            throw new PrivateKeyError('decrypt', err instanceof Error ? err.message : String(err))
        }
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
        }
    }
    return t('errors.readPrivateKeyFailed', {
        message: err instanceof Error ? err.message : String(err)
    })
}
