import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'
import {app, safeStorage} from 'electron'
import {AppConfig, EncryptedSecret, SSHConfig} from '../../src/types.js'
import {vault} from './vault.js'
import {isSupportedPrivateKeyFormat, stripPlaintextPrivateKeys, tryDecryptEncryptedSecret} from './private-key.js'

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
    mcpEnabled: false,
    mcpPort: 3000,
    mcpToken: crypto.randomBytes(16).toString('hex'),
    mcpRequireConfirmation: true,
    mcpAllowedServerIds: [],
    clientId: '',
    favorites: []
}

let cachedConfig: AppConfig | null = null
let saveQueue: Promise<void> = Promise.resolve()

/** Поля SSHConfig, которые переносятся из favorites в зашифрованное хранилище. */
export type FavoriteSecretField = 'password' | 'keyPassphrase';

/**
 * Переносит секреты из favorites в зашифрованное хранилище.
 *
 * Поле `password`/`keyPassphrase` присутствует в favorite только когда секрет пришёл
 * из формы подключения или из ввода при авторизации: пустая строка означает
 * «секрет удалён», отсутствие ключа — «секрет не менялся» (например, конфиг загружен
 * с диска или обновлён из настроек). При закрытом хранилище непустой секрет остаётся
 * в поле и будет срезан перед записью на диск, как и раньше.
 *
 * @param {SSHConfig[]} favorites - Избранные серверы (обновляются на месте).
 * @param {'password' | 'keyPassphrase'} field - Поле, из которого берётся секрет.
 * @param {Record<string, EncryptedSecret>} store - Зашифрованные секреты по id сервера.
 * @param {boolean} isVaultUnlocked - Открыто ли хранилище.
 * @param {(value: string) => EncryptedSecret} encrypt - Шифрование значения секрета.
 */
export function syncFavoritesSecrets(
    favorites: SSHConfig[],
    field: FavoriteSecretField,
    store: Record<string, EncryptedSecret>,
    isVaultUnlocked: boolean,
    encrypt: (value: string) => EncryptedSecret
): void {
    for (const fav of favorites) {
        if (!fav.id || typeof fav[field] !== 'string') continue
        const secret = fav[field]
        if (secret === '') {
            delete store[fav.id]
            delete fav[field]
            continue
        }
        if (isVaultUnlocked) {
            store[fav.id] = encrypt(secret)
            delete fav[field]
        }
    }
}

/**
 * Кэш ключа восстановления принадлежит исключительно main-процессу.
 *
 * Его записывают только vault-init / vault-unlock / vault-regenerate-key /
 * vault-reset и авто-разблокировка в initializeVaultAndMigrate. Рендерер берёт
 * конфиг снимком (getConfigSync) ДО разблокировки вольта, поэтому в его снимке
 * этого поля нет. Если позволить рендереру перезаписывать конфиг целиком, любое
 * его сохранение (смена темы или шрифта, обновление osPrettyName сервера,
 * изменение настроек SFTP) удалит кэш — и при следующем запуске приложение снова
 * запросит ключ шифрования. Особенно заметно после восстановления конфига из
 * бэкапа: импорт намеренно отбрасывает кэш машины-источника, поэтому первый
 * введённый ключ и должен пережить всю сессию.
 *
 * Присваивание безусловное: рендерер не может ни подменить, ни выдумать это
 * поле, а main при необходимости удалит его сам (vault-reset без safeStorage).
 *
 * @param {AppConfig} config - Конфиг, пришедший из рендерера; поле перезаписывается на месте.
 * @param {AppConfig} vaultConfig - Актуальный конфиг main-процесса (loadConfig()).
 */
