import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as crypto from 'node:crypto'
import type { ConnectConfig } from 'ssh2'

vi.mock('../electron/src/config.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../electron/src/config.js')>()
    return {
        ...actual,
        loadConfig: vi.fn(),
        initializeVaultAndMigrate: vi.fn(async () => undefined)
    }
})

import { applyAuthConfig } from '../electron/src/auth-credentials.js'
import { loadConfig, DEFAULT_CONFIG } from '../electron/src/config.js'
import { vault } from '../electron/src/vault.js'
import { LocalizedError, PrivateKeyError } from '../electron/src/private-key.js'
import type { AppConfig, SSHConfig } from '../src/types.js'

const RECOVERY_KEY = crypto.randomBytes(32).toString('base64')
const SALT = crypto.randomBytes(16).toString('base64')

function baseConfig(partial: Partial<SSHConfig> = {}): SSHConfig {
    return { name: 'server', user: 'root', host: 'example.com', port: 22, ...partial }
}

function appConfigWithPasswords(passwords: Record<string, string>): AppConfig {
    const encrypted: Record<string, { iv: string; tag: string; data: string }> = {}
    for (const [id, plaintext] of Object.entries(passwords)) {
        encrypted[id] = vault.encrypt(plaintext)
    }
    return { ...DEFAULT_CONFIG, encryptedPasswords: encrypted }
}

describe('applyAuthConfig', () => {
    beforeEach(() => {
        vault.unlock(RECOVERY_KEY, SALT)
        vi.clearAllMocks()
    })

    it("authType 'key': подставляет расшифрованный privateKey и не трогает password (фолбэка нет)", () => {
        const plaintext = '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----'
        const config = baseConfig({ authType: 'key', privateKey: vault.encrypt(plaintext), password: 'should-not-be-used' })

        const connectConfig: ConnectConfig = {}
        applyAuthConfig(config, connectConfig)

        expect(connectConfig.privateKey).toBeInstanceOf(Buffer)
        expect((connectConfig.privateKey as Buffer).toString('utf8')).toBe(plaintext)
        expect(connectConfig.password).toBeUndefined()
    })

    it("authType 'key': бросает missing без ключа и read при несуществующем файле", () => {
        expect(() => applyAuthConfig(baseConfig({ authType: 'key' }), {})).toThrow(PrivateKeyError)
        expect(() => applyAuthConfig(baseConfig({ authType: 'key', privateKeyPath: '/no/such/file' }), {})).toThrow(PrivateKeyError)
    })

    it("authType 'key': decrypt-failure при нерасшифровываемом blob", () => {
        const config = baseConfig({ authType: 'key', privateKey: { iv: 'aa', tag: 'aa', data: 'aa' } })
        expect(() => applyAuthConfig(config, {})).toThrow(PrivateKeyError)
    })

    it("authType 'key': зашифрованный privateKey приоритетнее privateKeyPath (файл не читается)", () => {
        const plaintext = '-----BEGIN OPENSSH PRIVATE KEY-----\nBLOB\n-----END OPENSSH PRIVATE KEY-----'
        const config = baseConfig({
            authType: 'key',
            privateKey: vault.encrypt(plaintext),
            privateKeyPath: '/no/such/file'
        })

        const connectConfig: ConnectConfig = {}
        applyAuthConfig(config, connectConfig)

        expect(connectConfig.privateKey).toBeInstanceOf(Buffer)
        expect((connectConfig.privateKey as Buffer).toString('utf8')).toBe(plaintext)
    })

    it("authType 'key': locked vault с ключом бросает PrivateKeyError c failure 'locked'", () => {
        const config = baseConfig({ authType: 'key', privateKey: vault.encrypt('x') })
        vault.lock()

        expect(() => applyAuthConfig(config, {})).toThrow(PrivateKeyError)
        try {
            applyAuthConfig(config, {})
        } catch (err) {
            expect(err).toBeInstanceOf(PrivateKeyError)
            expect((err as PrivateKeyError).failure).toBe('locked')
        }
    })

    it('password: берёт расшифрованный пароль из encryptedPasswords[serverId]', () => {
        vi.mocked(loadConfig).mockReturnValue(appConfigWithPasswords({ 'srv-1': 'hunter2' }))
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ id: 'srv-1' }), connectConfig)
        expect(connectConfig.password).toBe('hunter2')
    })

    it('password: без encryptedPasswords использует открытый config.password', () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ password: 'plain-pass' }), connectConfig)
        expect(connectConfig.password).toBe('plain-pass')
    })

    it('password: пробует encryptedPasswords только при совпадении id', () => {
        vi.mocked(loadConfig).mockReturnValue(appConfigWithPasswords({ 'other-id': 'x' }))
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ id: 'srv-1', password: 'fallback' }), connectConfig)
        expect(connectConfig.password).toBe('fallback')
    })

    it('password: бросает LocalizedError, если vault не расшифровывает blob', () => {
        vi.mocked(loadConfig).mockReturnValue(appConfigWithPasswords({ 'srv-1': 'hunter2' }))
        vault.lock()

        expect(() => applyAuthConfig(baseConfig({ id: 'srv-1' }), {})).toThrow(LocalizedError)
    })

    it("authType по умолчанию (password): не требует наличия ключа", () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ password: 'pw' }), connectConfig)
        expect(connectConfig.password).toBe('pw')
    })
})