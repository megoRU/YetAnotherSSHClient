import { BrowserWindow, app } from 'electron'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import { loadConfigAsync, saveConfigAsync } from './config.js'
import { UpdateInfo, UpdateProgress } from './types.js'

// Настройка логгера для отладки
autoUpdater.logger = console;

// Отключаем автоматическую загрузку, чтобы пользователь мог сам решить
autoUpdater.autoDownload = false
// Отключаем проверку подписи кода (необходимо для неподписанных приложений на macOS и Windows)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(autoUpdater as any).verifyUpdateCodeSignature = false

/**
 * Преобразует releaseNotes (строку, массив строк или массив объектов с описанием) в одну чистую строку.
 */
function formatReleaseNotes(notes: unknown): string | undefined {
    if (!notes) return undefined
    if (typeof notes === 'string') return notes
    if (Array.isArray(notes)) {
        return notes
            .map(n => {
                if (typeof n === 'string') return n
                if (n && typeof n === 'object') {
                    const item = n as Record<string, unknown>
                    return typeof item.note === 'string' ? item.note : typeof item.releaseNotes === 'string' ? item.releaseNotes : ''
                }
                return ''
            })
            .filter(Boolean)
            .join('\n\n')
    }
    if (typeof notes === 'object') {
        const item = notes as Record<string, unknown>
        if (typeof item.note === 'string') return item.note
        if (typeof item.releaseNotes === 'string') return item.releaseNotes
    }
    return undefined
}

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
            releaseNotes: formatReleaseNotes(info.releaseNotes)
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
export async function checkUpdates(_mainWindow: BrowserWindow | null, force: boolean = false) {
    if (process.platform === 'darwin') {
        return { available: false }
    }

    const config = await loadConfigAsync()
    const now = Date.now()
    const ONE_DAY = 24 * 60 * 60 * 1000

    if (!force && config.lastUpdateCheck && (now - config.lastUpdateCheck < ONE_DAY)) {
        return { available: false }
    }

    try {
        const result = await autoUpdater.checkForUpdates()

        config.lastUpdateCheck = now
        await saveConfigAsync(config)

        if (result && result.updateInfo) {
            const currentVersion = app.getVersion()
            const latestVersion = result.updateInfo.version

            // Проверяем, действительно ли новая версия новее текущей
            if (latestVersion === currentVersion) {
                return { available: false }
            }

            return {
                available: true,
                version: latestVersion,
                releaseNotes: formatReleaseNotes(result.updateInfo.releaseNotes)
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
