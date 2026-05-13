import { app, BrowserWindow, dialog, powerSaveBlocker, nativeTheme, screen, shell } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadConfig, loadConfigAsync, saveConfigAsync } from './src/config.js'
import { cleanupAll } from './src/ssh-manager.js'
import { checkUpdates, initUpdater } from './src/update-service.js'
import { registerIpcHandlers } from './src/ipc-handlers.js'
import { SSHConfig, AppConfig } from './src/types.js'

/* ================= PERFORMANCE OPTIMIZATION ================= */

// Оптимизируем GPU
app.commandLine.appendSwitch('ignore-gpu-blacklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

/* ================= ERRORS ================= */

process.on('uncaughtException', (error: Error & { level?: string }) => {
    console.error('Uncaught Exception:', error)
    const message = (error.message || String(error)).toLowerCase()
    const level = (error?.level || '').toLowerCase()
    const stack = (error.stack || '').toLowerCase()

    // Aggressive suppression of network/SSH errors that should not show system dialogs
    const isNetworkError =
        level.startsWith('client-') ||
        message.includes('handshake') ||
        message.includes('timeout') ||
        message.includes('conn') || // ECONNRESET, ECONNREFUSED, etc.
        message.includes('socket') ||
        message.includes('pipe') ||
        message.includes('disconnected') ||
        message.includes('ssh') ||
        message.includes('key exchange') ||
        message.includes('unsupported') ||
        stack.includes('ssh2') ||
        stack.includes('net.js') ||
        stack.includes('stream_base_node')

    if (isNetworkError) return

    dialog.showErrorBox('Critical Error', error.message || String(error))
})

process.on('unhandledRejection', (reason: unknown) => {
    console.error('Unhandled Rejection:', reason)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = reason as any
    const message = (err?.message || String(reason)).toLowerCase()
    const level = (err?.level || '').toLowerCase()
    const stack = (err?.stack || '').toLowerCase()

    const isNetworkError =
        level.startsWith('client-') ||
        message.includes('handshake') ||
        message.includes('timeout') ||
        message.includes('conn') ||
        message.includes('socket') ||
        message.includes('pipe') ||
        message.includes('disconnected') ||
        message.includes('ssh') ||
        message.includes('key exchange') ||
        message.includes('unsupported') ||
        stack.includes('ssh2') ||
        stack.includes('net.js') ||
        stack.includes('stream_base_node')

    if (isNetworkError) return

    dialog.showErrorBox('Unhandled Promise Rejection', err?.message || String(reason))
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
            sandbox: true
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

        const performSave = async () => {
            if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
            const isMaximized = mainWindow.isMaximized()
            const bounds = isMaximized ? mainWindow.getNormalBounds() : mainWindow.getBounds()
            const current = await loadConfigAsync()

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

            await saveConfigAsync(current)
        }

        if (now) {
            void performSave()
        } else {
            saveTimeout = setTimeout(() => {
                void performSave()
            }, 500)
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

    // Перехватываем перезагрузку по Ctrl+R для кастомной обработки (поиск по истории в терминале)
    // F5 блокируем полностью, чтобы избежать случайных перезагрузок
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown') {
            const isControlOrMeta = process.platform === 'darwin' ? input.meta : input.control
            // Используем code === 'KeyR' для независимости от раскладки
            if (isControlOrMeta && input.code === 'KeyR') {
                event.preventDefault()
                mainWindow?.webContents.send('app-reload-request')
            } else if (input.key === 'F5') {
                event.preventDefault()
            }
        }
    })

    // Блокируем навигацию и открытие новых окон внутри renderer для снижения риска эскалации через XSS
    mainWindow.webContents.on('will-navigate', (event) => {
        event.preventDefault()
    })
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        try {
            const parsed = new URL(url)
            if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
                void shell.openExternal(parsed.toString())
            }
        } catch {
            // ignore malformed url
        }
        return { action: 'deny' }
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
            nodeIntegration: false,
            sandbox: true
        },
        title: 'Port Forwarding'
    })

    const params = new URLSearchParams({
        theme: appConfig.theme,
        view: 'port-forwarding',
        id: config.id || '',
        host: config.host,
        user: config.user,
        port: config.port.toString(),
        name: config.name || '',
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
                id: config.id || '',
                host: config.host,
                user: config.user,
                port: config.port.toString(),
                name: config.name || '',
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
