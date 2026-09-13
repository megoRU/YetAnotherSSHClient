import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import type { IPty, IDisposable } from 'node-pty'
import { t } from './i18n-main.js'
import type { LocalTerminalStartResult } from '../../src/types.js'

const require = createRequire(import.meta.url)

/** Размеры PTY по умолчанию и допустимые границы (защита от некорректных значений из renderer) */
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const MIN_COLS = 2
const MIN_ROWS = 1
const MAX_COLS = 1000
const MAX_ROWS = 1000

/** ID сессии попадает в имя IPC-канала, поэтому допускаем только безопасный набор символов */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/

interface LocalTerminalSession {
    id: string
    pty: IPty
    /** webContents, создавший сессию. Только он может писать в PTY, менять размер и закрывать сессию. */
    webContentsId: number
    sender: WebContents
    /** Подписки на события node-pty — снимаются при уничтожении сессии */
    disposables: IDisposable[]
}

type DestroyReason = 'closed' | 'restart' | 'exited' | 'renderer-gone' | 'app-quit'

/** Реестр активных локальных PTY-сессий по ID */
const sessions = new Map<string, LocalTerminalSession>()

interface WebContentsWatchers {
    onDestroyed: () => void
    onGone: () => void
    onNav: (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => void
}

/** webContents, для которых установлены слушатели уничтожения/перезагрузки */
const watchedWebContents = new Map<number, WebContentsWatchers>()

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
 * Проверяет, что shell существует, является файлом и не является «запрещающей» оболочкой.
 */
function isUsableShell(shellPath: string | undefined | null): shellPath is string {
    if (!shellPath) return false
    const base = path.basename(shellPath).toLowerCase()
    if (base === 'nologin' || base === 'false') return false
    try {
        return fs.existsSync(shellPath) && fs.statSync(shellPath).isFile()
    } catch {
        return false
    }
}

/**
 * Ищет исполняемый файл в директориях из переменной окружения PATH (Windows).
 */
function findExecutableInPath(executable: string): string | null {
    const pathValue = process.env.PATH || ''
    for (const dir of pathValue.split(path.delimiter)) {
        if (!dir) continue
        const candidate = path.join(dir, executable)
        if (isUsableShell(candidate)) {
            return candidate
        }
    }
    return null
}

/**
 * Проверяет, что файл существует, является обычным файлом и имеет права на исполнение.
 */
function isExecutableFile(filePath: string | undefined | null): filePath is string {
    if (!filePath) return false
    const base = path.basename(filePath).toLowerCase()
    if (base === 'nologin' || base === 'false') return false
    try {
        if (!fs.existsSync(filePath)) return false
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) return false
        fs.accessSync(filePath, fs.constants.X_OK)
        return true
    } catch {
        return false
    }
}

/**
 * Преобразует имя или путь к оболочке в абсолютный проверенный путь на macOS.
 */
function resolveMacExecutablePath(candidate: string | undefined | null): string | null {
    if (!candidate) return null
    if (path.isAbsolute(candidate)) {
        return isExecutableFile(candidate) ? candidate : null
    }
    const pathValue = process.env.PATH || ''
    for (const dir of pathValue.split(path.delimiter)) {
        if (!dir) continue
        const fullPath = path.join(dir, candidate)
        if (isExecutableFile(fullPath)) {
            return fullPath
        }
    }
    return null
}

/**
 * Login shell пользователя из системной базы (passwd / Directory Services).
 */
function getLoginShell(): string | null {
    try {
        return os.userInfo().shell || null
    } catch {
        return null
    }
}

/**
 * Возвращает доступный существующий рабочий каталог для PTY сессии.
 */
function getValidCwd(): string {
    try {
        const home = os.homedir()
        if (home && fs.existsSync(home) && fs.statSync(home).isDirectory()) {
            return home
        }
    } catch {
        // ignore
    }
    try {
        const cwd = process.cwd()
        if (cwd && fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) {
            return cwd
        }
    } catch {
        // ignore
    }
    return '/'
}

interface ResolvedShell {
    file: string
    args: string[]
}

