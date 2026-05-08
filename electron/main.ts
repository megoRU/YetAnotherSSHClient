import { app, BrowserWindow, dialog, powerSaveBlocker, nativeTheme, screen } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadConfig, saveConfig } from './src/config.js'
import { cleanupAll } from './src/ssh-manager.js'
import { checkUpdates, initUpdater } from './src/update-service.js'
import { registerIpcHandlers } from './src/ipc-handlers.js'
import { SSHConfig, AppConfig } from './src/types.js'

/* ================= PERFORMANCE OPTIMIZATION ================= */

// Отключаем троттлинг фоновых процессов и оптимизируем GPU
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('ignore-gpu-blacklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

/* ================= ERRORS ================= */

process.on('uncaughtException', (error: Error & { level?: string }) => {
    console.error('Uncaught Exception:', error)
    // Don't show error box for handled/expected SSH/network errors that might leak
    const message = (error.message || String(error)).toLowerCase()
    const level = (error?.level || '').toLowerCase()
    if (level.startsWith('client-') ||
        message.includes('handshake') ||
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('etimedout') ||
        message.includes('epipe') ||
        message.includes('socket') ||
        message.includes('disconnected') ||
        message.includes('key exchange') ||
        message.includes('unsupported') ||
        message.includes('connection lost')
    ) {
        return
    }
    dialog.showErrorBox('Critical Error', error.message || String(error))
})

process.on('unhandledRejection', (reason: unknown) => {
    console.error('Unhandled Rejection:', reason)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const message = ((reason as any)?.message || String(reason)).toLowerCase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const level = ((reason as any)?.level || '').toLowerCase()
    if (level.startsWith('client-') ||
        message.includes('handshake') ||
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('etimedout') ||
        message.includes('epipe') ||
        message.includes('socket') ||
        message.includes('disconnected') ||
        message.includes('key exchange') ||
        message.includes('unsupported') ||
        message.includes('connection lost')
    ) {
        return
    }
    dialog.showErrorBox('Unhandled Promise Rejection', (reason as any)?.message || String(reason))
})

/* ================= INIT ================= */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null

/**
 * Проверяет, видны ли переданные границы окна на каком-либо из подключенных мониторов.
 * Если окно находится за пределами экранов, возвращает координаты для центрирования на основном мониторе.
 *
 * @param {AppConfig} config - Конфигурация с размерами и позицией окна.
 * @returns {Object} Объект с валидными x, y, width, height.
 */
function getValidBounds(config: AppConfig) {
    const displays = screen.getAllDisplays()
    const { x, y, width, height } = config

    // Проверяем пересечение с любым из мониторов (хотя бы 50% площади окна должно быть видно)
    const isVisible = displays.some(display => {
        const intersectionX = Math.max(x, display.bounds.x)
        const intersectionY = Math.max(y, display.bounds.y)
        const intersectionWidth = Math.min(x + width, display.bounds.x + display.bounds.width) - intersectionX
        const intersectionHeight = Math.min(y + height, display.bounds.y + display.bounds.height) - intersectionY

        if (intersectionWidth > 0 && intersectionHeight > 0) {
            const intersectionArea = intersectionWidth * intersectionHeight
            const windowArea = width * height
            return intersectionArea > windowArea * 0.5
        }
        return false
    })

    if (isVisible) {
        return { x, y, width, height }
    }

    // Если не видно, центрируем на основном мониторе
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: pW, height: pH } = primaryDisplay.workAreaSize

    return {
        x: Math.round((pW - width) / 2),
        y: Math.round((pH - height) / 2),
        width,
        height
    }
}

/**
 * Возвращает цвет фона окна в зависимости от выбранной темы.
 * Используется для предотвращения белой вспышки при загрузке.
 *
 * @param {string} theme - Название темы.
 * @returns {string} Hex-код цвета фона.
 */
