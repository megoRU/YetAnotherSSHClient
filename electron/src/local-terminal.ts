import { ipcMain, type IpcMainEvent } from 'electron'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import type { IPty } from 'node-pty'
import { loadConfig } from './config.js'
import { t } from './i18n-main.js'
import { LocalTerminalStartPayload } from '../../src/types.js'

const require = createRequire(import.meta.url)

/** Хранилище активных локальных PTY-процессов по ID сессии */
const localPtys = new Map<string, IPty>()

interface NodePtyModule {
    spawn: (file: string, args: string[] | string, options: {
        name: string
        cols: number
        rows: number
        cwd: string
        env: NodeJS.ProcessEnv
    }) => IPty
}

let nodePtyModule: NodePtyModule | null = null

/**
 * Лениво загружает нативный модуль node-pty.
 * Ленивая загрузка гарантирует, что проблемы с нативным модулем не уронят приложение при старте.
 */
function getNodePty(): NodePtyModule {
    if (!nodePtyModule) {
        nodePtyModule = require('node-pty') as NodePtyModule
    }
    return nodePtyModule
}

/**
 * Ищет исполняемый файл в директориях из переменной окружения PATH (Windows).
 */
function findExecutableInPath(executable: string): string | null {
    const pathValue = process.env.PATH || ''
    for (const dir of pathValue.split(path.delimiter)) {
        if (!dir) continue
        const candidate = path.join(dir, executable)
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return candidate
            }
        } catch {
            // ignore inaccessible dirs
        }
    }
    return null
}

/**
 * Проверяет, что shell существует и является файлом.
 */
function isUsableShell(shellPath: string | undefined): shellPath is string {
    if (!shellPath) return false
    try {
        return fs.existsSync(shellPath) && fs.statSync(shellPath).isFile()
    } catch {
        return false
    }
}

interface ResolvedShell {
    file: string
    args: string[]
}

/**
 * Определяет системную оболочку для текущей ОС.
 *
 * Windows: pwsh (PowerShell 7+), если доступен, иначе Windows PowerShell.
 * Linux: $SHELL пользователя, fallback — /bin/bash.
 * macOS: $SHELL пользователя, fallback — /bin/zsh.
 */
export function resolveSystemShell(): ResolvedShell {
    if (process.platform === 'win32') {
        const pwsh = findExecutableInPath('pwsh.exe')
        if (pwsh) {
            return { file: pwsh, args: [] }
        }
        const systemRoot = process.env.SystemRoot || 'C:\\Windows'
        const windowsPowerShell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        if (isUsableShell(windowsPowerShell)) {
            return { file: windowsPowerShell, args: [] }
        }
        return { file: 'powershell.exe', args: [] }
    }

    const userShell = process.env.SHELL
    if (isUsableShell(userShell)) {
        // На macOS запускаем login shell — так делают системные терминалы,
        // чтобы окружение пользователя (PATH и т.д.) загружалось корректно.
        return { file: userShell, args: process.platform === 'darwin' ? ['-l'] : [] }
    }

    const fallback = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
    if (isUsableShell(fallback)) {
        return { file: fallback, args: process.platform === 'darwin' ? ['-l'] : [] }
    }

    return { file: '/bin/sh', args: [] }
}

/**
 * Проверяет наличие активной подписки (существующая licensing-система приложения).
 */
function isLicenseActive(): boolean {
    const config = loadConfig()
    return !!(config.licenseKey && (!config.licenseExpiresAt || config.licenseExpiresAt > Date.now()))
}

/**
 * Завершает и удаляет локальный терминальный процесс по ID сессии.
 */
export function cleanupLocalTerminal(id: string): void {
    const pty = localPtys.get(id)
    if (!pty) return
    localPtys.delete(id)
    try {
        pty.kill()
    } catch (err) {
        console.warn(`[LocalTerminal] Failed to kill pty for ID: ${id}:`, err)
    }
    console.log(`[LocalTerminal] Terminal closed for ID: ${id}`)
}

/**
 * Завершает все локальные терминальные процессы. Используется при выходе из приложения.
 */
export function cleanupAllLocalTerminals(): void {
    localPtys.forEach((pty, id) => {
        try {
            pty.kill()
        } catch (err) {
            console.warn(`[LocalTerminal] Failed to kill pty for ID: ${id}:`, err)
        }
    })
    localPtys.clear()
}

/**
 * Регистрирует IPC-обработчики локального системного терминала.
 * Функциональность изолирована от SSH/SFTP/MCP.
 */
export function registerLocalTerminalHandlers(): void {
    ipcMain.on('local-terminal-start', (event: IpcMainEvent, payload: LocalTerminalStartPayload) => {
        const { id, cols = 80, rows = 24 } = payload
        if (typeof id !== 'string' || id.length === 0 || id.length > 256) return

        // Функция в Beta и доступна только подписчикам — проверка на стороне main-процесса.
        if (!isLicenseActive()) {
            console.warn(`[LocalTerminal] Start rejected (no active subscription) for ID: ${id}`)
            event.reply(`local-terminal-error-${id}`, t('localTerminal.subscriptionRequired'))
            return
        }

        // Предварительная очистка, если сессия с таким ID уже была
        cleanupLocalTerminal(id)

        const shell = resolveSystemShell()
        console.log(`[LocalTerminal] Starting shell "${shell.file}" (ID: ${id})`)

        let pty: IPty
        try {
            pty = getNodePty().spawn(shell.file, shell.args, {
                name: 'xterm-256color',
                cols: cols > 0 ? cols : 80,
                rows: rows > 0 ? rows : 24,
                cwd: os.homedir(),
                env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                    COLORTERM: 'truecolor'
                }
            })
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.error(`[LocalTerminal] Failed to start shell for ID: ${id}: ${message}`)
            event.reply(`local-terminal-error-${id}`, t('localTerminal.shellStartError', { message }))
            return
        }

        localPtys.set(id, pty)

        pty.onData((data: string) => {
            if (localPtys.get(id) !== pty) return
            event.reply(`local-terminal-output-${id}`, data)
        })

        pty.onExit(({ exitCode }: { exitCode: number }) => {
            if (localPtys.get(id) !== pty) return
            localPtys.delete(id)
            console.log(`[LocalTerminal] Shell exited with code ${exitCode} (ID: ${id})`)
            event.reply(`local-terminal-exit-${id}`, exitCode)
        })

        event.reply(`local-terminal-status-${id}`, 'started')
    })

    ipcMain.on('local-terminal-input', (_, payload: { id: string; data: string }) => {
        const { id, data } = payload
        if (typeof id !== 'string' || typeof data !== 'string') return
        localPtys.get(id)?.write(data)
    })

    ipcMain.on('local-terminal-resize', (_, payload: { id: string; cols: number; rows: number }) => {
        const { id, cols, rows } = payload
        if (typeof id !== 'string') return
        if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) return
        try {
            localPtys.get(id)?.resize(cols, rows)
        } catch (err) {
            console.warn(`[LocalTerminal] Resize failed for ID: ${id}:`, err)
        }
    })

    ipcMain.on('local-terminal-close', (_, id: string) => {
        if (typeof id !== 'string' || id.length > 256) return
        cleanupLocalTerminal(id)
    })
}