/**
 * Определяет системную оболочку для текущей ОС.
 *
 * Windows: PowerShell 7 (pwsh) из PATH или стандартного каталога установки, иначе Windows PowerShell.
 * Linux:   $SHELL пользователя → /bin/bash → /bin/sh.
 * macOS:   $SHELL пользователя → login shell из системной базы → /bin/zsh → /bin/sh (login shell, `-l`).
 */
export function resolveSystemShell(): ResolvedShell {
    if (process.platform === 'win32') {
        const pwshFromPath = findExecutableInPath('pwsh.exe')
        if (pwshFromPath) {
            return { file: pwshFromPath, args: [] }
        }
        for (const programFiles of [process.env.ProgramFiles, process.env.ProgramW6432]) {
            if (!programFiles) continue
            const pwsh = path.join(programFiles, 'PowerShell', '7', 'pwsh.exe')
            if (isUsableShell(pwsh)) {
                return { file: pwsh, args: [] }
            }
        }
        const systemRoot = process.env.SystemRoot || 'C:\\Windows'
        const windowsPowerShell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        if (isUsableShell(windowsPowerShell)) {
            return { file: windowsPowerShell, args: [] }
        }
        return { file: 'powershell.exe', args: [] }
    }

    if (process.platform === 'darwin') {
        const args = ['-l']
        const candidates: Array<string | null | undefined> = [
            process.env.SHELL,
            getLoginShell(),
            '/bin/zsh',
            '/usr/bin/zsh',
            '/opt/homebrew/bin/zsh',
            '/usr/local/bin/zsh',
            '/bin/bash',
            '/usr/bin/bash',
            '/opt/homebrew/bin/bash',
            '/usr/local/bin/bash',
            '/bin/sh',
            '/usr/bin/sh'
        ]

        for (const candidate of candidates) {
            const resolved = resolveMacExecutablePath(candidate)
            if (resolved) {
                return { file: resolved, args }
            }
        }

        return { file: '/bin/sh', args }
    }

    const candidates: Array<string | null | undefined> = [process.env.SHELL, '/bin/bash']

    for (const candidate of candidates) {
        if (isUsableShell(candidate)) {
            return { file: candidate, args: [] }
        }
    }

    return { file: '/bin/sh', args: [] }
}

/**
 * Приводит размер PTY к целому числу в допустимых границах.
 * Возвращает null, если значение не является конечным числом.
 */
function clampDimension(value: unknown, min: number, max: number): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return Math.min(max, Math.max(min, Math.floor(value)))
}

function isValidSessionId(id: unknown): id is string {
    return typeof id === 'string' && SESSION_ID_PATTERN.test(id)
}


/**
 * Отправляет событие renderer-процессу, владеющему сессией.
 */
function sendToOwner(session: LocalTerminalSession, channel: string, payload: unknown): void {
    if (session.sender.isDestroyed()) return
    try {
        session.sender.send(channel, payload)
    } catch (err) {
        console.warn(`[LocalTerminal] Failed to send "${channel}":`, err)
    }
}

/**
 * Проверяет, остались ли активные сессии у указанного webContents.
 */
function hasSessionsForWebContents(webContentsId: number): boolean {
    for (const session of sessions.values()) {
        if (session.webContentsId === webContentsId) {
            return true
        }
    }
    return false
}

/**
 * Снимает слушатели жизненного цикла WebContents, если они были установлены.
 */
function unwatchWebContents(sender: WebContents): void {
    const webContentsId = sender.id
    const watchers = watchedWebContents.get(webContentsId)
    if (!watchers) return
    watchedWebContents.delete(webContentsId)

    if (!sender.isDestroyed()) {
        sender.removeListener('destroyed', watchers.onDestroyed)
        sender.removeListener('render-process-gone', watchers.onGone)
        sender.removeListener('did-start-navigation', watchers.onNav)
    }
}

/**
 * Единая точка уничтожения активной сессии (закрытие вкладки, перезапуск, выгрузка renderer, выход из приложения).
 * Идемпотентна: повторный вызов для уже удалённой сессии — no-op.
 * Снимает подписки node-pty, удаляет запись из реестра и вызывает pty.kill().
 */
