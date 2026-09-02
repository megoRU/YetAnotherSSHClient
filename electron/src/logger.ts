import { app } from 'electron'
import * as os from 'node:os'
import { sanitizeText, sanitizeData, formatArg } from '../../src/utils/logSanitizer.js'

export { sanitizeText, sanitizeData, formatArg }

export interface LogEntry {
    timestamp: string
    level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'
    scope: string
    message: string
}

const MAX_LOG_ENTRIES = 2000
const logBuffer: LogEntry[] = []
let isInitialized = false

/**
 * Добавляет запись в кольцевой буфер логов
 */
export function addLog(level: LogEntry['level'], scope: string, message: string): void {
    const sanitizedMessage = sanitizeText(message)
    const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        scope,
        message: sanitizedMessage
    }
    if (logBuffer.length >= MAX_LOG_ENTRIES) {
        logBuffer.shift()
    }
    logBuffer.push(entry)
}

/**
 * Инициализирует перехват консольных логов основного процесса
 */
export function initLogger(): void {
    if (isInitialized) return
    isInitialized = true

    const originalLog = console.log
    const originalInfo = console.info
    const originalWarn = console.warn
    const originalError = console.error
    const originalDebug = console.debug

    console.log = (...args: unknown[]) => {
        originalLog(...args)
        const msg = args.map(formatArg).join(' ')
        addLog('INFO', 'Main', msg)
    }

    console.info = (...args: unknown[]) => {
        originalInfo(...args)
        const msg = args.map(formatArg).join(' ')
        addLog('INFO', 'Main', msg)
    }

    console.warn = (...args: unknown[]) => {
        originalWarn(...args)
        const msg = args.map(formatArg).join(' ')
        addLog('WARN', 'Main', msg)
    }

    console.error = (...args: unknown[]) => {
        originalError(...args)
        const msg = args.map(formatArg).join(' ')
        addLog('ERROR', 'Main', msg)
    }

    console.debug = (...args: unknown[]) => {
        originalDebug(...args)
        const msg = args.map(formatArg).join(' ')
        addLog('DEBUG', 'Main', msg)
    }

    const version = app?.getVersion ? app.getVersion() : 'unknown'
    addLog('INFO', 'System', `Logger initialized. App version: ${version}`)
}

/**
 * Формирует полный текст логов для экспорта
 */
export function generateLogExportText(): string {
    const headerLines = [
        '========================================================================',
        'YetAnotherSSHClient Session Logs',
        `Export Time: ${new Date().toISOString()}`,
        `App Version: ${app?.getVersion ? app.getVersion() : 'unknown'}`,
        `OS Platform: ${os.platform()} ${os.release()} (${os.arch()})`,
        `Node Version: ${process.versions.node}`,
        `Electron Version: ${process.versions.electron}`,
        `System Uptime: ${Math.floor(os.uptime())}s`,
        '========================================================================',
        ''
    ]

    const bodyLines = logBuffer.map(
        entry => `[${entry.timestamp}] [${entry.level}] [${entry.scope}] ${entry.message}`
    )

    return headerLines.concat(bodyLines).join('\n')
}
