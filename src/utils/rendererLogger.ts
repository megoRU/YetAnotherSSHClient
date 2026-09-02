import { formatArg } from './logSanitizer'

let isInitialized = false

function sendToMain(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', args: unknown[]): void {
    if (!window.ipcRenderer?.logRendererMsg) return
    try {
        const message = args.map(formatArg).join(' ')
        window.ipcRenderer.logRendererMsg({ level, message })
    } catch {
        // Игнорируем ошибки передачи логов, чтобы не вызывать циклические сбои
    }
}

export function initRendererLogger(): void {
    if (isInitialized) return
    isInitialized = true

    const originalLog = console.log
    const originalInfo = console.info
    const originalWarn = console.warn
    const originalError = console.error
    const originalDebug = console.debug

    console.log = (...args: unknown[]) => {
        originalLog(...args)
        sendToMain('INFO', args)
    }

    console.info = (...args: unknown[]) => {
        originalInfo(...args)
        sendToMain('INFO', args)
    }

    console.warn = (...args: unknown[]) => {
        originalWarn(...args)
        sendToMain('WARN', args)
    }

    console.error = (...args: unknown[]) => {
        originalError(...args)
        sendToMain('ERROR', args)
    }

    console.debug = (...args: unknown[]) => {
        originalDebug(...args)
        sendToMain('DEBUG', args)
    }

    window.addEventListener('error', (event) => {
        const errorMsg = event.error
            ? (event.error.stack || `${event.error.name}: ${event.error.message}`)
            : `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`
        sendToMain('ERROR', [`[Uncaught Error] ${errorMsg}`])
    })

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason
        const reasonMsg = reason instanceof Error
            ? (reason.stack || `${reason.name}: ${reason.message}`)
            : formatArg(reason)
        sendToMain('ERROR', [`[Unhandled Rejection] ${reasonMsg}`])
    })
}
