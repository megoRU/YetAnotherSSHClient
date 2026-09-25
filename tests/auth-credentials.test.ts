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

/**
 * Все значения для проверок генерируются случайно: жёстко заданные в исходниках
 * «пароли», «парольные фразы» и «приватные ключи» сканируются как возможные
 * утёкшие секреты.
 */
function randomValue(prefix: string): string {
    return `${prefix}-${crypto.randomBytes(16).toString('hex')}`
}

/**
 * Синтетический PEM с заголовками passphrase-защиты. Содержимое тела для проверок
 * не используется — важны только заголовки, по которым определяется зашифрованный ключ.
 */
function syntheticEncryptedPem(kind: 'classic' | 'pkcs8'): string {
    const body = crypto.randomBytes(48).toString('base64')
    if (kind === 'pkcs8') {
        return [
            '-----BEGIN ENCRYPTED PRIVATE KEY-----',
            '',
            body,
            '-----END ENCRYPTED PRIVATE KEY-----'
        ].join('\n')
    }
    return [
        '-----BEGIN RSA PRIVATE KEY-----',
        'Proc-Type: 4,ENCRYPTED',
        `DEK-Info: AES-128-CBC,${crypto.randomBytes(16).toString('hex').toUpperCase()}`,
        '',
        body,
        '-----END RSA PRIVATE KEY-----'
    ].join('\n')
}

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
        const config = baseConfig({ authType: 'key', privateKey: vault.encrypt(plaintext), password: randomValue('unused') })

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
        const password = randomValue('pw')
        vi.mocked(loadConfig).mockReturnValue(appConfigWithPasswords({ 'srv-1': password }))
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ id: 'srv-1' }), connectConfig)
        expect(connectConfig.password).toBe(password)
    })

    it('password: без encryptedPasswords использует открытый config.password', () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const password = randomValue('plain')
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ password }), connectConfig)
        expect(connectConfig.password).toBe(password)
    })

    it('password: пробует encryptedPasswords только при совпадении id', () => {
        vi.mocked(loadConfig).mockReturnValue(appConfigWithPasswords({ 'other-id': randomValue('other') }))
        const password = randomValue('fallback')
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ id: 'srv-1', password }), connectConfig)
        expect(connectConfig.password).toBe(password)
    })

    it('password: бросает LocalizedError, если vault не расшифровывает blob', () => {
        vi.mocked(loadConfig).mockReturnValue(appConfigWithPasswords({ 'srv-1': randomValue('pw') }))
        vault.lock()

        expect(() => applyAuthConfig(baseConfig({ id: 'srv-1' }), {})).toThrow(LocalizedError)
    })

    it("authType по умолчанию (password): не требует наличия ключа", () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const password = randomValue('pw')
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ password }), connectConfig)
        expect(connectConfig.password).toBe(password)
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
        vi.mocked(loadConfig).mockReturnValue(appConfigWithPasswords({ 'srv-1': randomValue('pw') }))
        expect(isLoginRequired(baseConfig({ id: 'srv-1', user: '' }))).toBe(true)
    })

    it("authType 'key' без логина: логин всё равно нужен", () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const config = baseConfig({ authType: 'key', user: '', privateKey: vault.encrypt(randomValue('key-content')) })
        expect(isLoginRequired(config)).toBe(true)
    })
})

describe('applyAuthConfig: данные, введённые в сессии', () => {
    beforeEach(() => {
        vault.unlock(RECOVERY_KEY, SALT)
        vi.clearAllMocks()
    })

    it('пароль из сессии важнее сохранённого в вольте', () => {
        vi.mocked(loadConfig).mockReturnValue(appConfigWithPasswords({ 'srv-1': randomValue('old') }))
        const sessionPassword = randomValue('new')
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ id: 'srv-1' }), connectConfig, { password: sessionPassword })
        expect(connectConfig.password).toBe(sessionPassword)
    })

    it('введённый пароль применяется, даже если для сервера настроен ключ (сервер отклонил ключ)', () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const sessionPassword = randomValue('pw')
        const config = baseConfig({
            authType: 'key',
            privateKey: vault.encrypt(`synthetic-${crypto.randomBytes(16).toString('hex')}`)
        })

        const connectConfig: ConnectConfig = {}
        applyAuthConfig(config, connectConfig, { password: sessionPassword })

        expect(connectConfig.password).toBe(sessionPassword)
        expect(connectConfig.privateKey).toBeUndefined()
    })

    it('введённый ключ важнее введённого пароля', () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const plaintext = `synthetic-${crypto.randomBytes(16).toString('hex')}`
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ password: randomValue('pw') }), connectConfig, {
            password: randomValue('session'),
            privateKey: vault.encrypt(plaintext)
        })
        expect((connectConfig.privateKey as Buffer).toString('utf8')).toBe(plaintext)
        expect(connectConfig.password).toBeUndefined()
    })

    it('введённый ключ подключает сервер, даже если authType остался password', () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const plaintext = `synthetic-${crypto.randomBytes(16).toString('hex')}`
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ password: randomValue('pw') }), connectConfig, { privateKey: vault.encrypt(plaintext) })
        expect((connectConfig.privateKey as Buffer).toString('utf8')).toBe(plaintext)
        expect(connectConfig.password).toBeUndefined()
    })

    it('введённый ключ без authType в конфиге не отдаёт пароль', () => {
        vi.mocked(loadConfig).mockReturnValue(appConfigWithPasswords({ 'srv-1': randomValue('old') }))
        const connectConfig: ConnectConfig = {}
        applyAuthConfig(baseConfig({ id: 'srv-1' }), connectConfig, { privateKey: vault.encrypt(randomValue('key-content')) })
        expect(connectConfig.privateKey).toBeInstanceOf(Buffer)
        expect(connectConfig.password).toBeUndefined()
    })

    it('зашифрованный ключ без парольной фразы просит её (failure passphrase)', () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const config = baseConfig({ authType: 'key', privateKey: vault.encrypt(syntheticEncryptedPem('classic')) })

        expect(() => applyAuthConfig(config, {})).toThrow(PrivateKeyError)
        try {
            applyAuthConfig(config, {})
        } catch (err) {
            expect((err as PrivateKeyError).failure).toBe('passphrase')
        }
    })

    it('парольная фраза из сессии подставляется в ConnectConfig', () => {
        vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG })
        const config = baseConfig({ authType: 'key', privateKey: vault.encrypt(syntheticEncryptedPem('classic')) })
        const passphrase = randomValue('phrase')

        const connectConfig: ConnectConfig = {}
        applyAuthConfig(config, connectConfig, { keyPassphrase: passphrase })

        expect(connectConfig.passphrase).toBe(passphrase)
    })

    it('сохранённая в вольте парольная фраза используется автоматически', () => {
        const storedPassphrase = randomValue('stored')
        const appConfig: AppConfig = {
            ...DEFAULT_CONFIG,
            encryptedKeyPassphrases: { 'srv-1': vault.encrypt(storedPassphrase) }
        }
        vi.mocked(loadConfig).mockReturnValue(appConfig)
        const config = baseConfig({
            id: 'srv-1',
            authType: 'key',
            privateKey: vault.encrypt(syntheticEncryptedPem('pkcs8'))
        })

        const connectConfig: ConnectConfig = {}
        applyAuthConfig(config, connectConfig)

        expect(connectConfig.passphrase).toBe(storedPassphrase)
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