function destroySession(id: string, reason: DestroyReason): boolean {
    const session = sessions.get(id)
    if (!session) return false
    sessions.delete(id)

    for (const disposable of session.disposables) {
        try {
            disposable.dispose()
        } catch {
            // ignore
        }
    }
    session.disposables = []

    try {
        session.pty.kill()
    } catch (err) {
        console.warn(`[LocalTerminal] Failed to kill pty for ID: ${id}:`, err)
    }

    console.log(`[LocalTerminal] Session destroyed (${reason}) for ID: ${id}`)

    if (!hasSessionsForWebContents(session.webContentsId)) {
        unwatchWebContents(session.sender)
    }

    return true
}

/**
 * Завершает сессию, если PTY процесс завершился самостоятельно (onExit).
 * В отличие от destroySession, здесь НЕ вызывается pty.kill(), так как процесс уже завершился.
 * Снимает подписки node-pty, удаляет запись из реестра и отправляет событие выхода владельцу.
 */
function finalizeExitedSession(id: string, exitCode: number): boolean {
    const session = sessions.get(id)
    if (!session) return false
    sessions.delete(id)

    for (const disposable of session.disposables) {
        try {
            disposable.dispose()
        } catch {
            // ignore
        }
    }
    session.disposables = []

    console.log(`[LocalTerminal] Shell exited naturally with code ${exitCode} (ID: ${id})`)

    if (!hasSessionsForWebContents(session.webContentsId)) {
        unwatchWebContents(session.sender)
    }

    sendToOwner(session, `local-terminal-exit-${id}`, exitCode)
    return true
}

/**
 * Уничтожает все сессии, принадлежащие указанному webContents.
 */
function destroySessionsOfWebContents(webContentsId: number, reason: DestroyReason): void {
    for (const [id, session] of Array.from(sessions)) {
        if (session.webContentsId === webContentsId) {
            destroySession(id, reason)
        }
    }
}

/**
 * Следит за жизненным циклом renderer: при уничтожении окна, краше процесса или перезагрузке страницы
 * завершает принадлежащие ему PTY. При отсутствии активных сессий слушатели корректно снимаются.
 */
function watchWebContents(sender: WebContents): void {
    const webContentsId = sender.id
    if (watchedWebContents.has(webContentsId)) return

    const onDestroyed = () => {
        unwatchWebContents(sender)
        destroySessionsOfWebContents(webContentsId, 'renderer-gone')
    }

    const onGone = () => {
        destroySessionsOfWebContents(webContentsId, 'renderer-gone')
    }

    const onNav = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
        if (details.isMainFrame && !details.isSameDocument) {
            destroySessionsOfWebContents(webContentsId, 'renderer-gone')
        }
    }

    watchedWebContents.set(webContentsId, { onDestroyed, onGone, onNav })

    sender.once('destroyed', onDestroyed)
    sender.on('render-process-gone', onGone)
    sender.on('did-start-navigation', onNav)
}

/**
 * Возвращает сессию только если запрос пришёл от того же webContents, которому она принадлежит.
 */
function getOwnedSession(event: IpcMainEvent, id: unknown): LocalTerminalSession | null {
    if (!isValidSessionId(id)) return null
    const session = sessions.get(id)
    if (!session) return null
    if (session.webContentsId !== event.sender.id) {
        console.warn(`[LocalTerminal] Access denied: session ${id} belongs to another renderer`)
        return null
    }
    return session
}

/**
 * Завершает все локальные терминальные процессы. Используется при выходе из приложения.
 */
export function cleanupAllLocalTerminals(): void {
    for (const id of Array.from(sessions.keys())) {
        destroySession(id, 'app-quit')
    }
}

/**
 * Регистрирует IPC-обработчики локального системного терминала.
 * Функциональность изолирована от SSH/SFTP/MCP.
 */
