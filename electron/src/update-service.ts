import { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { loadConfig, saveConfig } from './config.js'
import { UpdateInfo, UpdateProgress } from './types.js'

// Настройка логгера для отладки (опционально)
// autoUpdater.logger = console;

// Отключаем автоматическую загрузку, чтобы пользователь мог сам решить
autoUpdater.autoDownload = false

/**
 * Инициализирует слушатели автообновления.
 *
 * @param {() => BrowserWindow | null} getMainWindow - Функция для получения главного окна.
 */
export function initUpdater(getMainWindow: () => BrowserWindow | null) {
    autoUpdater.on('checking-for-update', () => {
        getMainWindow()?.webContents.send('update-status', 'checking')
    })

    autoUpdater.on('update-available', (info) => {
        const updateInfo: UpdateInfo = {
            version: info.version,
            releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
        }
        getMainWindow()?.webContents.send('update-available', updateInfo)
        getMainWindow()?.webContents.send('update-status', 'available')
    })

    autoUpdater.on('update-not-available', () => {
        getMainWindow()?.webContents.send('update-status', 'not-available')
    })

    autoUpdater.on('error', (err) => {
        console.error('Updater error:', err)
        getMainWindow()?.webContents.send('update-error', err.message)
        getMainWindow()?.webContents.send('update-status', 'error')
    })

    autoUpdater.on('download-progress', (progressObj) => {
        const progress: UpdateProgress = {
            bytesPerSecond: progressObj.bytesPerSecond,
            percent: progressObj.percent,
            total: progressObj.total,
            transferred: progressObj.transferred
        }
        getMainWindow()?.webContents.send('update-progress', progress)
        getMainWindow()?.webContents.send('update-status', 'downloading')
    })

    autoUpdater.on('update-downloaded', () => {
        getMainWindow()?.webContents.send('update-status', 'downloaded')
    })
}

/**
 * Проверяет наличие обновлений.
 *
 * @param {BrowserWindow | null} _mainWindow - Оставлено для совместимости сигнатуры, не используется.
 * @param {boolean} force - Если true, игнорирует суточный лимит.
 */
export async function checkUpdates(_mainWindow: BrowserWindow | null, force = false) {
    const config = loadConfig()
    const now = Date.now()
    const ONE_DAY = 24 * 60 * 60 * 1000

    if (!force && config.lastUpdateCheck && (now - config.lastUpdateCheck < ONE_DAY)) {
        return { available: false }
    }

    try {
        const result = await autoUpdater.checkForUpdates()

        config.lastUpdateCheck = now
        saveConfig(config)

        if (result && result.updateInfo) {
            return {
                available: true,
                version: result.updateInfo.version
            }
        }
        return { available: false }
    } catch (err) {
        console.error('Failed to check for updates:', err)
        return { available: false, error: err instanceof Error ? err.message : String(err) }
    }
}

/**
 * Начинает загрузку обновления.
 */
export async function startUpdateDownload() {
    return await autoUpdater.downloadUpdate()
}

/**
 * Устанавливает обновление и перезапускает приложение.
 */
export function quitAndInstall() {
    autoUpdater.quitAndInstall()
}
