import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { VaultService } from '../electron/src/vault.js'
import type { AppConfig, SSHConfig } from '../src/types.js'

/**
 * Регрессия: после восстановления конфига из бэкапа ключ шифрования не
 * «приживается» с первого же запуска — приложение просит его снова.
 *
 * Сценарий проигрывается целиком на настоящих IPC-хендлерах main-процесса
 * (import-config → перезапуск → vault-unlock → save-config из UI → перезапуск).
 * «Перезапуск» — свежие экземпляры модулей (vi.resetModules) при том же файле
 * конфига на диске: именно так ведёт себя новый запуск приложения.
 *
 * Состояние лежит в globalThis, а не в замыкании теста: vi.resetModules
 * пересоздаёт и моки, и импортированные модули, а каталог конфига и реестр
 * IPC-хендлеров должны пережить «перезапуск» без изменений.
 */

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

interface TestEnv {
    home: string
    dialogPaths: string[]
    safeStorageAvailable: boolean
    handlers: Map<string, IpcHandler>
    listeners: Map<string, IpcHandler>
}

vi.hoisted(() => {
    ;(globalThis as unknown as { __yashRecoveryKeyEnv?: TestEnv }).__yashRecoveryKeyEnv = {
        home: '',
        dialogPaths: [],
        safeStorageAvailable: true,
        handlers: new Map(),
        listeners: new Map()
    }
})

const env = (globalThis as unknown as { __yashRecoveryKeyEnv: TestEnv }).__yashRecoveryKeyEnv

// Конфиг пользователя не должен затрагиваться: подменяем домашнюю директорию
// на временную (как в config-client-id.test.ts). Каталог создаётся один раз и
// переживает vi.resetModules, иначе «перезапуск» терял бы файл конфига.
vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>()
    const fsMod = await import('node:fs')
    const pathMod = await import('node:path')
    const state = (globalThis as unknown as { __yashRecoveryKeyEnv: TestEnv }).__yashRecoveryKeyEnv
    if (!state.home) {
        state.home = fsMod.mkdtempSync(pathMod.join(actual.tmpdir(), 'yash-recovery-cache-'))
    }
    return {
        ...actual,
        homedir: () => (globalThis as unknown as { __yashRecoveryKeyEnv: TestEnv }).__yashRecoveryKeyEnv.home
    }
})

vi.mock('electron', () => {
    const state = (globalThis as unknown as { __yashRecoveryKeyEnv: TestEnv }).__yashRecoveryKeyEnv

    const api = {
        ipcMain: {
            handle: (channel: string, fn: IpcHandler) => { state.handlers.set(channel, fn) },
            on: (channel: string, fn: IpcHandler) => { state.listeners.set(channel, fn) },
            once: (channel: string, fn: IpcHandler) => { state.listeners.set(channel, fn) },
            removeListener: () => undefined
        },
        app: {
            getLocale: () => 'ru-RU',
            getVersion: () => '3.1.7',
            getPath: () => state.home
        },
        safeStorage: {
            isEncryptionAvailable: () => state.safeStorageAvailable,
            // Заглушка «шифрования ОС»: нужен побайтовый round-trip, иначе
            // неверный ключ мог бы пройти проверку encryption.check.
            encryptString: (value: string) => Buffer.from(value, 'utf8'),
            decryptString: (value: Buffer) => value.toString('utf8')
        },
        dialog: {
            showErrorBox: () => undefined,
            showOpenDialog: () => ({ canceled: state.dialogPaths.length === 0, filePaths: [...state.dialogPaths] }),
            showSaveDialog: () => ({ canceled: true, filePath: undefined }),
            showMessageBox: () => ({ response: 0 })
        },
        clipboard: { readText: () => '' },
        shell: { openExternal: () => Promise.resolve() },
        BrowserWindow: class { static getAllWindows() { return [] } },
        screen: { getAllDisplays: () => [] },
        powerSaveBlocker: { start: () => 1 }
    }

    return { ...api, default: api }
})

vi.mock('electron-updater', () => {
    const autoUpdater = {
        autoDownload: false,
        logger: null,
        on: () => undefined,
        checkForUpdates: () => Promise.resolve(null),
        downloadUpdate: () => Promise.resolve([]),
        quitAndInstall: () => undefined
    }
    return { default: { autoUpdater }, autoUpdater }
})

const CONFIG_FILE_NAME = '.minissh_config.json'
const BACKUP_FILE_NAME = 'backup.json'

interface MainWorld {
    invoke: (channel: string, payload?: unknown) => Promise<unknown>
    sendSync: (channel: string) => unknown
    loadConfig: () => AppConfig
    initializeVaultAndMigrate: (config: AppConfig) => Promise<void>
    isVaultUnlocked: () => boolean
    readConfigFile: () => AppConfig
}

/**
 * IPC в Electron передаёт значения через structured clone: рендерер получает
 * отсоединённую копию и не может влиять на объекты main-процесса. Без клона
 * тест незаметно делил бы объект конфига с main и не воспроизвёл бы баг.
 */
