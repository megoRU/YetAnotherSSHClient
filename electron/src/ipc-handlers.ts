import {
    app,
    BrowserWindow,
    clipboard,
    dialog,
    ipcMain,
    type IpcMainEvent,
    safeStorage,
    shell
} from 'electron'
import {Client, type ConnectConfig, PseudoTtyOptions} from 'ssh2'
import * as net from 'node:net'
import * as fs from 'node:fs'
import {clearConfigCache, loadConfig, loadConfigAsync, preserveCachedRecoveryKey, saveConfigAsync, initializeVaultAndMigrate, migratePrivateKeyPaths, syncFavoritesSecrets} from './config.js'
import {vault} from './vault.js'
import {privateKeyErrorMessage, PrivateKeyError, stripPlaintextPrivateKeys, isSupportedPrivateKeyFormat} from './private-key.js'
import {applyAuthConfig, isLoginRequired, resolvePasswordForAuth, type SessionAuth} from './auth-credentials.js'
import {beginAuthAttempt, buildKeyboardResponses, clearAuthState, getAuthState, MAX_AUTH_ATTEMPTS, requestAuthChallenge, setKeyboardFinisher, takeKeyboardFinisher} from './ssh-auth.js'
import {t} from './i18n-main.js'
import {selectExecutableFile} from './app-dialogs.js'
import * as crypto from 'node:crypto'
import {checkUpdates, quitAndInstall, startUpdateDownload} from './update-service.js'
import {
    cleanupAll,
    cleanupConnection,
    forwardServers,
    shellStreams,
    sshClients,
    sshConfigs,
    sshSockets
} from './ssh-manager.js'
import { AppConfig, SSHConfig, EncryptedSecret } from '../../src/types.js'
import { LOGIN_REQUIRED_STATUS, SshAuthResponse, SshConnectPayload, SshForwardStartPayload, SshInputPayload, SshResizePayload } from '../../src/ipc/ssh.js'
import {
    SftpCancelUploadRequest,
    SftpChmodRequest,
    SftpConnectPayload,
    SftpDownloadFileRequest,
    SftpDownloadMultipleRequest,
    SftpDownloadResult,
    SftpExtractRequest,
    SftpFileEntry,
    SftpMkdirRequest,
    SftpOpenInEditorRequest,
    SftpOpenWithRequest,
    SftpReaddirRequest,
    SftpRealpathRequest,
    SftpRenameRequest,
    SftpRmRequest,
    SftpUploadDirectRequest,
    SftpUploadFilesFromPathsRequest,
    SftpUploadResult
} from '../../src/ipc/sftp.js'
import { McpConfirmCommandPayload } from '../../src/ipc/mcp.js'
import { RendererLogMessage } from '../../src/ipc/system.js'
import { addLog, generateLogExportText } from './logger.js'
import { sftpManager } from './sftp/SftpManager.js'

/** Модуль MCP-сервера; тип выводится из динамического импорта (см. loadMcpModule). */
type McpModule = typeof import('./mcp-server.js')

let mcpModulePromise: Promise<McpModule> | null = null
let mcpMainWindowGetter: (() => BrowserWindow | null) | null = null

/**
 * Ленивая загрузка MCP-сервера.
 *
 * MCP-подсистема тянет за собой `@modelcontextprotocol/sdk` и zod — это заметная
 * часть стартового графа main-процесса, хотя сервер нужен только при включённом MCP.
 * Модуль загружается при первом обращении к mcp-* каналу либо при явном `warmUpMcp()`
 * после показа окна, поэтому в критический путь запуска он не попадает.
 *
 * Загрузка мемоизирована: параллельные обращения получают один и тот же промис.
 */
function loadMcpModule(): Promise<McpModule> {
    if (!mcpModulePromise) {
        mcpModulePromise = import('./mcp-server.js').then(async mod => {
            if (mcpMainWindowGetter) {
                mod.setMcpMainWindowGetter(mcpMainWindowGetter)
            }
            // Состояние MCP синхронизируется с конфигом сразу после загрузки модуля,
            // поэтому сервер поднимается и опускается вместе с config.mcpEnabled.
            await mod.syncMcpServerState()
            return mod
        })
    }
    return mcpModulePromise
}

/**
 * Запускает фоновую загрузку MCP-сервера (вызывается из main после показа окна).
 * Ошибки не влияют на запуск приложения: MCP остаётся выключенным, пользователь
 * сможет включить его позже через настройки.
 */
export function warmUpMcp(): void {
    void loadMcpModule().catch(err => console.error('[MCP] Warm-up failed:', err))
}

/**
 * Останавливает MCP-сервер, только если он уже был загружен.
 * Используется при выходе из приложения, чтобы не тянуть SDK ради его остановки.
 */
export function stopMcpIfLoaded(): void {
    if (!mcpModulePromise) {
        return
    }
    void mcpModulePromise
        .then(mod => mod.stopMcpServer())
        .catch(() => { /* MCP не успел загрузиться — останавливать нечего */ })
}

interface OutputBatchState {
    chunks: Buffer[]
    totalLength: number
    flushScheduled: boolean
}

const outputBatchMap = new Map<string, OutputBatchState>()
const MAX_OUTPUT_BATCH_BYTES = 64 * 1024

function flushOutputBatch(event: IpcMainEvent, id: string): void {
    const state = outputBatchMap.get(id)
    if (!state) {
        return
    }

    state.flushScheduled = false

    if (state.totalLength === 0 || state.chunks.length === 0) {
        return
    }

    const payload = Buffer.concat(state.chunks, state.totalLength)
    state.chunks = []
    state.totalLength = 0
    event.reply(`ssh-output-${id}`, payload)
}