export function preserveCachedRecoveryKey(config: AppConfig, vaultConfig: AppConfig): void {
    config.cachedRecoveryKey = vaultConfig.cachedRecoveryKey
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
 * После загрузки поле clientId всегда существует: для старых конфигов (без clientId)
 * он генерируется один раз (crypto.randomUUID) и сразу фиксируется на диске, чтобы
 * идентификатор оставался стабильным между запусками.
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
            const data = JSON.parse(rawData)

            // Если конфиг уже существует, но поле isOnboardingCompleted отсутствует (старая версия),
            // считаем, что пользователь уже настроил приложение.
            if (data && data.isOnboardingCompleted === undefined) {
                data.isOnboardingCompleted = true
            }
            config = { ...DEFAULT_CONFIG, ...data }
            if (!config.fileAssociations || typeof config.fileAssociations !== 'object' || Array.isArray(config.fileAssociations)) {
                config.fileAssociations = {}
            }
            if (config.mcpEnabled === undefined) config.mcpEnabled = false
            if (!config.mcpPort) config.mcpPort = 3000
            if (!config.mcpToken) config.mcpToken = crypto.randomBytes(16).toString('hex')
            if (config.mcpRequireConfirmation === undefined) config.mcpRequireConfirmation = true
            if (!Array.isArray(config.mcpAllowedServerIds)) config.mcpAllowedServerIds = []
        } catch {
            config = { ...DEFAULT_CONFIG }
        }
    }

    // clientId всегда существует после загрузки: генерируем один раз и сразу
    // персистим, чтобы не потерять его при последующих перезапусках.
    if (!config.clientId) {
        config.clientId = crypto.randomUUID()
        try {
            saveConfig(config)
        } catch (e) {
            console.warn('[Config] Failed to persist clientId:', e)
        }
    }

    cachedConfig = config
    return config
}

let isVaultInitialized = false

/**
 * Миграция legacy privateKeyPath -> зашифрованный privateKey.
 *
 * Асинхронная (не блокирует main process файловым I/O), безопасная и идемпотентная:
 * - путь есть + blob уже существует: путь удаляется только если blob реально расшифровывается;
 * - путь есть + blob нет: read -> validate -> encrypt -> verify -> delete path; при ошибке/
 *   инвалидном содержимом/несошедшейся проверке путь сохраняется (fallback) и файл на диске
 *   никогда не удаляется;
 * - `privateKeyPath` не удаляется, пока зашифрованный blob гарантированно не создан и не расшифрован;
 * - повторный запуск после успеха не делает никакой работы;
 * - частично повреждённые записи favorites (не объекты) пропускаются без срыва миграции.
 */
export async function migratePrivateKeyPaths(config: AppConfig): Promise<boolean> {
    if (!vault.isUnlocked()) return false
    if (!config.favorites || !Array.isArray(config.favorites)) return false

    let changed = false
    for (const fav of config.favorites) {
        if (typeof fav !== 'object' || fav === null) continue
        if (!fav.privateKeyPath) continue

        if (fav.privateKey) {
            if (tryDecryptEncryptedSecret(fav.privateKey) !== null) {
                delete fav.privateKeyPath
                changed = true
            }
            continue
        }

        try {
            const content = await fs.promises.readFile(fav.privateKeyPath, 'utf-8')
            if (!isSupportedPrivateKeyFormat(content)) {
                console.warn(`[Config] Skipped migration of invalid private key for server ${fav.id || fav.host}`)
                continue
            }
            const encrypted = vault.encrypt(content)
            // Гарантируем round-trip: blob создан и реально расшифровывается текущим vault.
            if (vault.decrypt(encrypted) !== content) {
                delete fav.privateKey
                continue
            }
            fav.privateKey = encrypted
            delete fav.privateKeyPath
            changed = true
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.warn(`[Config] Failed to migrate private key for server ${fav.id || fav.host}: ${message}`)
        }
    }

    return changed
}

/**
 * Выполняет тяжелую инициализацию хранилища (соль, авторазблокировка) в фоне.
 *
 * Остаётся защищённой process-wide guard-ом `isVaultInitialized`: тяжёлая работа
 * (и миграция) происходит только один раз за запуск, повторные вызовы — no-op.
 * Вся синхронная часть (инициализация соли и авторазблокировка vault) выполняется
 * до первого `await`, поэтому вызов без `await` (например, из sync-кода подключения)
 * по-прежнему синхронно открывает vault, а миграция завершается в фоне.
 */