function cloneIpcValue<T>(value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T
}

/**
 * «Запуск приложения»: свежие модули main-процесса, все IPC-хендлеры
 * зарегистрированы заново (как в electron/main.ts), файл конфига тот же.
 */
async function launchApp(): Promise<MainWorld> {
    vi.resetModules()
    env.handlers.clear()
    env.listeners.clear()

    const { registerIpcHandlers } = await import('../electron/src/ipc-handlers.js')
    const configModule = await import('../electron/src/config.js')
    const vaultModule = await import('../electron/src/vault.js')

    registerIpcHandlers(() => null)

    const requireHandler = (channel: string): IpcHandler => {
        const handler = env.handlers.get(channel) ?? env.listeners.get(channel)
        if (!handler) throw new Error(`IPC-хендлер '${channel}' не зарегистрирован`)
        return handler
    }

    return {
        invoke: async (channel, payload) => requireHandler(channel)(
            { sender: { id: 1, isDestroyed: () => false, send: () => undefined } },
            cloneIpcValue(payload)
        ),
        sendSync: (channel) => {
            const event: { returnValue: unknown } = { returnValue: undefined }
            const result = requireHandler(channel)(event)
            return cloneIpcValue(event.returnValue ?? result)
        },
        loadConfig: configModule.loadConfig,
        initializeVaultAndMigrate: configModule.initializeVaultAndMigrate,
        isVaultUnlocked: () => vaultModule.vault.isUnlocked(),
        readConfigFile: () => JSON.parse(fs.readFileSync(path.join(env.home, CONFIG_FILE_NAME), 'utf-8')) as AppConfig
    }
}

/** Готовый «экспорт» конфига: с зашифрованными секретами и кэшем ключа машины-источника. */
function buildBackup(recoveryKey: string, salt: string, foreign: VaultService): AppConfig {
    const favorites: SSHConfig[] = [
        {
            id: 'srv-1',
            name: 'backup-server',
            user: 'root',
            host: 'backup.example.com',
            port: 22,
            authType: 'key',
            privateKey: foreign.encrypt('synthetic-key-material'),
            osPrettyName: 'Ubuntu 24.04 LTS'
        }
    ]

    return {
        terminalFontName: 'JetBrains Mono',
        terminalFontSize: 17,
        uiFontName: 'Inter',
        uiFontSize: 13,
        theme: 'Dark',
        language: 'ru',
        x: 100,
        y: 100,
        width: 1200,
        height: 800,
        maximized: false,
        lastUpdateCheck: 0,
        enableTerminalContextMenu: true,
        terminalScrollSensitivity: 2,
        keywordHighlighting: true,
        sftpSoundEnabled: true,
        sftpSoundVolume: 0.5,
        sftpFlashIcon: true,
        activeTabColorEnabled: false,
        alwaysShowHoverOnInactiveTabs: false,
        serverCardSize: 'standard',
        isOnboardingCompleted: true,
        sidebarEnabled: false,
        sidebarPosition: 'left',
        fileAssociations: {},
        mcpEnabled: false,
        mcpPort: 3000,
        mcpToken: 'backup-token',
        mcpRequireConfirmation: true,
        mcpAllowedServerIds: [],
        clientId: '',
        hasAcknowledgedRecoveryKey: true,
        // Экспорт с исходной машины содержит её кэш ключа; импорт обязан его отбросить.
        cachedRecoveryKey: Buffer.from(recoveryKey, 'utf8').toString('base64'),
        encryption: {
            version: 1,
            salt,
            check: foreign.encrypt('YASSH_VAULT_VERIFY')
        },
        encryptedPasswords: { 'srv-1': foreign.encrypt('backup-password') },
        favorites
    }
}

function writeBackup(config: AppConfig): void {
    fs.writeFileSync(path.join(env.home, BACKUP_FILE_NAME), JSON.stringify(config, null, 2), 'utf-8')
    env.dialogPaths = [path.join(env.home, BACKUP_FILE_NAME)]
}

/** Кэш ключа, который main-процесс записывает после успешного vault-unlock. */
function cachedRecoveryKeyOnDisk(app: MainWorld): string | undefined {
    return app.readConfigFile().cachedRecoveryKey
}

/**
 * Каталог конфига создаётся фабрикой мока node:os, а она выполняется при первом
 * обращении к node:os. До этого момента env.home пуст, и path.join(env.home, …)
 * дал бы путь относительно рабочего каталога — то есть запись в корень репозитория.
 */
async function ensureTestHome(): Promise<void> {
    if (!env.home) {
        await import('node:os')
    }
    if (!env.home) {
        throw new Error('временный каталог конфига не создан')
    }
}

beforeEach(async () => {
    await ensureTestHome()
    fs.rmSync(path.join(env.home, CONFIG_FILE_NAME), { force: true })
    fs.rmSync(path.join(env.home, BACKUP_FILE_NAME), { force: true })
    env.dialogPaths = []
    env.safeStorageAvailable = true
})

afterAll(() => {
    fs.rmSync(env.home, { recursive: true, force: true })
})

