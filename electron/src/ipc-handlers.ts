import {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    type IpcMainEvent,
    safeStorage,
    shell
} from 'electron'
import {Client, type ConnectConfig, PseudoTtyOptions} from 'ssh2'
import * as net from 'node:net'
import * as fs from 'node:fs'
import {clearConfigCache, loadConfig, loadConfigAsync, saveConfigAsync, initializeVaultAndMigrate, migratePrivateKeyPaths} from './config.js'
import {vault} from './vault.js'
import {resolvePrivateKey, privateKeyErrorMessage} from './private-key.js'
import {t} from './i18n-main.js'
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
import { AppConfig, EncryptedSecret } from '../../src/types.js'
import { looksLikePrivateKey } from '../../src/utils/privateKey.js'
import { SshConnectPayload, SshForwardStartPayload, SshInputPayload, SshResizePayload } from '../../src/ipc/ssh.js'
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
import {
    getMcpStatus,
    getMcpToken,
    handleMcpConfirmationResponse,
    setMcpMainWindowGetter,
    startMcpServer,
    stopMcpServer,
    syncMcpServerState,
    confirmationManager
} from './mcp-server.js'
import { mcpExecutionManager } from './mcp/execution-manager.js'
import { timelineManager } from './mcp/timeline-manager.js'
import { sftpManager } from './sftp/SftpManager.js'

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
 * Форматирует ошибку SSH для отправки на фронтенд.
 * Позволяет фронтенду распознавать специфические ошибки (например, аутентификации).
 */
function formatSshError(err: Error & { level?: string }): string {
    const message = err.message || String(err);
    // Проверка на ошибку аутентификации
    if (err.level === 'client-authentication' ||
        message.includes('authentication failed') ||
        message.includes('All configured authentication methods failed')) {
        return `AUTH_FAILURE: ${t('terminal.authFailed')}`;
    }
    return message;
}

/**
 * Регистрирует все IPC-обработчики приложения.
 *
 * @param {() => BrowserWindow | null} getMainWindow - Функция для получения актуального экземпляра главного окна.
 */
