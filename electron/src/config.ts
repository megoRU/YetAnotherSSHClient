import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { AppConfig } from './types.js'

/** Путь к файлу конфигурации в домашней директории пользователя */
export const configPath = path.join(os.homedir(), '.minissh_config.json')

/** Конфигурация по умолчанию */
export const DEFAULT_CONFIG: AppConfig = {
    terminalFontName: 'JetBrains Mono',
    terminalFontSize: 17,
    uiFontName: 'JetBrains Mono',
    uiFontSize: 12,
    theme: 'Auto',
    language: 'ru',
    favorites: [],
    x: 353,
    y: 141,
    width: 1254,
    height: 909,
    maximized: false,
    lastUpdateCheck: 0,
    enableTerminalContextMenu: false,
    terminalScrollSensitivity: 2,
    keywordHighlighting: true,
    sftpSoundEnabled: true,
    sftpSoundVolume: 0.5,
    sftpFlashIcon: true
}

let cachedConfig: AppConfig | null = null

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
    } else {
        try {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
            config = { ...DEFAULT_CONFIG, ...data }
        } catch {
            config = { ...DEFAULT_CONFIG }
        }
    }

    cachedConfig = config
    return config
}

/**
 * Сохраняет конфигурацию в файл.
 *
 * @param {AppConfig} config - Объект конфигурации для сохранения.
 */
export function saveConfig(config: AppConfig): void {
    cachedConfig = config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}