function queueOutputChunk(event: IpcMainEvent, id: string, chunk: Buffer): void {
    let state = outputBatchMap.get(id)
    if (!state) {
        state = {
            chunks: [],
            totalLength: 0,
            flushScheduled: false
        }
        outputBatchMap.set(id, state)
    }

    state.chunks.push(chunk)
    state.totalLength += chunk.length

    if (state.totalLength >= MAX_OUTPUT_BATCH_BYTES) {
        flushOutputBatch(event, id)
        return
    }

    if (!state.flushScheduled) {
        state.flushScheduled = true
        setImmediate(() => {
            flushOutputBatch(event, id)
        })
    }
}

/**
 * Проверяет, что ошибка связана с отказом в авторизации: такие ошибки показываются
 * пользователю формой ввода учётных данных, пока не исчерпаны попытки.
 */
function isSshAuthFailure(err: Error & { level?: string }): boolean {
    const message = err.message || String(err);
    return err.level === 'client-authentication'
        || message.includes('authentication failed')
        || message.includes('All configured authentication methods failed')
}

/**
 * Форматирует ошибку SSH для отправки на фронтенд.
 * Позволяет фронтенду распознавать специфические ошибки (например, аутентификации).
 */
function formatSshError(err: Error & { level?: string }): string {
    if (isSshAuthFailure(err)) {
        return `AUTH_FAILURE: ${t('terminal.authFailed')}`;
    }
    return err.message || String(err);
}

/**
 * Регистрирует все IPC-обработчики приложения.
 *
 * @param {() => BrowserWindow | null} getMainWindow - Функция для получения актуального экземпляра главного окна.
 */
