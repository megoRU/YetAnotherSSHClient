import { app } from 'electron'
import * as os from 'node:os'

export interface LogEntry {
    timestamp: string
    level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'
    scope: string
    message: string
}

const MAX_LOG_ENTRIES = 2000
const logBuffer: LogEntry[] = []

/**
 * Добавляет запись в кольцевой буфер логов
 */
export function addLog(level: LogEntry['level'], scope: string, message: string): void {
    const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        scope,
        message
    }
    if (logBuffer.length >= MAX_LOG_ENTRIES) {
        logBuffer.shift()
    }
    logBuffer.push(entry)
}

function formatArg(arg: unknown): string {
    if (arg === undefined) return 'undefined'
    if (arg === null) return 'null'
    if (arg instanceof Error) {
        return arg.stack || `${arg.name}: ${arg.message}`
    }
    if (typeof arg === 'object') {
        try {
            return JSON.stringify(arg)
        } catch {
            return String(arg)
        }
    }
    return String(arg)
}

/**
 * Инициализирует перехват консольных логов основного процесса
 */
export function initLogger(): void {
    const originalLog = console.log
    const originalInfo = console.info
    const originalWarn = console.warn
    const originalError = console.error

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

    addLog('INFO', 'System', `Logger initialized. App version: ${app.getVersion()}`)
}

/**
 * Формирует полный текст логов для экспорта
 */
export function generateLogExportText(): string {
    const headerLines = [
        '========================================================================',
        'YetAnotherSSHClient Application Logs',
        `Export Time: ${new Date().toISOString()}`,
        `App Version: ${app.getVersion()}`,
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