export async function initializeVaultAndMigrate(config: AppConfig): Promise<void> {
    if (isVaultInitialized) return
    isVaultInitialized = true

    try {
        let needsReSave = false

        // 1. Инициализация соли если её нет
        if (!config.encryption) {
            config.encryption = {
                version: 1,
                salt: crypto.randomBytes(16).toString('base64')
            }
            needsReSave = true
        }

        // 2. Попытка авто-разблокировки
        if (config.cachedRecoveryKey && safeStorage.isEncryptionAvailable()) {
            try {
                const recoveryKey = safeStorage.decryptString(Buffer.from(config.cachedRecoveryKey, 'base64'))
                vault.unlock(recoveryKey, config.encryption.salt)

                let isValidKey = true
                if (config.encryption.check) {
                    try {
                        const checkVal = vault.decrypt(config.encryption.check)
                        if (checkVal !== 'YASSH_VAULT_VERIFY') isValidKey = false
                    } catch {
                        isValidKey = false
                    }
                } else {
                    const firstEncrypted = Object.values(config.encryptedPasswords || {})[0]
                    if (firstEncrypted) {
                        try {
                            vault.decrypt(firstEncrypted)
                        } catch {
                            isValidKey = false
                        }
                    }
                }

                if (!isValidKey) {
                    vault.lock()
                    delete config.cachedRecoveryKey
                    needsReSave = true
                }
            } catch (e) {
                console.error('[Config] Auto-unlock failed:', e)
            }
        }

        if (await migratePrivateKeyPaths(config)) {
            needsReSave = true
        }

        if (!config.encryptedPasswords) {
            config.encryptedPasswords = {}
            needsReSave = true
        }

        if (config.favorites && Array.isArray(config.favorites)) {
            for (const fav of config.favorites) {
                // Гарантируем наличие ID
                if (!fav.id) {
                    fav.id = crypto.randomUUID()
                    needsReSave = true
                }
            }
        }

        if (needsReSave) {
            saveConfig(config)
        }
    } catch (e) {
        console.error('[Config] Background vault initialization failed:', e)
    }
}

/**
 * Асинхронно загружает конфигурацию из файла.
 */
export async function loadConfigAsync(): Promise<AppConfig> {
    if (cachedConfig) return cachedConfig
    return loadConfig()
}

/**
 * Защищает от потери clientId при сохранении конфигурации извне
 * (например, из renderer или импортированной копии): пустой clientId
 * заменяется на уже существующий в памяти или на вновь сгенерированный.
 *
 * Возвращает итоговый clientId, чтобы вызывающий код синхронизировал его
 * и с кэшем в памяти, а не только на диске.
 *
 * @param {AppConfig} configToSave - Снапшот конфигурации, уходящий на диск.
 * @returns {string} Гарантированно непустой clientId.
 */
function ensureConfigClientId(configToSave: AppConfig): string {
    if (!configToSave.clientId) {
        configToSave.clientId = cachedConfig?.clientId || crypto.randomUUID()
    }
    return configToSave.clientId
}

/**
 * Сохраняет конфигурацию в файл.
 *
 * @param {AppConfig} config - Объект конфигурации для сохранения.
 */
export function saveConfig(config: AppConfig): void {
    // Клонируем конфиг
    const configToSave = JSON.parse(JSON.stringify(config)) as AppConfig

    // Сохраняем стабильный clientId даже для внешних копий без него и
    // синхронизируем его с кэшем в памяти, чтобы не потерять при сохранении
    config.clientId = ensureConfigClientId(configToSave)

    // Гарантируем, что в favorites нет паролей, парольных фраз и open private key
    if (configToSave.favorites && Array.isArray(configToSave.favorites)) {
        for (const fav of configToSave.favorites) {
            delete fav.password
            delete fav.keyPassphrase
        }
        stripPlaintextPrivateKeys(configToSave.favorites)
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

    // Сохраняем стабильный clientId даже для внешних копий без него и
    // синхронизируем его с кэшем в памяти, чтобы не потерять при сохранении
    config.clientId = ensureConfigClientId(configToSave)

    if (configToSave.favorites && Array.isArray(configToSave.favorites)) {
        for (const favorite of configToSave.favorites) {
            delete favorite.password
            delete favorite.keyPassphrase
        }
        stripPlaintextPrivateKeys(configToSave.favorites)
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
