import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'
import { app, safeStorage } from 'electron'
import { AppConfig } from './types.js'
import { vault } from './vault.js'

/** Путь к файлу конфигурации в домашней директории пользователя */
export const configPath = path.join(os.homedir(), '.minissh_config.json')

/** Конфигурация по умолчанию */
export const DEFAULT_CONFIG: AppConfig = {
    terminalFontName: 'JetBrains Mono',
    terminalFontSize: 17,
    uiFontName: 'JetBrains Mono',
    uiFontSize: 13,
    theme: 'Auto',
    language: 'ru',
    x: 353,
    y: 141,
    width: 1277,
    height: 911,
    maximized: false,
    lastUpdateCheck: 0,
    enableTerminalContextMenu: false,
    terminalScrollSensitivity: 2,
    keywordHighlighting: true,
    sftpSoundEnabled: true,
    sftpSoundVolume: 0.5,
    sftpFlashIcon: true,
    activeTabColorEnabled: false,
    alwaysShowHoverOnInactiveTabs: false,
    serverCardSize: 'standard',
    isOnboardingCompleted: false,
    hasAcknowledgedRecoveryKey: false,
    sidebarEnabled: false,
    sidebarPosition: 'left',
    fileAssociations: {},
    favorites: []
}

let cachedConfig: AppConfig | null = null
let saveQueue: Promise<void> = Promise.resolve()

function readLegacyFavorites(data: Record<string, unknown>): SSHConfig[] | null {
    const possibleKeys = ['favorites', 'servers', 'connections', 'sshConfigs']

    for (const key of possibleKeys) {
        const value = data[key]
        if (Array.isArray(value)) {
            return value as SSHConfig[]
        }
    }

    return null
}

function normalizeConfigData(data: unknown): Record<string, unknown> {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return {}
    }

    const normalizedData = data as Record<string, unknown>
    const legacyFavorites = readLegacyFavorites(normalizedData)
    if (legacyFavorites !== null) {
        normalizedData.favorites = legacyFavorites
    }

    return normalizedData
}


/**
 * Очищает кэш конфигурации, заставляя следующий вызов loadConfig прочитать файл с диска.
 */
export function clearConfigCache(): void {
    cachedConfig = null
}

/**
 * Загружает конфигурацию из файла.
 * Если файл не существует или поврежден, возвращает конфигурацию по умолчанию.
 *
 * @returns {AppConfig} Объект конфигурации приложения.
 */