export function registerLocalTerminalHandlers(): void {
    /**
     * Создание PTY выполняется через invoke/handle (handshake), чтобы renderer получал
     * результат старта детерминированно. Renderer подписывается на события вывода и выхода
     * еще до вызова local-terminal-start, а обработчики нативной сессии регистрируются
     * сразу после выполнения spawn().
     */
    ipcMain.handle('local-terminal-start', (event: IpcMainInvokeEvent, payload: unknown): LocalTerminalStartResult => {
        const data = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
        const id = data.id
        if (!isValidSessionId(id)) {
            return { ok: false, error: t('localTerminal.shellStartError', { message: 'Invalid session ID' }) }
        }

        const existing = sessions.get(id)
        if (existing) {
            if (existing.webContentsId !== event.sender.id) {
                console.warn(`[LocalTerminal] Start rejected: session ${id} belongs to another renderer`)
                return { ok: false, error: t('localTerminal.shellStartError', { message: 'Session ID is already in use' }) }
            }
            // Повторный start с тем же ID от того же renderer — корректно завершаем предыдущую сессию
            destroySession(id, 'restart')
        }

        const cols = clampDimension(data.cols, MIN_COLS, MAX_COLS) ?? DEFAULT_COLS
        const rows = clampDimension(data.rows, MIN_ROWS, MAX_ROWS) ?? DEFAULT_ROWS
        const shell = resolveSystemShell()
        const cwd = getValidCwd()
        console.log(`[LocalTerminal] Starting shell "${shell.file}" ${cols}x${rows} (ID: ${id})`)

        let pty: IPty
        try {
            pty = getNodePty().spawn(shell.file, shell.args, {
                name: 'xterm-256color',
                cols,
                rows,
                cwd,
                env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                    COLORTERM: 'truecolor'
                }
            })
        } catch (err) {
            if (process.platform === 'darwin') {
                const macFallbacks = [
                    { file: '/bin/zsh', args: ['-l'] },
                    { file: '/bin/bash', args: ['-l'] },
                    { file: '/bin/sh', args: ['-l'] },
                    { file: '/bin/sh', args: [] }
                ]
                for (const fallback of macFallbacks) {
                    if (fallback.file === shell.file) continue
                    if (!isExecutableFile(fallback.file)) continue
                    try {
                        pty = getNodePty().spawn(fallback.file, fallback.args, {
                            name: 'xterm-256color',
                            cols,
                            rows,
                            cwd,
                            env: {
                                ...process.env,
                                TERM: 'xterm-256color',
                                COLORTERM: 'truecolor'
                            }
                        })
                        console.log(`[LocalTerminal] Successfully fallback spawned shell "${fallback.file}"`)
                        break
                    } catch {
                        // try next fallback
                    }
                }
            }
            if (!pty!) {
                const message = err instanceof Error ? err.message : String(err)
                console.error(`[LocalTerminal] Failed to start shell for ID: ${id}: ${message}`)
                return { ok: false, error: t('localTerminal.shellStartError', { message }) }
            }
        }

        const session: LocalTerminalSession = {
            id,
            pty,
            webContentsId: event.sender.id,
            sender: event.sender,
            disposables: []
        }
        sessions.set(id, session)
        watchWebContents(event.sender)

        session.disposables.push(pty.onData((chunk: string) => {
            if (sessions.get(id) !== session) return
            sendToOwner(session, `local-terminal-output-${id}`, chunk)
        }))

        session.disposables.push(pty.onExit(({ exitCode }: { exitCode: number; signal?: number }) => {
            if (sessions.get(id) !== session) return
            // Shell завершился сам: снимаем подписки и регистрируем завершение без повторного вызова kill()
            finalizeExitedSession(id, exitCode)
        }))

        return { ok: true, pid: pty.pid }
    })

    ipcMain.on('local-terminal-input', (event: IpcMainEvent, payload: unknown) => {
        const data = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
        const session = getOwnedSession(event, data.id)
        if (!session || typeof data.data !== 'string') return
        try {
            session.pty.write(data.data)
        } catch (err) {
            console.warn(`[LocalTerminal] Write failed for ID: ${session.id}:`, err)
        }
    })

    ipcMain.on('local-terminal-resize', (event: IpcMainEvent, payload: unknown) => {
        const data = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
        const session = getOwnedSession(event, data.id)
        if (!session) return
        const cols = clampDimension(data.cols, MIN_COLS, MAX_COLS)
        const rows = clampDimension(data.rows, MIN_ROWS, MAX_ROWS)
        if (cols === null || rows === null) return
        if (session.pty.cols === cols && session.pty.rows === rows) return
        try {
            session.pty.resize(cols, rows)
        } catch (err) {
            console.warn(`[LocalTerminal] Resize failed for ID: ${session.id}:`, err)
        }
    })

    ipcMain.on('local-terminal-close', (event: IpcMainEvent, id: unknown) => {
        const session = getOwnedSession(event, id)
        if (!session) return
        destroySession(session.id, 'closed')
    })
}