describe('восстановление конфига из бэкапа: сохранение ключа шифрования', () => {
    it('ключ, введённый после восстановления, переживает сохранение конфига из UI и распознаётся при следующем запуске', async () => {
        const recoveryKey = crypto.randomBytes(32).toString('base64')
        const salt = crypto.randomBytes(16).toString('base64')
        // Хранилище бэкапа открыто тем же ключом, который потом введёт пользователь.
        const source = new VaultService()
        source.unlock(recoveryKey, salt)

        // ── Шаг 1. Восстановление конфига из бэкапа ──────────────────────────────
        writeBackup(buildBackup(recoveryKey, salt, source))

        let app = await launchApp()
        const importResult = await app.invoke('import-config') as { config: AppConfig }
        expect(importResult.config).toBeTruthy()
        // Кэш ключа машины-источника импорт обязан отбросить.
        expect(cachedRecoveryKeyOnDisk(app)).toBeUndefined()

        // UI после импорта сохраняет полученный конфиг (setConfig в SettingsView).
        await app.invoke('save-config', importResult.config)
        // Сохранение из UI не имеет права воскресить кэш машины-источника.
        expect(cachedRecoveryKeyOnDisk(app)).toBeUndefined()

        // ── Шаг 2. Перезапуск: вольт закрыт, приложение просит ключ ─────────────
        app = await launchApp()
        const restored = app.loadConfig()
        await app.initializeVaultAndMigrate(restored)
        expect(app.isVaultUnlocked()).toBe(false)
        expect(cachedRecoveryKeyOnDisk(app)).toBeUndefined()

        // Снимок конфига, который рендерер держит всю сессию (getConfigSync на старте).
        const rendererSnapshot = app.sendSync('get-config-sync') as AppConfig
        expect(rendererSnapshot.cachedRecoveryKey).toBeUndefined()

        // ── Шаг 3. Пользователь вводит ключ шифрования ─────────────────────────
        expect(await app.invoke('vault-unlock', recoveryKey)).toBe(true)
        expect(app.isVaultUnlocked()).toBe(true)
        expect(cachedRecoveryKeyOnDisk(app)).toBeDefined()

        // ── Шаг 4. Пользователь продолжает работу: UI меняет настройку и
        //          пересохраняет конфиг из своего снимка ─────────────────────────
        await app.invoke('save-config', { ...rendererSnapshot, theme: 'Light', terminalFontSize: 18 })

        // Кэш ключа принадлежит main-процессу и не должен исчезнуть из-за снимка UI.
        expect(cachedRecoveryKeyOnDisk(app)).toBeDefined()

        // ── Шаг 5. Полный перезапуск: ключ распознаётся, повторного ввода нет ───
        app = await launchApp()
        const afterRestart = app.loadConfig()
        await app.initializeVaultAndMigrate(afterRestart)
        expect(app.isVaultUnlocked()).toBe(true)
    })

    it('рендерер не может подменить кэш ключа восстановления', async () => {
        const recoveryKey = crypto.randomBytes(32).toString('base64')
        const salt = crypto.randomBytes(16).toString('base64')
        const source = new VaultService()
        source.unlock(recoveryKey, salt)

        // Чистая установка с известным ключом: кэша на диске ещё нет.
        const config = buildBackup(recoveryKey, salt, source)
        delete config.cachedRecoveryKey
        fs.writeFileSync(path.join(env.home, CONFIG_FILE_NAME), JSON.stringify(config, null, 2), 'utf-8')

        const app = await launchApp()
        const restored = app.loadConfig()
        await app.initializeVaultAndMigrate(restored)
        expect(app.isVaultUnlocked()).toBe(false)

        // Кэш появляется только через vault-unlock — легитимный путь main-процесса.
        expect(await app.invoke('vault-unlock', recoveryKey)).toBe(true)
        const cachedBefore = cachedRecoveryKeyOnDisk(app)
        expect(cachedBefore).toBeDefined()

        // Попытка подсунуть свой кэш через снимок конфига из UI игнорируется.
        const forged = Buffer.from('чужой-ключ', 'utf8').toString('base64')
        await app.invoke('save-config', { ...app.loadConfig(), cachedRecoveryKey: forged, theme: 'Light' })

        expect(cachedRecoveryKeyOnDisk(app)).toBe(cachedBefore)
    })

    it('при недоступном safeStorage импорт и ввод ключа не оставляют кэш ключа', async () => {
        env.safeStorageAvailable = false

        const recoveryKey = crypto.randomBytes(32).toString('base64')
        const salt = crypto.randomBytes(16).toString('base64')
        const source = new VaultService()
        source.unlock(recoveryKey, salt)

        writeBackup(buildBackup(recoveryKey, salt, source))

        const app = await launchApp()
        const importResult = await app.invoke('import-config') as { config: AppConfig }
        await app.invoke('save-config', importResult.config)

        expect(await app.invoke('vault-unlock', recoveryKey)).toBe(true)
        expect(cachedRecoveryKeyOnDisk(app)).toBeUndefined()
    })
})