function getThemeColor(theme: string): string {
    let actualTheme = theme
    if (theme === 'Auto') {
        actualTheme = nativeTheme.shouldUseDarkColors ? 'Dark' : 'Light'
    }

    switch (actualTheme) {
        case 'Dark': return '#0F172A'
        case 'Gruvbox Light': return '#fbf1c7'
        case 'Gruvbox Dark': return '#282828'
        case 'Windows Terminal': return '#0C0C0C'
        default: return '#F8FAFC'
    }
}

/**
 * Очищает осиротевшие временные директории, которые могли остаться после
 * некорректного завершения работы приложения.
 */
async function cleanupOrphanedTempDirs(): Promise<void> {
    const tmpDir = app.getPath('temp')
    try {
        const files = await fs.promises.readdir(tmpDir)
        const orphaned = files.filter(f => f.startsWith('yash_'))
        for (const dirName of orphaned) {
            const fullPath = path.join(tmpDir, dirName)
            try {
                const stats = await fs.promises.stat(fullPath)
                // Если папке больше 24 часов, удаляем её
                const hoursOld = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60)
                if (hoursOld > 24) {
                    await fs.promises.rm(fullPath, { recursive: true, force: true })
                    console.log(`[Init] Cleaned up orphaned temp dir: ${fullPath}`)
                } else {
                    console.log(`[Init] Cleaning skipped: ${fullPath}`)
                }
            } catch (e) {
                console.error(`[Init] Failed to stat/remove orphaned dir ${fullPath}:`, e)
            }
        }
    } catch (e) {
        console.error('[Init] Failed to list temp directory for cleanup:', e)
    }
}

/**
 * Создает основное окно приложения.
 */
function createWindow(): void {
    const config = loadConfig()
    const validBounds = getValidBounds(config)

    // Используем app.getAppPath() для надежного определения путей в упакованном виде
    const preloadPath = app.isPackaged
        ? path.join(app.getAppPath(), 'dist-electron/preload.mjs')
        : path.join(__dirname, 'preload.mjs')

    mainWindow = new BrowserWindow({
        x: validBounds.x,
        y: validBounds.y,
        width: validBounds.width,
        height: validBounds.height,
        backgroundColor: getThemeColor(config.theme),
        show: false,
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false
        },
        title: 'YetAnotherSSHClient'
    })

    if (config.maximized) mainWindow.maximize()

    let saveTimeout: NodeJS.Timeout | null = null

    /**
     * Сохраняет состояние окна (размеры, положение) в конфигурацию.
     * Использует debounce (500мс) для оптимизации.
     */
    const saveWindowState = (now = false) => {
        if (saveTimeout) clearTimeout(saveTimeout)

        const performSave = () => {
            if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
            const isMaximized = mainWindow.isMaximized()
            const bounds = isMaximized ? mainWindow.getNormalBounds() : mainWindow.getBounds()
            const current = loadConfig()

            const x = Math.round(bounds.x)
            const y = Math.round(bounds.y)
            const width = Math.round(bounds.width)
            const height = Math.round(bounds.height)

            // Проверяем, изменились ли параметры, чтобы избежать лишних записей на диск
            if (current.x === x &&
                current.y === y &&
                current.width === width &&
                current.height === height &&
                current.maximized === isMaximized) {
                return
            }

            current.x = x
            current.y = y
            current.width = width
            current.height = height
            current.maximized = isMaximized

            saveConfig(current)
        }

        if (now) {
            performSave()
        } else {
            saveTimeout = setTimeout(performSave, 500)
        }
    }

    mainWindow.once('ready-to-show', () => {
        // Фикс для Windows: для frameless-окон принудительно устанавливаем границы еще раз
        // Это предотвращает "дрейф" из-за невидимых 7px рамок Windows 10/11
        if (process.platform === 'win32' && !config.maximized) {
            mainWindow?.setBounds({
                x: validBounds.x,
                y: validBounds.y,
                width: validBounds.width,
                height: validBounds.height
            })
        }

        mainWindow?.show()
        // Навешиваем слушатели после того, как окно показано и стабилизировано
        setTimeout(() => {
            if (!mainWindow || mainWindow.isDestroyed()) return
            mainWindow.on('resize', () => saveWindowState())
            mainWindow.on('move', () => saveWindowState())
            mainWindow.on('maximize', () => saveWindowState())
            mainWindow.on('unmaximize', () => saveWindowState())
            mainWindow.on('close', () => saveWindowState(true))
        }, 1000)
    })

    const themeParam = `?theme=${encodeURIComponent(config.theme)}`
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL + themeParam)
    } else {
        const indexPath = path.join(app.getAppPath(), 'dist/index.html')
        const query = { theme: config.theme }
        if (fs.existsSync(indexPath)) {
            mainWindow.loadFile(indexPath, { query })
        } else {
            // Фолбек на __dirname если через getAppPath не нашли
            mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), { query })
        }
    }

    // Перехватываем перезагрузку по Ctrl+R и F5 для кастомной обработки
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown') {
            const isControlOrMeta = process.platform === 'darwin' ? input.meta : input.control
            // Используем code === 'KeyR' для независимости от раскладки
            if ((isControlOrMeta && input.code === 'KeyR') || input.key === 'F5') {
                event.preventDefault()
                mainWindow?.webContents.send('app-reload-request')
            }
        }
    })
}

