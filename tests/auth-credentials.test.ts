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

import { applyAuthConfig, isLoginRequired } from '../electron/src/auth-credentials.js'
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
        const plaintext = `synthetic-${crypto.randomBytes(16).toString('hex')}`
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
        const plaintext = `synthetic-${crypto.randomBytes(16).toString('hex')}`
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

describe('isLoginRequired', () => {
    beforeEach(() => {
        vault.unlock(RECOVERY_KEY, SALT)
        vi.clearAllMocks()
    })

    it('логин задан — подключение можно начинать сразу', () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        expect(isLoginRequired(baseConfig({ user: 'root' }))).toBe(false)
    })

    it('пустой или пробельный логин требует ввода', () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        expect(isLoginRequired(baseConfig({ user: '' }))).toBe(true)
        expect(isLoginRequired(baseConfig({ user: '   ' }))).toBe(true)
    })

    it('сохранённый пароль без логина не отменяет требование ввода логина', () => {
        vi.mocked(loadConfig).mockReturnValue(appConfigWithPasswords({ 'srv-1': 'hunter2' }))
        expect(isLoginRequired(baseConfig({ id: 'srv-1', user: '' }))).toBe(true)
    })

    it("authType 'key' без логина: логин всё равно нужен", () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const config = baseConfig({ authType: 'key', user: '', privateKey: vault.encrypt('key-content') })
        expect(isLoginRequired(config)).toBe(true)
    })
})

describe('applyAuthConfig: данные, введённые в сессии', () => {
    beforeEach(() => {
        vault.unlock(RECOVERY_KEY, SALT)
        vi.clearAllMocks()
    })

    it('пароль из сессии важнее сохранённого в вольте', () => {
        vi.mocked(loadConfig).mockReturnValue(appConfigWithPasswords({ 'srv-1': 'old-pass' }))
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ id: 'srv-1' }), connectConfig, { password: 'new-pass' })
        expect(connectConfig.password).toBe('new-pass')
    })

    it('введённый ключ подключает сервер, даже если authType остался password', () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const plaintext = `synthetic-${crypto.randomBytes(16).toString('hex')}`
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ password: 'pw' }), connectConfig, { privateKey: vault.encrypt(plaintext) })
        expect((connectConfig.privateKey as Buffer).toString('utf8')).toBe(plaintext)
        expect(connectConfig.password).toBeUndefined()
    })

    it('введённый ключ без authType в конфиге не отдаёт пароль', () => {
        vi.mocked(loadConfig).mockReturnValue(appConfigWithPasswords({ 'srv-1': 'old-pass' }))
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ id: 'srv-1' }), connectConfig, { privateKey: vault.encrypt('key-content') })
        expect(connectConfig.privateKey).toBeInstanceOf(Buffer)
        expect(connectConfig.password).toBeUndefined()
    })

    it('зашифрованный ключ без парольной фразы просит её (failure passphrase)', () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const encryptedPem = [
            '-----BEGIN RSA PRIVATE KEY-----',
            'Proc-Type: 4,ENCRYPTED',
            'DEK-Info: AES-128-CBC,0123456789ABCDEF0123456789ABCDEF',
            '',
            'MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu',
            'KUpRKfFLfRYC9AIKjbJTWit+CqvjWYzvQwECAwEAAQJAIL0oy2QAfWO3g8SSSJ',
            '-----END RSA PRIVATE KEY-----'
        ].join('\n')
        const config = baseConfig({ authType: 'key', privateKey: vault.encrypt(encryptedPem) })

        expect(() => applyAuthConfig(config, {})).toThrow(PrivateKeyError)
        try {
            applyAuthConfig(config, {})
        } catch (err) {
            expect((err as PrivateKeyError).failure).toBe('passphrase')
        }
    })

    it('парольная фраза из сессии подставляется в ConnectConfig', () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const encryptedPem = [
            '-----BEGIN RSA PRIVATE KEY-----',
            'Proc-Type: 4,ENCRYPTED',
            'DEK-Info: AES-128-CBC,0123456789ABCDEF0123456789ABCDEF',
            '',
            'MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu',
            'KUpRKfFLfRYC9AIKjbJTWit+CqvjWYzvQwECAwEAAQJAIL0oy2QAfWO3g8SSSJ',
            '-----END RSA PRIVATE KEY-----'
        ].join('\n')
        const config = baseConfig({ authType: 'key', privateKey: vault.encrypt(encryptedPem) })

        const connectConfig: ConnectConfig = {}
        applyAuthConfig(config, connectConfig, { keyPassphrase: 'secret-phrase' })

        expect(connectConfig.passphrase).toBe('secret-phrase')
    })

    it('сохранённая в вольте парольная фраза используется автоматически', () => {
        const appConfig: AppConfig = {
            ...DEFAULT_CONFIG,
            encryptedKeyPassphrases: { 'srv-1': vault.encrypt('stored-phrase') }
        }
        vi.mocked(loadConfig).mockReturnValue(appConfig)
        const encryptedPem = [
            '-----BEGIN ENCRYPTED PRIVATE KEY-----',
            '',
            'MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu',
            '-----END ENCRYPTED PRIVATE KEY-----'
        ].join('\n')
        const config = baseConfig({ id: 'srv-1', authType: 'key', privateKey: vault.encrypt(encryptedPem) })

        const connectConfig: ConnectConfig = {}
        applyAuthConfig(config, connectConfig)

        expect(connectConfig.passphrase).toBe('stored-phrase')
    })

    it('незашифрованный ключ не требует парольной фразы', () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const plaintext = `synthetic-${crypto.randomBytes(16).toString('hex')}`
        const config = baseConfig({ authType: 'key', privateKey: vault.encrypt(plaintext) })

        const connectConfig: ConnectConfig = {}
        applyAuthConfig(config, connectConfig)

        expect(connectConfig.passphrase).toBeUndefined()
    })
})