import { describe, it, expect, beforeEach } from 'vitest'
import * as crypto from 'node:crypto'
import { VaultService } from '../electron/src/vault.js'

function createKeyPair(): { recoveryKey: string; salt: string } {
    return {
        recoveryKey: crypto.randomBytes(32).toString('base64'),
        salt: crypto.randomBytes(16).toString('base64')
    }
}

describe('VaultService', () => {
    let vault: VaultService
    let keys: { recoveryKey: string; salt: string }

    beforeEach(() => {
        keys = createKeyPair()
        vault = new VaultService()
        vault.unlock(keys.recoveryKey, keys.salt)
    })

    it('isUnlocked отражает состояние после unlock/lock', () => {
        expect(vault.isUnlocked()).toBe(true)
        vault.lock()
        expect(vault.isUnlocked()).toBe(false)
        vault.unlock(keys.recoveryKey, keys.salt)
        expect(vault.isUnlocked()).toBe(true)
    })

    it('encrypt/decrypt делает round-trip', () => {
        const plaintext = 'MySuperSecretPassword123'
        const encrypted = vault.encrypt(plaintext)
        expect(vault.decrypt(encrypted)).toBe(plaintext)
    })

    it('encrypt/decrypt пустой строки работает', () => {
        expect(vault.decrypt(vault.encrypt(''))).toBe('')
    })

    it('каждый encrypt генерирует уникальный IV', () => {
        const a = vault.encrypt('same')
        const b = vault.encrypt('same')
        expect(a.iv).not.toBe(b.iv)
        expect(vault.decrypt(a)).toBe('same')
        expect(vault.decrypt(b)).toBe('same')
    })

    it('бросает VAULT_LOCKED при encrypt/decrypt в закрытом состоянии', () => {
        vault.lock()
        expect(() => vault.encrypt('secret')).toThrow('VAULT_LOCKED')
        expect(() => vault.decrypt({ iv: 'x', tag: 'y', data: 'z' })).toThrow('VAULT_LOCKED')
    })

    it('отклоняет подменённый auth-tag (tampering detection)', () => {
        const encrypted = vault.encrypt('integrity-check')
        const tampered = { ...encrypted, tag: crypto.randomBytes(16).toString('base64') }
        expect(() => vault.decrypt(tampered)).toThrow()
    })

    it('отклоняет изменённые данные', () => {
        const encrypted = vault.encrypt('integrity-check')
        const tamperedData = Buffer.from(encrypted.data, 'base64')
        tamperedData[0] ^= 0xff
        expect(() => vault.decrypt({ ...encrypted, data: tamperedData.toString('base64') })).toThrow()
    })

    it('отклоняет изменённый IV', () => {
        const encrypted = vault.encrypt('integrity-check')
        const tamperedIv = Buffer.from(encrypted.iv, 'base64')
        tamperedIv[0] ^= 0xff
        expect(() => vault.decrypt({ ...encrypted, iv: tamperedIv.toString('base64') })).toThrow()
    })

    it('не расшифровывает данные, зашифрованные другим ключом', () => {
        const other = new VaultService()
        const otherKeys = createKeyPair()
        other.unlock(otherKeys.recoveryKey, otherKeys.salt)
        const foreign = other.encrypt('secret')

        expect(() => vault.decrypt(foreign)).toThrow()
    })
})