/**
 * Создает новое окно для проброса портов.
 */
function createPortForwardingWindow(config: SSHConfig): void {
    const appConfig = loadConfig()
    const preloadPath = app.isPackaged
        ? path.join(app.getAppPath(), 'dist-electron/preload.mjs')
        : path.join(__dirname, 'preload.mjs')

    const forwardWin = new BrowserWindow({
        width: 500,
        height: 600,
        backgroundColor: getThemeColor(appConfig.theme),
        frame: false,
        titleBarStyle: 'hidden',
        resizable: false,
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false
        },
        title: 'Port Forwarding'
    })

    const params = new URLSearchParams({
        theme: appConfig.theme,
        view: 'port-forwarding',
        host: config.host,
        user: config.user,
        port: config.port.toString(),
        name: config.name || '',
        password: config.password || '',
        authType: config.authType || 'password',
        privateKeyPath: config.privateKeyPath || ''
    }).toString()

    if (process.env.VITE_DEV_SERVER_URL) {
        forwardWin.loadURL(`${process.env.VITE_DEV_SERVER_URL}?${params}`)
    } else {
        const indexPath = app.isPackaged
            ? path.join(app.getAppPath(), 'dist/index.html')
            : path.join(__dirname, '../dist/index.html')

        forwardWin.loadFile(indexPath, {
            query: {
                theme: appConfig.theme,
                view: 'port-forwarding',
                host: config.host,
                user: config.user,
                port: config.port.toString(),
                name: config.name || '',
                password: config.password || '',
                authType: config.authType || 'password',
                privateKeyPath: config.privateKeyPath || ''
            }
        })
    }
}

/* ================= APP LIFECYCLE ================= */

// Обработка события открытия окна проброса портов
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(app as any).on('open-port-forwarding-window', (config: SSHConfig) => {
    createPortForwardingWindow(config)
})

// Обработка запуска одного экземпляра приложения
if (!app.requestSingleInstanceLock()) {
    app.quit()
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
        }
    })

    app.whenReady().then(() => {
        // Очистка старого мусора с задержкой, чтобы не замедлять запуск интерфейса
        setTimeout(() => cleanupOrphanedTempDirs(), 10000)

        if (process.platform === 'win32') {
            app.setAppUserModelId('com.yash.client')
        }

        // Отключаем App Nap на macOS для стабильной производительности терминала
        if (process.platform === 'darwin') {
            const anyApp = app as unknown as { setAppNapAllowed?: (allowed: boolean) => void };
            if (typeof anyApp.setAppNapAllowed === 'function') {
                anyApp.setAppNapAllowed(false)
            }
            powerSaveBlocker.start('prevent-app-suspension')
        }

        // Регистрация обработчиков IPC
        registerIpcHandlers(() => mainWindow)

        // Инициализация автообновления
        initUpdater(() => mainWindow)

        createWindow()

        // Отложенная проверка обновлений
        setTimeout(() => checkUpdates(mainWindow), 5000)
    })

    app.on('before-quit', cleanupAll)

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit()
    })

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
}