export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null) {
    setMcpMainWindowGetter(getMainWindow)
    syncMcpServerState().catch(err => console.error('[MCP] Sync error:', err))

    // MCP IPC Handlers
    ipcMain.handle('mcp-get-status', () => getMcpStatus())
    ipcMain.handle('mcp-get-token', () => getMcpToken())

    ipcMain.handle('mcp-toggle', async (_, enabled: boolean) => {
        const config = loadConfig()
        config.mcpEnabled = enabled
        await saveConfigAsync(config)
        if (enabled) {
            await startMcpServer()
        } else {
            await stopMcpServer()
        }
        return getMcpStatus()
    })

    ipcMain.handle('mcp-regenerate-token', async () => {
        const config = loadConfig()
        config.mcpToken = crypto.randomBytes(16).toString('hex')
        await saveConfigAsync(config)
        if (config.mcpEnabled) {
            await stopMcpServer()
            await startMcpServer()
        }
        return getMcpStatus()
    })

    ipcMain.handle('mcp-open-server', async (_, serverId: string) => {
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
            await startMcpServer()
        }
        return getMcpStatus()
    })

    ipcMain.handle('mcp-close-server', async (_, serverId: string) => {
        const config = loadConfig()
        if (Array.isArray(config.mcpAllowedServerIds)) {
            config.mcpAllowedServerIds = config.mcpAllowedServerIds.filter(id => id !== serverId)
            await saveConfigAsync(config)
        }
        confirmationManager.revokeByServerId(serverId)
        mcpExecutionManager.cancelByConnectionId(serverId)
        timelineManager.cancelByConnectionId(serverId)
        return getMcpStatus()
    })

    ipcMain.handle('mcp-confirm-command', (_, payload: McpConfirmCommandPayload) => {
        handleMcpConfirmationResponse(payload.id, payload.approved)
        return true
    })

    ipcMain.handle('mcp-cancel-run', (_, runId: string) => {
        const cancelled = timelineManager.cancelRun(runId)
        if (cancelled) {
            const win = getMainWindow()
            if (win && !win.isDestroyed()) {
                win.webContents.send('mcp-status-changed', getMcpStatus())
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
        const win = getMainWindow()
        if (win) {
            const isMaximized = win.isMaximized()
            const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
            config.x = Math.round(bounds.x)
            config.y = Math.round(bounds.y)
            config.width = Math.round(bounds.width)
            config.height = Math.round(bounds.height)
            config.maximized = isMaximized
        }
        // If config includes updated passwords in favorites (e.g. from ConnectionForm), move them to vault
        if (config.favorites && Array.isArray(config.favorites)) {
            if (!config.encryptedPasswords) config.encryptedPasswords = {}

            for (const fav of config.favorites) {
                if (fav.password && fav.id) {
                    if (vault.isUnlocked()) {
                        config.encryptedPasswords[fav.id] = vault.encrypt(fav.password)
                        delete fav.password
                    }
                }
            }
        }

        migratePrivateKeyPaths(config)

        await saveConfigAsync(config)

        const allowedServerIds = new Set(config.mcpAllowedServerIds || [])
        const configuredServerIds = new Set((config.favorites || []).flatMap(favorite => favorite.id ? [favorite.id] : []))
        for (const serverId of previousConfig.mcpAllowedServerIds || []) {
            if (!allowedServerIds.has(serverId) || !configuredServerIds.has(serverId)) {
                confirmationManager.revokeByServerId(serverId, getMcpStatus)
                mcpExecutionManager.cancelByConnectionId(serverId)
                timelineManager.cancelByConnectionId(serverId)
            }
        }

        if (!config.mcpEnabled) {
            await stopMcpServer()
        } else if (!previousConfig.mcpEnabled || previousConfig.mcpPort !== config.mcpPort) {
            await startMcpServer()
        }
    })

    // Системные ресурсы
    ipcMain.handle('select-key-file', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [
                { name: 'Keys', extensions: ['*', 'pem', 'ppk'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        })
        if (canceled) return null
        return filePaths[0]
    })

    ipcMain.handle('load-private-key-file', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [
                { name: 'Keys', extensions: ['*', 'pem', 'ppk'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        })
        if (canceled || filePaths.length === 0) return null
        return await fs.promises.readFile(filePaths[0], 'utf-8')
    })

    ipcMain.handle('encrypt-private-key', (_, content: unknown): EncryptedSecret => {
        if (typeof content !== 'string' || !looksLikePrivateKey(content)) {
            throw new Error(t('errors.invalidPrivateKey'))
        }
        const appConfig = loadConfig()
        initializeVaultAndMigrate(appConfig)
        if (!vault.isUnlocked()) {
            throw new Error(t('errors.vaultLocked'))
        }
        return vault.encrypt(content)
    })

    ipcMain.handle('select-executable-file', async () => {
        const filters = process.platform === 'win32'
            ? [{ name: 'Applications', extensions: ['exe'] }, { name: 'All Files', extensions: ['*'] }]
            : process.platform === 'darwin'
                ? [{ name: 'Applications', extensions: ['app'] }, { name: 'All Files', extensions: ['*'] }]
                : [{ name: 'All Files', extensions: ['*'] }]
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: t('sftp.openWith'),
            properties: ['openFile'],
            filters
        })
        if (canceled || filePaths.length === 0) return null
        return filePaths[0]
    })

    // SSH Соединения
    ipcMain.on('ssh-connect', (event: IpcMainEvent, payload: SshConnectPayload) => {
        const { id, config, cols = 80, rows = 24 } = payload
        console.log(`[SSH] Connecting to ${config.host}:${config.port || 22} (ID: ${id})`)

        // Предварительная очистка если сессия с таким ID уже была
        sshSockets.get(id)?.destroy()
        sshClients.get(id)?.destroy()
        shellStreams.delete(id)
        sshClients.delete(id)
        sshSockets.delete(id)
        outputBatchMap.delete(id)

        const sshClient = new Client()
        sshClients.set(id, sshClient)
        sshConfigs.set(id, config)

        // Добавляем обработчик ошибок сразу, чтобы избежать uncaughtException
        sshClient.on('error', (err: Error & { level?: string }) => {
            if (sshClients.get(id) !== sshClient) return
            const formattedError = formatSshError(err)
            console.error(`[SSH] SSH client error for ID: ${id}: ${formattedError}`)
            event.reply(`ssh-error-${id}`, formattedError)
            cleanupConnection(id)
        })

        const socket = net.connect(config.port || 22, config.host)
        sshSockets.set(id, socket)

        socket.on('error', (err: Error) => {
            if (sshSockets.get(id) !== socket) return
            console.error(`[SSH] Socket error for ID: ${id}: ${err.message}`)
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

            if (config.authType === 'key' && (config.privateKey || config.privateKeyPath)) {
                try {
                    connectConfig.privateKey = resolvePrivateKey(config)
                } catch (err) {
                    event.reply(`ssh-error-${id}`, privateKeyErrorMessage(err))
                    cleanupConnection(id)
                    return
                }
            } else {
                const appConfig = loadConfig()
                initializeVaultAndMigrate(appConfig)
                const serverId = config.id
                if (serverId && appConfig.encryptedPasswords?.[serverId]) {
                    try {
                        connectConfig.password = vault.decrypt(appConfig.encryptedPasswords[serverId])
                    } catch {
                        event.reply(`ssh-error-${id}`, t('errors.vaultDecryptFailed'))
                        cleanupConnection(id)
                        return
                    }
                } else {
                    connectConfig.password = config.password
                }
            }

            sshClient.connect(connectConfig)
        })


        sshClient.on('ready', () => {
            if (sshClients.get(id) !== sshClient) return
            console.log(`[SSH] SSH client ready for ID: ${id}`)
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

            if (config.authType === 'key' && (config.privateKey || config.privateKeyPath)) {
                try {
                    connectConfig.privateKey = resolvePrivateKey(config)
                } catch (err) {
                    reject(new Error(privateKeyErrorMessage(err)))
                    return
                }
            } else {
                const appConfig = loadConfig()
                initializeVaultAndMigrate(appConfig)
                const serverId = config.id
                if (serverId && appConfig.encryptedPasswords?.[serverId]) {
                    try {
                        connectConfig.password = vault.decrypt(appConfig.encryptedPasswords[serverId])
                    } catch {
                        reject(new Error(t('errors.vaultDecryptFailed')))
                        return
                    }
                } else {
                    connectConfig.password = config.password
                }
            }

            client.connect(connectConfig)
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
            await fs.promises.writeFile(filePath, JSON.stringify(config, null, 2))
            return true
        }
        return false
    })

    // Vault Management
    ipcMain.handle('vault-get-status', () => {
        const config = loadConfig()
        initializeVaultAndMigrate(config)
        return {
            isUnlocked: vault.isUnlocked(),
            isInitialized: !!config.encryption?.salt
        }
    })

    ipcMain.handle('vault-init', async () => {
        const config = loadConfig()
        initializeVaultAndMigrate(config)
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
            initializeVaultAndMigrate(config)
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
                const migrated = migratePrivateKeyPaths(config)
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

    ipcMain.handle('vault-get-recovery-key', () => {
        const config = loadConfig()
        initializeVaultAndMigrate(config)
        if (config.cachedRecoveryKey && safeStorage.isEncryptionAvailable()) {
            try {
                return safeStorage.decryptString(Buffer.from(config.cachedRecoveryKey, 'base64'))
            } catch {
                console.error('[Vault] Failed to decrypt cached recovery key')
            }
        }
        return null
    })

    ipcMain.handle('vault-get-password', (_, serverId: string) => {
        if (typeof serverId !== 'string' || serverId.length > 256) return null
        const config = loadConfig()
        initializeVaultAndMigrate(config)
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
        initializeVaultAndMigrate(config)
        if (!vault.isUnlocked()) return null
        const oldPasswords: Record<string, string> = {}

        // Decrypt all existing passwords with active key
        for (const [id, enc] of Object.entries(config.encryptedPasswords || {})) {
            try {
                oldPasswords[id] = vault.decrypt(enc)
            } catch { /* ignore failed decryptions */ }
        }

        const oldPrivateKeys = new Map<number, string>()
        config.favorites.forEach((fav, index) => {
            if (!fav.privateKey) return
            try {
                oldPrivateKeys.set(index, vault.decrypt(fav.privateKey))
            } catch { /* ignore failed decryptions */ }
        })

        const newRecoveryKey = crypto.randomBytes(32).toString('base64')
        const newSalt = crypto.randomBytes(16).toString('base64')

        vault.unlock(newRecoveryKey, newSalt)

        config.encryptedPasswords = {}
        for (const [id, pass] of Object.entries(oldPasswords)) {
            config.encryptedPasswords[id] = vault.encrypt(pass)
        }

        config.favorites.forEach((fav, index) => {
            if (!fav.privateKey) return
            const content = oldPrivateKeys.get(index)
            if (content !== undefined) {
                fav.privateKey = vault.encrypt(content)
            } else {
                delete fav.privateKey
            }
        })

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
        initializeVaultAndMigrate(config)
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
                        delete favorite.privateKey
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
