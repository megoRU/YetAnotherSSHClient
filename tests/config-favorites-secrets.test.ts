import { describe, it, expect } from 'vitest'
import * as crypto from 'node:crypto'
import { syncFavoritesSecrets } from '../electron/src/config.js'
import type { EncryptedSecret, SSHConfig } from '../src/types.js'

/**
 * Значения секретов генерируются случайно: жёстко заданные в исходниках
 * «пароли» и «парольные фразы» сканируются как возможные утёкшие секреты.
 */
function randomValue(prefix: string): string {
    return `${prefix}-${crypto.randomBytes(12).toString('hex')}`
}

function favorite(partial: Partial<SSHConfig> & { password?: string; keyPassphrase?: string }): SSHConfig {
    return { name: 'server', user: 'root', host: 'example.com', port: 22, ...partial }
}

function stored(): EncryptedSecret {
    return { iv: 'iv', tag: 'tag', data: 'data' }
}

function encryptTo(secret: EncryptedSecret): (value: string) => EncryptedSecret {
    return value => ({ ...secret, data: `enc(${value})` })
}

describe.each(['password', 'keyPassphrase'] as const)('syncFavoritesSecrets (%s)', field => {
    it('переносит непустой секрет в хранилище и убирает его из favorites', () => {
        const secret = randomValue('secret')
        const favorites = [favorite({ id: 'srv-1', [field]: secret })]
        const secrets: Record<string, EncryptedSecret> = {}

        syncFavoritesSecrets(favorites, field, secrets, true, encryptTo(stored()))

        expect(secrets['srv-1']).toEqual({ iv: 'iv', tag: 'tag', data: `enc(${secret})` })
        expect(favorites[0][field]).toBeUndefined()
    })

    it('пустой секрет удаляет сохранённый', () => {
        const favorites = [favorite({ id: 'srv-1', [field]: '' })]
        const secrets: Record<string, EncryptedSecret> = { 'srv-1': stored() }

        syncFavoritesSecrets(favorites, field, secrets, true, encryptTo(stored()))

        expect(secrets['srv-1']).toBeUndefined()
        expect(favorites[0][field]).toBeUndefined()
    })

    it('отсутствующее поле не трогает сохранённый секрет', () => {
        const favorites = [favorite({ id: 'srv-1' })]
        const secrets: Record<string, EncryptedSecret> = { 'srv-1': stored() }

        syncFavoritesSecrets(favorites, field, secrets, true, encryptTo(stored()))

        expect(secrets['srv-1']).toEqual(stored())
    })

    it('favorites без id игнорируются', () => {
        const favorites = [favorite({ [field]: randomValue('secret') })]
        const secrets: Record<string, EncryptedSecret> = {}

        syncFavoritesSecrets(favorites, field, secrets, true, encryptTo(stored()))

        expect(secrets).toEqual({})
    })

    it('закрытое хранилище: непустой секрет не шифруется и остаётся в favorites', () => {
        const secret = randomValue('secret')
        const favorites = [favorite({ id: 'srv-1', [field]: secret })]
        const secrets: Record<string, EncryptedSecret> = {}

        syncFavoritesSecrets(favorites, field, secrets, false, encryptTo(stored()))

        expect(secrets).toEqual({})
        expect(favorites[0][field]).toBe(secret)
    })

    it('закрытое хранилище: очистка секрета работает и без ключа', () => {
        const favorites = [favorite({ id: 'srv-1', [field]: '' })]
        const secrets: Record<string, EncryptedSecret> = { 'srv-1': stored() }

        syncFavoritesSecrets(favorites, field, secrets, false, encryptTo(stored()))

        expect(secrets['srv-1']).toBeUndefined()
    })

    it('не затрагивает другие секреты того же сервера', () => {
        const password = randomValue('pw')
        const favorites = [favorite({ id: 'srv-1', password, keyPassphrase: '' })]
        const passwords: Record<string, EncryptedSecret> = { 'srv-1': stored() }
        const passphrases: Record<string, EncryptedSecret> = { 'srv-1': stored() }

        syncFavoritesSecrets(favorites, 'keyPassphrase', passphrases, true, encryptTo(stored()))

        expect(passphrases['srv-1']).toBeUndefined()
        expect(passwords['srv-1']).toEqual(stored())
        expect(favorites[0].password).toBe(password)
    })
})
