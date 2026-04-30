import { BrowserWindow, app } from 'electron'
import { loadConfig, saveConfig } from './config.js'
import { UpdateInfo, UpdateProgress } from './types.js'

/**
 * Получает экземпляр autoUpdater асинхронно.
 */
async function getAutoUpdater() {
    const pkg = await import('electron-updater')
    const autoUpdater = pkg.autoUpdater

    // Отключаем автоматическую загрузку, чтобы пользователь мог сам решить
    autoUpdater.autoDownload = false
    // Отключаем проверку подписи кода (необходимо для неподписанных приложений на macOS и Windows)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(autoUpdater as any).verifyUpdateCodeSignature = false

    return autoUpdater
}

/**
 * Инициализирует слушатели автообновления.
 *
 * @param {() => BrowserWindow | null} getMainWindow - Функция для получения главного окна.
 */
export async function initUpdater(getMainWindow: () => BrowserWindow | null) {
    const autoUpdater = await getAutoUpdater()

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
export async function checkUpdates(_mainWindow: BrowserWindow | null, force: boolean = false) {
    const config = loadConfig()
    const now = Date.now()
    const ONE_DAY = 24 * 60 * 60 * 1000

    if (!force && config.lastUpdateCheck && (now - config.lastUpdateCheck < ONE_DAY)) {
        return { available: false }
    }

    try {
        const autoUpdater = await getAutoUpdater()
        const result = await autoUpdater.checkForUpdates()

        config.lastUpdateCheck = now
        saveConfig(config)

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
                releaseNotes: typeof result.updateInfo.releaseNotes === 'string' ? result.updateInfo.releaseNotes : undefined
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
    const autoUpdater = await getAutoUpdater()
    return await autoUpdater.downloadUpdate()
}

/**
 * Устанавливает обновление и перезапускает приложение.
 */
export async function quitAndInstall() {
    const autoUpdater = await getAutoUpdater()
    autoUpdater.quitAndInstall()
}