export function loadConfig(): AppConfig {
    if (cachedConfig) return cachedConfig

    let config: AppConfig
    if (!fs.existsSync(configPath)) {
        config = { ...DEFAULT_CONFIG }
        // При первом запуске пытаемся определить язык системы
        try {
            const locale = app.getLocale().split('-')[0]
            if (locale === 'ru' || locale === 'en') {
                config.language = locale
            }
        } catch (e) {
            console.error('[Config] Failed to get system locale:', e)
        }
    } else {
        try {
            const rawData = fs.readFileSync(configPath, 'utf-8')
            const rawConfigData = JSON.parse(rawData)
            const data = normalizeConfigData(rawConfigData)

            // Если конфиг уже существует, но поле isOnboardingCompleted отсутствует (старая версия),
            // считаем, что пользователь уже настроил приложение.
            if (data && data.isOnboardingCompleted === undefined) {
                data.isOnboardingCompleted = true
            }
            config = { ...DEFAULT_CONFIG, ...data }
            if (!config.fileAssociations || typeof config.fileAssociations !== 'object' || Array.isArray(config.fileAssociations)) {
                config.fileAssociations = {}
            }

            // 1. Инициализация соли если её нет
            if (!config.encryption) {
                config.encryption = {
                    version: 1,
                    salt: crypto.randomBytes(16).toString('base64')
                }
            }

            // 2. Попытка авто-разблокировки
            if (config.cachedRecoveryKey && safeStorage.isEncryptionAvailable()) {
                try {
                    const recoveryKey = safeStorage.decryptString(Buffer.from(config.cachedRecoveryKey, 'base64'))
                    vault.unlock(recoveryKey, config.encryption.salt)
                } catch (e) {
                    console.error('[Config] Auto-unlock failed:', e)
                }
            }

            // 3. Миграция паролей в Vault
            let needsReSave = false
            if (!config.encryptedPasswords) config.encryptedPasswords = {}

            if (config.favorites && Array.isArray(config.favorites)) {
                for (const fav of config.favorites) {
                    // Гарантируем наличие ID
                    if (!fav.id) {
                        fav.id = crypto.randomUUID();
                        needsReSave = true;
                    }

                    // Если пароль ещё в favorites, значит нужна миграция
                    if (fav.password) {
                        // Определяем старый формат и расшифровываем
                        let decrypted = ''
                        if (safeStorage.isEncryptionAvailable()) {
                            try {
                                decrypted = safeStorage.decryptString(Buffer.from(fav.password, 'base64'))
                            } catch {
                                try { decrypted = Buffer.from(fav.password, 'base64').toString('utf8') } catch { /* fail */ }
                            }
                        } else {
                            try { decrypted = Buffer.from(fav.password, 'base64').toString('utf8') } catch { /* fail */ }
                        }

                        if (decrypted) {
                            // Если вольт заблокирован (первая миграция), создаем новый ключ
                            if (!vault.isUnlocked()) {
                                const newKey = crypto.randomBytes(32).toString('base64')
                                vault.unlock(newKey, config.encryption.salt)
                                if (safeStorage.isEncryptionAvailable()) {
                                    config.cachedRecoveryKey = safeStorage.encryptString(newKey).toString('base64')
                                }
                            }

                            config.encryptedPasswords[fav.id] = vault.encrypt(decrypted)
                            delete fav.password
                            needsReSave = true
                        }
                    }
                }
            }

            if (needsReSave) {
                saveConfig(config)
            }
        } catch {
            config = { ...DEFAULT_CONFIG }
        }
    }

    cachedConfig = config
    return config
}

/**
 * Асинхронно загружает конфигурацию из файла.
 */
export async function loadConfigAsync(): Promise<AppConfig> {
    if (cachedConfig) return cachedConfig
    return loadConfig()
}

/**
 * Сохраняет конфигурацию в файл.
 *
 * @param {AppConfig} config - Объект конфигурации для сохранения.
 */
export function saveConfig(config: AppConfig): void {
    // Клонируем конфиг
    const configToSave = JSON.parse(JSON.stringify(config)) as AppConfig

    // Гарантируем, что в favorites нет паролей
    if (configToSave.favorites && Array.isArray(configToSave.favorites)) {
        for (const fav of configToSave.favorites) {
            delete fav.password
        }
    }

    cachedConfig = config
    fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2))
}

/**
 * Асинхронно и атомарно сохраняет конфигурацию в файл.
 * Записи сериализуются через очередь, чтобы избежать гонок и порчи файла.
 */
export async function saveConfigAsync(config: AppConfig): Promise<void> {
    const configToSave = JSON.parse(JSON.stringify(config)) as AppConfig
    if (configToSave.favorites && Array.isArray(configToSave.favorites)) {
        for (const favorite of configToSave.favorites) {
            delete favorite.password
        }
    }

    cachedConfig = config

    const writeOperation = async (): Promise<void> => {
        const directoryPath = path.dirname(configPath)
        const tempFileName = `.minissh_config.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
        const tempFilePath = path.join(directoryPath, tempFileName)
        const fileContents = JSON.stringify(configToSave, null, 2)

        let fileHandle: fs.promises.FileHandle | null = null
        try {
            fileHandle = await fs.promises.open(tempFilePath, 'w')
            await fileHandle.writeFile(fileContents, 'utf-8')
            await fileHandle.sync()
            await fileHandle.close()
            fileHandle = null
            await fs.promises.rename(tempFilePath, configPath)
        } finally {
            if (fs.existsSync(tempFilePath)) {
                try {
                    await fs.promises.unlink(tempFilePath)
                } catch {
                    // ignore cleanup error
                }
            }
        }
    }

    saveQueue = saveQueue.then(writeOperation, writeOperation)
    await saveQueue
}