export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null) {
    // Модуль MCP здесь не загружается: getter окна запоминается, а сам SDK подтягивается
    // лениво — при первом mcp-* вызове или при warmUpMcp() после показа окна.
    mcpMainWindowGetter = getMainWindow

    // MCP IPC Handlers
    ipcMain.handle('mcp-get-status', async () => (await loadMcpModule()).getMcpStatus())
    ipcMain.handle('mcp-get-token', async () => (await loadMcpModule()).getMcpToken())

    ipcMain.handle('mcp-toggle', async (_, enabled: boolean) => {
        const mcp = await loadMcpModule()
        const config = loadConfig()
        config.mcpEnabled = enabled
        await saveConfigAsync(config)
        if (enabled) {
            await mcp.startMcpServer()
        } else {
            await mcp.stopMcpServer()
        }
        return mcp.getMcpStatus()
    })

    ipcMain.handle('mcp-regenerate-token', async () => {
        const mcp = await loadMcpModule()
        const config = loadConfig()
        config.mcpToken = crypto.randomBytes(16).toString('hex')
        await saveConfigAsync(config)
        if (config.mcpEnabled) {
            await mcp.stopMcpServer()
            await mcp.startMcpServer()
        }
        return mcp.getMcpStatus()
    })

    ipcMain.handle('mcp-open-server', async (_, serverId: string) => {
        const mcp = await loadMcpModule()
        const config = loadConfig()
        if (typeof serverId !== 'string' || !config.favorites.some(server => server.id === serverId)) {
            throw new Error('Unknown SSH server')
        }
        if (!Array.isArray(config.mcpAllowedServerIds)) config.mcpAllowedServerIds = []
        if (!config.mcpAllowedServerIds.includes(serverId)) {
            config.mcpAllowedServerIds.push(serverId)
            await saveConfigAsync(config)
        }
        if (config.mcpEnabled) {
            await mcp.startMcpServer()
        }
        return mcp.getMcpStatus()
    })

    ipcMain.handle('mcp-close-server', async (_, serverId: string) => {
        const mcp = await loadMcpModule()
        const config = loadConfig()
        if (Array.isArray(config.mcpAllowedServerIds)) {
            config.mcpAllowedServerIds = config.mcpAllowedServerIds.filter(id => id !== serverId)
            await saveConfigAsync(config)
        }
        mcp.confirmationManager.revokeByServerId(serverId)
        mcp.mcpExecutionManager.cancelByConnectionId(serverId)
        mcp.timelineManager.cancelByConnectionId(serverId)
        return mcp.getMcpStatus()
    })

    ipcMain.handle('mcp-confirm-command', async (_, payload: McpConfirmCommandPayload) => {
        const mcp = await loadMcpModule()
        mcp.handleMcpConfirmationResponse(payload.id, payload.approved)
        return true
    })

    ipcMain.handle('mcp-cancel-run', async (_, runId: string) => {
        const mcp = await loadMcpModule()
        const cancelled = mcp.timelineManager.cancelRun(runId)
        if (cancelled) {
            const win = getMainWindow()
            if (win && !win.isDestroyed()) {
                win.webContents.send('mcp-status-changed', mcp.getMcpStatus())
            }
        }
        return cancelled
    })

    // Конфигурация
    ipcMain.on('get-config-sync', (event) => {
        event.returnValue = loadConfig()
    })
    ipcMain.handle('get-config', async () => await loadConfigAsync())
    ipcMain.handle('save-config', async (_, config: AppConfig) => {
        const previousConfig = loadConfig()
        // Конфиг из рендерера — снимок, снятый при старте приложения. Кэша ключа
        // восстановления в нём нет, если вольт тогда был заблокирован, поэтому
        // пропускать его через save-config нельзя: любое сохранение из UI стёрло
        // бы ключ, только что записанный vault-unlock, и приложение снова спросило
        // бы его при следующем запуске. Поле принадлежит main-процессу.
        preserveCachedRecoveryKey(config, previousConfig)
        const win = getMainWindow()
        if (win) {
            // Признак развёрнутости обновляем, а геометрию — нет: x/y/width/height
            // принадлежат saveWindowState (electron/main.ts), который срабатывает по
            // resize/move/close уже после того, как окно показано и его размер выправлен.
            // Раньше геометрия писалась ещё и здесь, при монтировании renderer'а, — то есть
            // ДО выправки размера. При масштабе 125% frameless-окно создаётся на 4x5 px
            // больше запрошенного, это значение попадало в конфиг, и на каждом
            // перезапуске окно разрасталось ещё на 4x5 px.
            config.maximized = win.isMaximized()
        }
        // If config includes updated passwords in favorites (e.g. from ConnectionForm), move them to vault
        if (config.favorites && Array.isArray(config.favorites)) {
            if (!config.encryptedPasswords) config.encryptedPasswords = {}
            if (!config.encryptedKeyPassphrases) config.encryptedKeyPassphrases = {}

            // Пустой секрет в favorite — это явное удаление сохранённого значения
            const encrypt = (value: string) => vault.encrypt(value)
            const isUnlocked = vault.isUnlocked()
            syncFavoritesSecrets(config.favorites, 'password', config.encryptedPasswords, isUnlocked, encrypt)
            syncFavoritesSecrets(config.favorites, 'keyPassphrase', config.encryptedKeyPassphrases, isUnlocked, encrypt)
        }

        if (config.favorites && Array.isArray(config.favorites)) {
            // Защита от протечки open key в конфиг/кэш (renderer мог прислать plaintext)
            stripPlaintextPrivateKeys(config.favorites)
        }

        await migratePrivateKeyPaths(config)

        await saveConfigAsync(config)

        // Сверка MCP с конфигом нужна только если MCP вообще использовался. Пока сервер
        // выключен и ни один сервер не открыт, сверять нечего, а загрузка SDK здесь
        // означала бы его попадание в критический путь (save-config вызывается сразу
        // после запуска, при миграциях конфига в renderer).
        const previousAllowed = previousConfig.mcpAllowedServerIds || []
        const nextAllowed = config.mcpAllowedServerIds || []
        const wasMcpUsed = previousConfig.mcpEnabled || config.mcpEnabled || previousAllowed.length > 0 || nextAllowed.length > 0

        if (wasMcpUsed) {
            const mcp = await loadMcpModule()
            const allowedServerIds = new Set(nextAllowed)
            const configuredServerIds = new Set((config.favorites || []).flatMap(favorite => favorite.id ? [favorite.id] : []))
            for (const serverId of previousAllowed) {
                if (!allowedServerIds.has(serverId) || !configuredServerIds.has(serverId)) {
                    mcp.confirmationManager.revokeByServerId(serverId, mcp.getMcpStatus)
                    mcp.mcpExecutionManager.cancelByConnectionId(serverId)
                    mcp.timelineManager.cancelByConnectionId(serverId)
                }
            }

            if (!config.mcpEnabled) {
                await mcp.stopMcpServer()
            } else if (!previousConfig.mcpEnabled || previousConfig.mcpPort !== config.mcpPort) {
                await mcp.startMcpServer()
            }
        }
    })

    // Системные ресурсы
    ipcMain.handle('select-key-file', async () => {
        // Приватный ключ может лежать в файле с любым расширением (или без него),
        // поэтому показываем все файлы без фильтра по расширениям
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile']
        })
        if (canceled) return null
        return filePaths[0]
    })

    ipcMain.handle('load-private-key-file', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile']
        })
        if (canceled || filePaths.length === 0) return null
        const content = await fs.promises.readFile(filePaths[0], 'utf-8')
        if (!isSupportedPrivateKeyFormat(content)) {
            throw new Error(t('errors.invalidPrivateKey'))
        }
        return content
    })

    ipcMain.handle('read-clipboard-text', (): string => clipboard.readText())

    ipcMain.handle('encrypt-private-key', async (_, content: unknown): Promise<EncryptedSecret> => {
        if (typeof content !== 'string' || !isSupportedPrivateKeyFormat(content)) {
            throw new Error(t('errors.invalidPrivateKey'))
        }
        const appConfig = loadConfig()
        await initializeVaultAndMigrate(appConfig)
        if (!vault.isUnlocked()) {
            throw new Error(t('errors.vaultLocked'))
        }
        try {
            return vault.encrypt(content)
        } catch {
            throw new Error(t('errors.privateKeyEncryptFailed'))
        }
    })

    ipcMain.handle('select-executable-file', async () => selectExecutableFile())

    // SSH Соединения

    /** Остались ли попытки ввода учётных данных для этой сессии. */
    function canRequestAuth(id: string): boolean {
        const state = getAuthState(id)
        return !!state && state.attempt < MAX_AUTH_ATTEMPTS
    }

    /**
     * Пароль, который можно отдать серверу без вопроса пользователю. Ошибку
     * расшифровки не поднимаем: тогда сработает обычный путь отказа авторизации.
     */
    function tryResolveKnownPassword(config: SSHConfig, session: SessionAuth): string | null {
        try {
            return resolvePasswordForAuth(config, session)
        } catch (err) {
            console.error('[SSH] Failed to resolve known password:', err)
            return null
        }
    }

    /** Закрывает текущую попытку подключения, сохраняя состояние авторизации. */
    function abortSshAttempt(id: string): void {
        const client = sshClients.get(id)
        if (client) {
            client.removeAllListeners('error')
            client.on('error', () => {})
            client.destroy()
        }
        const socket = sshSockets.get(id)
        if (socket) {
            socket.removeAllListeners('error')
            socket.on('error', () => {})
            socket.destroy()
        }
        shellStreams.delete(id)
        sshClients.delete(id)
        sshSockets.delete(id)
        sshConfigs.delete(id)
        outputBatchMap.delete(id)
    }

    /**
     * Открывает SSH-сессию: TCP-соединение, авторизация и запуск оболочки.
     * Используется и при первом подключении (ssh-connect), и при повторной попытке
     * после ответа пользователя на запрос авторизации.
     *
     * @param event
     * @param id
     * @param config
     * @param cols
     * @param rows
     * @param {number} attempt - Число уже выданных запросов авторизации (0 для первого подключения).
     * @param {SessionAuth} session - Данные, введённые пользователем в этой вкладке.
     */
    function openSshSession(
        event: IpcMainEvent,
        id: string,
        config: SSHConfig,
        cols: number,
        rows: number,
        session: SessionAuth = {},
        attempt: number = 0
    ): void {
        // Предварительная очистка если сессия с таким ID уже была
        sshSockets.get(id)?.destroy()
        sshClients.get(id)?.destroy()
        shellStreams.delete(id)
        sshClients.delete(id)
        sshSockets.delete(id)
        outputBatchMap.delete(id)

        // Логин обязателен: без него сервер не пустит, поэтому сначала спрашиваем его
        if (isLoginRequired(config)) {
            console.log(`[SSH] Login required for ${config.host}:${config.port || 22} (ID: ${id})`)
            event.reply(`ssh-status-${id}`, LOGIN_REQUIRED_STATUS)
            return
        }

        beginAuthAttempt(id, config, cols, rows, attempt)

        const sshClient = new Client()
        sshClients.set(id, sshClient)
        sshConfigs.set(id, config)

        // Добавляем обработчик ошибок сразу, чтобы избежать uncaughtException
        sshClient.on('error', (err: Error & { level?: string }) => {
            if (sshClients.get(id) !== sshClient) return
            const formattedError = formatSshError(err)
            console.error(`[SSH] SSH client error for ID: ${id}: ${formattedError}`)

            // Сервер не принял учётные данные: показываем форму ввода, пока есть попытки
            if (isSshAuthFailure(err) && canRequestAuth(id)) {
                abortSshAttempt(id)
                requestAuthChallenge(event, id, 'password', { failed: true })
                return
            }

            clearAuthState(id)
            event.reply(`ssh-error-${id}`, formattedError)
            cleanupConnection(id)
        })

        // Сервер сам просит данные (например, пароль или код двухфакторной аутентификации)
        sshClient.on('keyboard-interactive', (_name, instructions, _lang, prompts, finish) => {
            if (sshClients.get(id) !== sshClient) return
            if (!canRequestAuth(id)) {
                clearAuthState(id)
                event.reply(`ssh-error-${id}`, `AUTH_FAILURE: ${t('terminal.authFailed')}`)
                cleanupConnection(id)
                return
            }
            // Известный пароль отправляем сразу, не показывая форму ввода.
            // При ключевом методе авторизации пароль не отправляем: пользователь выбрал ключ
            const knownPassword = config.authType === 'key' ? null : tryResolveKnownPassword(config, session)
            if (knownPassword !== null) {
                finish(buildKeyboardResponses(knownPassword, prompts.length))
                return
            }
            setKeyboardFinisher(id, finish, prompts.length)
            requestAuthChallenge(event, id, 'keyboard', { prompt: prompts[0]?.prompt, instructions })
        })

        const socket = net.connect(config.port || 22, config.host)
        sshSockets.set(id, socket)

        socket.on('error', (err: Error) => {
            if (sshSockets.get(id) !== socket) return
            console.error(`[SSH] Socket error for ID: ${id}: ${err.message}`)
            clearAuthState(id)
            event.reply(`ssh-error-${id}`, t('errors.socketError', { message: err.message }))
            cleanupConnection(id)
        })

        socket.on('connect', async () => {
            if (sshClients.get(id) !== sshClient || sshSockets.get(id) !== socket) return
            console.log(`[SSH] TCP socket connected for ID: ${id}`)
            socket.setNoDelay(true)

            const connectConfig: ConnectConfig = {
                sock: socket,
                username: config.user,
                readyTimeout: 20000,
                keepaliveInterval: 10000,
                keepaliveCountMax: 3
            }

            try {
                // метод авторизации выбирается строго по config.authType (auth-credentials.ts)
                applyAuthConfig(config, connectConfig, session)
            } catch (err) {
                // Ключ зашифрован: спрашиваем парольную фразу и перезапускаем подключение
                if (err instanceof PrivateKeyError && err.failure === 'passphrase' && canRequestAuth(id)) {
                    console.log(`[SSH] Passphrase required for ID: ${id}`)
                    abortSshAttempt(id)
                    requestAuthChallenge(event, id, 'passphrase')
                    return
                }
                clearAuthState(id)
                event.reply(`ssh-error-${id}`, privateKeyErrorMessage(err))
                cleanupConnection(id)
                return
            }

            try {
                // ssh2 бросает синхронно при непарсируемом privateKey — отдаём как ssh-error
                sshClient.connect(connectConfig)
            } catch (err) {
                clearAuthState(id)
                event.reply(`ssh-error-${id}`, privateKeyErrorMessage(err))
                cleanupConnection(id)
            }
        })


        sshClient.on('ready', () => {
            if (sshClients.get(id) !== sshClient) return
            console.log(`[SSH] SSH client ready for ID: ${id}`)
            clearAuthState(id)
            event.reply(`ssh-status-${id}`, t('terminal.connected'))

            const pty: PseudoTtyOptions = { rows, cols, term: 'xterm-256color' }

            sshClient.shell(pty, (err, stream) => {
                if (err || !stream) {
                    event.reply(`ssh-error-${id}`, formatSshError(err || new Error(t('errors.shellError'))))
                    return
                }

                shellStreams.set(id, stream)

                stream.on('data', (chunk: Buffer) => {
                    queueOutputChunk(event, id, chunk)
                })

                if (config.initialCommands) {
                    const commands = config.initialCommands.split('\n').filter(c => c.trim() !== '')
                    if (commands.length > 0) {
                        // Небольшая задержка, чтобы оболочка успела вывести приветствие
                        setTimeout(() => {
                            for (const cmd of commands) {
                                stream.write(cmd + '\n')
                            }
                        }, 100)
                    }
                }

                stream.on('close', () => {
                    if (shellStreams.get(id) !== stream) return
                    console.log(`[SSH] Shell stream closed for ID: ${id}`)
                    flushOutputBatch(event, id)
                    outputBatchMap.delete(id)
                    sshClient.end()
                    event.reply(`ssh-status-${id}`, t('terminal.closed'))
                })
            })
        })
    }

    ipcMain.on('ssh-connect', (event: IpcMainEvent, payload: SshConnectPayload) => {
        const { id, config, cols = 80, rows = 24 } = payload
        console.log(`[SSH] Connecting to ${config.host}:${config.port || 22} (ID: ${id})`)
        openSshSession(event, id, config, cols, rows)
    })

    // Ответ рендерера на запрос авторизации: пароль, парольная фраза, ключ или отказ
    ipcMain.on('ssh-auth-response', (event: IpcMainEvent, payload: SshAuthResponse) => {
        if (!payload || typeof payload.id !== 'string' || payload.id.length > 256) return
        const { id } = payload
        const state = getAuthState(id)
        if (!state) return

        if (payload.response === 'cancel') {
            console.log(`[SSH] Auth input cancelled for ID: ${id}`)
            clearAuthState(id)
            abortSshAttempt(id)
            event.reply(`ssh-status-${id}`, t('terminal.authCancelled'))
            return
        }

        if (payload.response === 'secret') {
            if (typeof payload.secret !== 'string' || payload.secret === '') return
            // Запрос сервера в рамках текущего соединения — отвечаем без переподключения
            const answer = takeKeyboardFinisher(id)
            if (answer) {
                answer(payload.secret)
                return
            }

            const session: SessionAuth = payload.kind === 'passphrase'
                ? { keyPassphrase: payload.secret }
                : { password: payload.secret }
            openSshSession(event, id, state.config, state.cols, state.rows, session, state.attempt)
            return
        }

        // Пользователь ввёл приватный ключ: подключаемся ключом вместо пароля
        takeKeyboardFinisher(id)
        const keyConfig: SSHConfig = { ...state.config, authType: 'key', privateKey: payload.privateKey }
        delete keyConfig.privateKeyPath
        delete keyConfig.password
        delete keyConfig.keyPassphrase
        openSshSession(event, id, keyConfig, state.cols, state.rows, {}, state.attempt)
    })

    ipcMain.on('ssh-input', (_, payload: SshInputPayload) => {
        const { id, data } = payload
        shellStreams.get(id)?.write(data)
    })

    ipcMain.on('ssh-resize', (_, payload: SshResizePayload) => {
        const { id, cols, rows } = payload
        shellStreams.get(id)?.setWindow(rows, cols, 0, 0)
    })

    ipcMain.handle('fs-stat', async (_, filePath: string) => {
        return sftpManager.statLocal(filePath)
    })

    ipcMain.on('ssh-get-os-info', (event: IpcMainEvent, id: string) => {
        if (typeof id !== 'string' || id.length > 256) return
        const client = sshClients.get(id)
        if (client) {
            console.log(`[SSH] Fetching OS info for ID: ${id}`)
            // Пытаемся получить подробную информацию через os-release, если не выходит — uname -a
            const cmd = 'cat /etc/os-release || uname -a'
            client.exec(cmd, (err, stream) => {
                if (err) {
                    console.error(`[SSH] Failed to exec OS info command for ID: ${id}: ${err.message}`)
                    return
                }
                let output = ''
                stream.on('data', (data: Buffer) => {
                    output += data.toString()
                }).on('close', () => {
                    console.log(`[SSH] OS info fetched for ID: ${id}`)
                    event.reply(`ssh-os-info-${id}`, output)
                })
            })
        }
    })

    ipcMain.on('ssh-close', (_, id: string) => {
        if (typeof id !== 'string' || id.length > 256) return
        outputBatchMap.delete(id)
        clearAuthState(id)
        cleanupConnection(id)
    })

    // SFTP Соединения
    ipcMain.on('sftp-connect', (event: IpcMainEvent, payload: SftpConnectPayload) => {
        sftpManager.connect(event, payload)
    })

    ipcMain.handle('sftp-realpath', async (_, payload: SftpRealpathRequest): Promise<string> => {
        return sftpManager.realpath(payload)
    })

    ipcMain.handle('sftp-extract', async (_, payload: SftpExtractRequest): Promise<boolean> => {
        return sftpManager.extract(payload)
    })

    ipcMain.handle('sftp-chmod', async (_, payload: SftpChmodRequest): Promise<boolean | null> => {
        return sftpManager.chmod(payload)
    })

    ipcMain.handle('sftp-readdir', async (_, payload: SftpReaddirRequest): Promise<SftpFileEntry[] | null> => {
        return sftpManager.readdir(payload)
    })

    ipcMain.handle('sftp-download-file', async (_event, payload: SftpDownloadFileRequest): Promise<SftpDownloadResult | undefined | null> => {
        return sftpManager.downloadFile(getMainWindow, payload)
    })

    ipcMain.handle('sftp-download-multiple-files', async (_event, payload: SftpDownloadMultipleRequest): Promise<(SftpDownloadResult | undefined)[] | null> => {
        return sftpManager.downloadMultipleFiles(getMainWindow, payload)
    })

    ipcMain.handle('sftp-select-files', async (_, mode: 'file' | 'folder' = 'file') => {
        return sftpManager.selectFiles(mode)
    })

    ipcMain.handle('sftp-upload-files-from-paths', async (_event, payload: SftpUploadFilesFromPathsRequest): Promise<SftpUploadResult[] | null> => {
        return sftpManager.uploadFilesFromPaths(getMainWindow, payload)
    })

    ipcMain.handle('sftp-cancel-upload', async (_, payload: SftpCancelUploadRequest): Promise<boolean> => {
        return sftpManager.cancelUpload(payload)
    })

    ipcMain.handle('sftp-open-in-editor', async (_event, payload: SftpOpenInEditorRequest): Promise<boolean | null> => {
        return sftpManager.openInEditor(getMainWindow, payload)
    })

    ipcMain.handle('sftp-open-with', async (_event, payload: SftpOpenWithRequest): Promise<boolean | null> => {
        return sftpManager.openWith(getMainWindow, payload)
    })

    ipcMain.handle('sftp-upload-direct', async (_, payload: SftpUploadDirectRequest): Promise<boolean> => {
        return sftpManager.uploadDirect(getMainWindow, payload)
    })

    ipcMain.handle('sftp-rm', async (_, payload: SftpRmRequest): Promise<boolean | null> => {
        return sftpManager.rm(payload)
    })

    ipcMain.handle('sftp-mkdir', async (_, payload: SftpMkdirRequest): Promise<boolean | null> => {
        return sftpManager.mkdir(payload)
    })

    ipcMain.handle('sftp-rename', async (_, payload: SftpRenameRequest): Promise<boolean | null> => {
        return sftpManager.rename(payload)
    })

    // Управление окном
    ipcMain.on('window-minimize', () => getMainWindow()?.minimize())
    ipcMain.on('window-maximize', () => {
        const win = getMainWindow()
        if (win) {
            if (win.isMaximized()) {
                win.unmaximize()
            } else {
                win.maximize()
            }
        }
    })
    ipcMain.on('window-close', () => {
        cleanupAll()
        const win = getMainWindow()
        if (win) win.destroy()
        app.exit(0)
    })

    // Обновления
    ipcMain.handle('check-updates', async () => {
        return await checkUpdates(getMainWindow(), true)
    })

    ipcMain.handle('start-update-download', async () => {
        return await startUpdateDownload()
    })

    ipcMain.on('quit-and-install', () => {
        quitAndInstall()
    })

    // Window utilities
    ipcMain.on('window-flash', () => {
        const win = getMainWindow()
        // Flash only if minimized (per user's specific request to avoid flashing when not minimized)
        if (win && win.isMinimized()) {
            win.flashFrame(true)
            if (process.platform === 'darwin' && app.dock) {
                app.dock.bounce()
            }
            // Stop flashing immediately when restored/focused
            win.once('focus', () => {
                win.flashFrame(false)
            })
        }
    })

    // Внешние ссылки
    ipcMain.on('open-external', (_, url: string) => {
        if (typeof url !== 'string' || url.length > 2048) return
        try {
            const parsedUrl = new URL(url.trim())
            if (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') {
                shell.openExternal(parsedUrl.toString()).catch(err => console.error('Failed to open external URL:', err))
            }
        } catch {
            // ignore malformed URLs
        }
    })

    ipcMain.handle('ssh-forward-start', async (_event, payload: SshForwardStartPayload) => {
        const { id, config, localAddress, localPort, remoteAddress, remotePort } = payload
        console.log(`[SSH] Starting port forward: ${localAddress}:${localPort} -> ${remoteAddress}:${remotePort} (ID: ${id})`)

        return new Promise((resolve, reject) => {
            const client = new Client()

            client.on('error', (err) => {
                console.error(`[SSH] SSH client error (forward): ${err.message}`)
                reject(err)
            })

            client.on('ready', () => {
                const server = net.createServer((socket) => {
                    client.forwardOut(localAddress, localPort, remoteAddress, remotePort, (err, stream) => {
                        if (err) {
                            console.error(`[SSH] forwardOut error: ${err.message}`)
                            socket.end()
                            return
                        }
                        socket.pipe(stream).pipe(socket)
                        stream.once('error', () => socket.end())
                        socket.once('error', () => stream.end())
                    })
                })

                server.listen(localPort, localAddress, () => {
                    console.log(`[SSH] Local server listening on ${localAddress}:${localPort}`)
                    if (!forwardServers.has(id)) {
                        forwardServers.set(id, new Map())
                    }
                    const forwardId = `${localAddress}:${localPort}`
                    forwardServers.get(id)!.set(forwardId, server)
                    sshClients.set(id, client)
                    resolve(true)
                })

                server.on('error', (err) => {
                    console.error(`[SSH] Local server error: ${err.message}`)
                    client.end()
                    reject(err)
                })
            })

            const connectConfig: ConnectConfig = {
                host: config.host,
                port: config.port || 22,
                username: config.user,
                readyTimeout: 20000,
            }

            try {
                // метод авторизации выбирается строго по config.authType (auth-credentials.ts)
                applyAuthConfig(config, connectConfig)
            } catch (err) {
                reject(new Error(privateKeyErrorMessage(err)))
                return
            }

            try {
                // ssh2 бросает синхронно при непарсируемом privateKey — отдаём как reject
                client.connect(connectConfig)
            } catch (err) {
                reject(new Error(privateKeyErrorMessage(err)))
            }
        })
    })

    ipcMain.handle('ssh-forward-stop', async (_, id: string) => {
        if (typeof id !== 'string' || id.length > 256) return false
        console.log(`[SSH] Stopping all port forwards for ID: ${id}`)
        const forwards = forwardServers.get(id)
        if (forwards) {
            forwards.forEach(server => server.close())
            forwardServers.delete(id)
        }
        const client = sshClients.get(id)
        if (client) {
            client.end()
            sshClients.delete(id)
        }
        return true
    })

    // Экспорт логов приложения
    ipcMain.handle('export-logs', async () => {
        const now = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const dateStr = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}_${pad(now.getHours())}.${pad(now.getMinutes())}`
        const { canceled, filePath } = await dialog.showSaveDialog({
            title: t('settings.exportLogs'),
            defaultPath: `yassh_logs_${dateStr}.log`,
            filters: [
                { name: 'Log Files (*.log)', extensions: ['log'] },
                { name: 'Text Files (*.txt)', extensions: ['txt'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        })

        if (!canceled && filePath) {
            const logsText = generateLogExportText()
            await fs.promises.writeFile(filePath, logsText, 'utf-8')
            return true
        }
        return false
    })

    // Логирование от рендерера
    ipcMain.on('log-renderer-msg', (_, payload: RendererLogMessage) => {
        if (!payload || !payload.message) return
        const level = payload.level || 'INFO'
        addLog(level, 'UI', payload.message)
    })

    // Импорт/Экспорт конфига
    ipcMain.handle('export-config', async () => {
        const config = loadConfig()
        const { canceled, filePath } = await dialog.showSaveDialog({
            title: t('settings.export'),
            defaultPath: 'minissh_config_backup.json',
            filters: [{ name: 'JSON', extensions: ['json'] }]
        })

        if (!canceled && filePath) {
            const configToExport = JSON.parse(JSON.stringify(config)) as AppConfig
            if (Array.isArray(configToExport.favorites)) {
                for (const favorite of configToExport.favorites) {
                    delete favorite.password
                    delete favorite.keyPassphrase
                }
                stripPlaintextPrivateKeys(configToExport.favorites)
            }
            await fs.promises.writeFile(filePath, JSON.stringify(configToExport, null, 2))
            return true
        }
        return false
    })

    // Vault Management
    ipcMain.handle('vault-get-status', async () => {
        const config = loadConfig()
        await initializeVaultAndMigrate(config)
        return {
            isUnlocked: vault.isUnlocked(),
            isInitialized: !!config.encryption?.salt
        }
    })

    ipcMain.handle('vault-init', async () => {
        const config = loadConfig()
        await initializeVaultAndMigrate(config)
        // If already initialized AND unlocked, don't re-init
        if (config.encryption?.salt && vault.isUnlocked()) return null

        const recoveryKey = crypto.randomBytes(32).toString('base64')
        const salt = crypto.randomBytes(16).toString('base64')

        vault.unlock(recoveryKey, salt)

        config.encryption = {
            version: 1,
            salt,
            check: vault.encrypt('YASSH_VAULT_VERIFY')
        }
        config.encryptedPasswords = {}
        config.hasAcknowledgedRecoveryKey = false

        if (safeStorage.isEncryptionAvailable()) {
            config.cachedRecoveryKey = safeStorage.encryptString(recoveryKey).toString('base64')
        }

        await saveConfigAsync(config)
        return { recoveryKey, config }
    })

    ipcMain.handle('vault-unlock', async (_, recoveryKeyInput: string) => {
        if (typeof recoveryKeyInput !== 'string') return false
        const recoveryKey = recoveryKeyInput.trim()
        if (recoveryKey.length < 10) return false

        try {
            const config = loadConfig()
            await initializeVaultAndMigrate(config)
            if (!config.encryption?.salt) return false
            const keyBuffer = Buffer.from(recoveryKey, 'base64')
            if (keyBuffer.length !== 32) return false

            vault.unlock(recoveryKey, config.encryption.salt)

            let isValidKey = true
            if (config.encryption.check) {
                try {
                    const checkVal = vault.decrypt(config.encryption.check)
                    if (checkVal !== 'YASSH_VAULT_VERIFY') isValidKey = false
                } catch {
                    isValidKey = false
                }
            } else {
                const firstEncrypted = Object.values(config.encryptedPasswords || {})[0]
                if (firstEncrypted) {
                    try {
                        vault.decrypt(firstEncrypted)
                    } catch {
                        isValidKey = false
                    }
                }
            }

            if (!isValidKey) {
                vault.lock()
                return false
            }

            if (vault.isUnlocked()) {
                // Cache for auto-unlock
                const migrated = await migratePrivateKeyPaths(config)
                if (safeStorage.isEncryptionAvailable()) {
                    config.cachedRecoveryKey = safeStorage.encryptString(recoveryKey).toString('base64')
                    await saveConfigAsync(config)
                } else if (migrated) {
                    await saveConfigAsync(config)
                }
                return true
            }
        } catch (e) {
            console.error('[Vault] Unlock failed:', e)
        }
        return false
    })

    ipcMain.handle('vault-get-recovery-key', async () => {
        const config = loadConfig()
        await initializeVaultAndMigrate(config)
        if (config.cachedRecoveryKey && safeStorage.isEncryptionAvailable()) {
            try {
                return safeStorage.decryptString(Buffer.from(config.cachedRecoveryKey, 'base64'))
            } catch {
                console.error('[Vault] Failed to decrypt cached recovery key')
            }
        }
        return null
    })

    ipcMain.handle('vault-get-password', async (_, serverId: string) => {
        if (typeof serverId !== 'string' || serverId.length > 256) return null
        const config = loadConfig()
        await initializeVaultAndMigrate(config)
        if (!vault.isUnlocked()) return null
        if (config.encryptedPasswords?.[serverId]) {
            try {
                return vault.decrypt(config.encryptedPasswords[serverId])
            } catch {
                return null
            }
        }
        return null
    })

    ipcMain.handle('vault-regenerate-key', async () => {
        const config = loadConfig()
        await initializeVaultAndMigrate(config)
        if (!vault.isUnlocked()) return null
        const oldPasswords: Record<string, string> = {}

        // Decrypt all existing passwords with active key
        for (const [id, enc] of Object.entries(config.encryptedPasswords || {})) {
            try {
                oldPasswords[id] = vault.decrypt(enc)
            } catch { /* ignore failed decryptions */ }
        }

        const oldPrivateKeys = new Map<string, string>()
        for (const fav of config.favorites) {
            if (!fav.privateKey || !fav.id) continue
            try {
                oldPrivateKeys.set(fav.id, vault.decrypt(fav.privateKey))
            } catch { /* игнорируем нерасшифровываемые blob-ы */ }
        }

        const newRecoveryKey = crypto.randomBytes(32).toString('base64')
        const newSalt = crypto.randomBytes(16).toString('base64')

        vault.unlock(newRecoveryKey, newSalt)

        config.encryptedPasswords = {}
        for (const [id, pass] of Object.entries(oldPasswords)) {
            config.encryptedPasswords[id] = vault.encrypt(pass)
        }

        // Перешифровка привязана к стабильному favorite.id, а не к индексу массива
        for (const fav of config.favorites) {
            if (!fav.privateKey || !fav.id) continue
            const content = oldPrivateKeys.get(fav.id)
            if (content !== undefined) {
                fav.privateKey = vault.encrypt(content)
            } else {
                // Blob не расшифровался старым ключом (например, из чужого импорта):
                // удаляем его, но legacy privateKeyPath остаётся как fallback.
                delete fav.privateKey
            }
        }

        config.encryption = {
            version: 1,
            salt: newSalt,
            check: vault.encrypt('YASSH_VAULT_VERIFY')
        }

        if (safeStorage.isEncryptionAvailable()) {
            config.cachedRecoveryKey = safeStorage.encryptString(newRecoveryKey).toString('base64')
        } else {
            delete config.cachedRecoveryKey
        }

        await saveConfigAsync(config)
        return { recoveryKey: newRecoveryKey, config }
    })

    ipcMain.handle('vault-reset', async () => {
        const config = loadConfig()
        await initializeVaultAndMigrate(config)
        const recoveryKey = crypto.randomBytes(32).toString('base64')
        const salt = crypto.randomBytes(16).toString('base64')

        vault.unlock(recoveryKey, salt)
        config.encryption = {
            version: 1,
            salt,
            check: vault.encrypt('YASSH_VAULT_VERIFY')
        }
        config.encryptedPasswords = {}
        config.hasAcknowledgedRecoveryKey = false

        if (safeStorage.isEncryptionAvailable()) {
            config.cachedRecoveryKey = safeStorage.encryptString(recoveryKey).toString('base64')
        } else {
            delete config.cachedRecoveryKey
        }

        if (Array.isArray(config.favorites)) {
            for (const fav of config.favorites) {
                delete fav.privateKey
            }
        }

        await saveConfigAsync(config)
        return { recoveryKey, config }
    })

    ipcMain.handle('import-config', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: t('settings.import'),
            filters: [{ name: 'JSON', extensions: ['json'] }],
            properties: ['openFile']
        })

        if (!canceled && filePaths.length > 0) {
            try {
                const content = await fs.promises.readFile(filePaths[0], 'utf-8')
                const newConfig = JSON.parse(content) as AppConfig

                // Минимальная валидация
                if (typeof newConfig !== 'object' || !Array.isArray(newConfig.favorites)) {
                    throw new Error(t('errors.invalidConfigFormat'))
                }

                const hasEncryption = !!newConfig.encryption?.salt
                const hasEncryptedPasswordsObject = typeof newConfig.encryptedPasswords === 'object' && newConfig.encryptedPasswords !== null

                if (!hasEncryption || !hasEncryptedPasswordsObject) {
                    throw new Error(t('errors.invalidConfigFormat'))
                }

                // Lock current vault before switching config
                vault.lock()

                delete newConfig.cachedRecoveryKey

                if (Array.isArray(newConfig.favorites)) {
                    for (const favorite of newConfig.favorites) {
                        delete favorite.password
                        delete favorite.keyPassphrase
                        // privateKey не удаляем: зашифрованные blob-ы живут с тем же vault
                        // (salt/recovery key), что и encryptedPasswords импортированного конфига.
                    }
                }

                await saveConfigAsync(newConfig)
                clearConfigCache()

                const reloadedConfig = loadConfig()
                return { config: reloadedConfig }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                throw new Error(t('errors.importError', { message }))
            }
        }
        return null
    })
}
