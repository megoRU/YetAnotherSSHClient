import {app, BrowserWindow, dialog, ipcMain, type IpcMainEvent, type OpenDialogOptions, shell} from 'electron'
import {Client, type ConnectConfig, PseudoTtyOptions, type SFTPWrapper} from 'ssh2'
import * as net from 'node:net'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {loadConfig, loadConfigAsync, saveConfigAsync, clearConfigCache} from './config.js'
import {vault} from './vault.js'
import * as crypto from 'node:crypto'
import {safeStorage} from 'electron'
import {checkUpdates, quitAndInstall, startUpdateDownload} from './update-service.js'
import {
    cleanupAll,
    cleanupConnection,
    sftpClients,
    sftpTempDirs,
    sftpTransferClients,
    registerTransferClient,
    unregisterTransferClient,
    sftpWatchers,
    shellStreams,
    sshClients,
    sshConfigs,
    sshSockets,
    forwardServers
} from './ssh-manager.js'
import {
    AppConfig,
    SftpConnectPayload,
    SftpDownloadResult,
    SftpFileEntry,
    SftpProgress,
    SftpUploadResult,
    SshConnectPayload,
    SSHConfig
} from './types.js'

const pendingHostKeyRequests = new Map<string, (approved: boolean) => void>()

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
        return `AUTH_FAILURE: ${message}`;
    }
    return message;
}

/**
 * Проверяет SSH Host Key (TOFU).
 *
 * @param {Buffer} key - Публичный ключ сервера.
 * @param {SSHConfig} config - Конфигурация соединения.
 * @param {() => BrowserWindow | null} getMainWindow - Функция для получения главного окна.
 * @returns {Promise<boolean>} true, если ключ доверенный или новый; false, если ключ изменился.
 */
async function verifyHostKey(key: Buffer, config: SSHConfig, getMainWindow: () => BrowserWindow | null): Promise<boolean> {
    const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
    const hostKey = `${config.host}:${config.port || 22}`
    const appConfig = loadConfig()
    if (!appConfig.knownHosts) appConfig.knownHosts = {}

    const knownFingerprint = appConfig.knownHosts[hostKey]

    if (knownFingerprint === fingerprint) {
        return true
    }

    const win = getMainWindow()
    if (!win) return false

    return new Promise((resolve) => {
        const requestId = crypto.randomUUID()
        pendingHostKeyRequests.set(requestId, (approved) => {
            if (approved) {
                const currentConfig = loadConfig()
                if (!currentConfig.knownHosts) currentConfig.knownHosts = {}
                currentConfig.knownHosts[hostKey] = fingerprint
                void saveConfigAsync(currentConfig)
            }
            resolve(approved)
        })

        win.webContents.send('host-key-verify-request', requestId, hostKey, fingerprint)
    })
}

/**
 * Регистрирует все IPC-обработчики приложения.
 *
 * @param {() => BrowserWindow | null} getMainWindow - Функция для получения актуального экземпляра главного окна.
 */
export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null) {
    // Конфигурация
    ipcMain.handle('get-config', async () => await loadConfigAsync())
    ipcMain.handle('save-config', async (_, config: AppConfig) => {
        if (!config || typeof config !== 'object' || !Array.isArray(config.favorites)) {
            throw new Error('Invalid config payload')
        }

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

        await saveConfigAsync(config)
    })

    // Security
    ipcMain.on('host-key-verify-response', (_, requestId: string, approved: boolean) => {
        if (typeof requestId !== 'string' || typeof approved !== 'boolean') return
        const callback = pendingHostKeyRequests.get(requestId)
        if (callback) {
            callback(approved)
            pendingHostKeyRequests.delete(requestId)
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

    // SSH Соединения
    ipcMain.on('ssh-connect', (event: IpcMainEvent, payload: SshConnectPayload) => {
        if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string' || !payload.config) {
            console.error('[SSH] Invalid connect payload')
            return
        }

        const { id, config, cols = 80, rows = 24 } = payload
        console.log(`[SSH] Connecting to ${config.host}:${config.port || 22} (ID: ${id})`)

        // Предварительная очистка если сессия с таким ID уже была
        sshSockets.get(id)?.destroy()
        sshClients.get(id)?.destroy()
        shellStreams.delete(id)
        sshClients.delete(id)
        sshSockets.delete(id)

        const sshClient = new Client()
        sshClients.set(id, sshClient)
        sshConfigs.set(id, config)

        // Добавляем обработчик ошибок сразу, чтобы избежать uncaughtException
        sshClient.on('error', (err: Error & { level?: string }) => {
            const formattedError = formatSshError(err)
            console.error(`[SSH] SSH client error for ID: ${id}: ${formattedError}`)
            event.reply(`ssh-error-${id}`, formattedError)
            cleanupConnection(id)
        })

        const socket = net.connect(config.port || 22, config.host)
        sshSockets.set(id, socket)

        socket.on('error', (err: Error) => {
            console.error(`[SSH] Socket error for ID: ${id}: ${err.message}`)
            event.reply(`ssh-error-${id}`, `Socket error: ${err.message}`)
            cleanupConnection(id)
        })

        socket.on('connect', async () => {
            console.log(`[SSH] TCP socket connected for ID: ${id}`)
            socket.setNoDelay(true)

            const connectConfig: ConnectConfig = {
                sock: socket,
                username: config.user,
                readyTimeout: 20000,
                keepaliveInterval: 10000,
                keepaliveCountMax: 3,
                hostVerifier: (key: Buffer) => verifyHostKey(key, config, getMainWindow)
            }

            if (config.authType === 'key' && config.privateKeyPath) {
                try {
                    connectConfig.privateKey = await fs.promises.readFile(config.privateKeyPath)
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err)
                    event.reply(`ssh-error-${id}`, `Failed to read private key: ${message}`)
                    cleanupConnection(id)
                    return
                }
            } else {
                const appConfig = loadConfig()
                const serverId = config.id
                if (serverId && appConfig.encryptedPasswords?.[serverId]) {
                    try {
                        connectConfig.password = vault.decrypt(appConfig.encryptedPasswords[serverId])
                    } catch {
                        const lang = appConfig.language || 'ru'
                        const msg = lang === 'ru' ? 'Хранилище заблокировано или расшифровка не удалась' : 'Vault is locked or decryption failed'
                        event.reply(`ssh-error-${id}`, msg)
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
            console.log(`[SSH] SSH client ready for ID: ${id}`)
            event.reply(`ssh-status-${id}`, 'Установлено соединение')

            const pty: PseudoTtyOptions = { rows, cols, term: 'xterm-256color' }

            sshClient.shell(pty, (err, stream) => {
                if (err || !stream) {
                    event.reply(`ssh-error-${id}`, formatSshError(err || new Error('Shell error')))
                    return
                }

                shellStreams.set(id, stream)

                stream.on('data', (chunk: Buffer) => {
                    event.reply(`ssh-output-${id}`, chunk)
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
                    console.log(`[SSH] Shell stream closed for ID: ${id}`)
                    sshClient.end()
                    event.reply(`ssh-status-${id}`, 'Соединение закрыто')
                })
            })
        })
    })

    ipcMain.on('ssh-input', (_, payload: { id: string; data: string }) => {
        if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string' || typeof payload.data !== 'string') return
        const { id, data } = payload
        shellStreams.get(id)?.write(data)
    })

    ipcMain.on('ssh-resize', (_, payload: { id: string; cols: number; rows: number }) => {
        if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string' || typeof payload.cols !== 'number' || typeof payload.rows !== 'number') return
        const { id, cols, rows } = payload
        shellStreams.get(id)?.setWindow(rows, cols, 0, 0)
    })

    /**
     * Рекурсивно вычисляет суммарный размер файлов в папке.
     */
    async function getFolderSize(dirPath: string, depth = 0, visited = new Set<string>()): Promise<number> {
        if (depth > 20) return 0

        let size = 0
        try {
            const realPath = await fs.promises.realpath(dirPath)
            if (visited.has(realPath)) return 0
            visited.add(realPath)

            const files = await fs.promises.readdir(dirPath)
            for (const file of files) {
                const filePath = path.join(dirPath, file)
                try {
                    const stats = await fs.promises.lstat(filePath)
                    if (stats.isSymbolicLink()) continue
                    if (stats.isDirectory()) {
                        size += await getFolderSize(filePath, depth + 1, visited)
                    } else {
                        size += stats.size
                    }
                } catch (e) {
                    console.error(`[FS] Error stating ${filePath}:`, e)
                }
            }
        } catch (e) {
            console.error(`[FS] Error reading directory ${dirPath}:`, e)
        }
        return size
    }

    ipcMain.handle('fs-stat', async (_, filePath: string) => {
        if (typeof filePath !== 'string' || filePath.length > 4096) return null
        try {
            const stats = await fs.promises.stat(filePath)
            const isDir = stats.isDirectory()
            return {
                isDir,
                size: isDir ? await getFolderSize(filePath) : stats.size
            }
        } catch (err) {
            console.error(`[FS] Error stating file ${filePath}:`, err)
            return null
        }
    })

    /**
     * Рекурсивно вычисляет суммарный размер файлов в удаленной папке.
     */
    async function getRemoteFolderSize(sftp: SFTPWrapper, remotePath: string, depth = 0): Promise<number> {
        if (depth > 20) return 0

        return new Promise((resolve) => {
            sftp.readdir(remotePath, async (err, list) => {
                if (err) return resolve(0)
                try {
                    const tasks = list.map(async (item) => {
                        if (item.filename === '.' || item.filename === '..') return 0
                        const itemPath = `${remotePath}/${item.filename}`.replace(/\/+/g, '/')
                        const isDir = (item.attrs.mode & 0o170000) === 0o040000
                        const isLink = (item.attrs.mode & 0o170000) === 0o120000
                        if (isLink) return 0 // Защита от циклов через симлинки
                        if (isDir) {
                            return await getRemoteFolderSize(sftp, itemPath, depth + 1)
                        } else {
                            return item.attrs.size
                        }
                    })
                    const sizes = await Promise.all(tasks)
                    resolve(sizes.reduce((a, b) => a + b, 0))
                } catch (e) {
                    console.error(`[SFTP] Error calculating remote folder size for ${remotePath}:`, e)
                    resolve(0)
                }
            })
        })
    }

    ipcMain.on('ssh-get-os-info', (event: IpcMainEvent, id: string) => {
        if (typeof id !== 'string' || id.length > 64 || id.length === 0) return
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
        if (typeof id !== 'string' || id.length > 64) return
        cleanupConnection(id)
    })

    // SFTP Соединения
    ipcMain.on('sftp-connect', (event: IpcMainEvent, payload: SftpConnectPayload) => {
        if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string' || !payload.config) {
            console.error('[SFTP] Invalid connect payload')
            return
        }

        const { id, config } = payload
        console.log(`[SFTP] Connecting to ${config.host}:${config.port || 22} (ID: ${id})`)

        const existingClient = sshClients.get(id)
        // @ts-expect-error - Checking internal _sock for activity
        if (existingClient && existingClient._sock && !existingClient._sock.destroyed) {
            console.log(`[SFTP] Reusing existing SSH client for ID: ${id}`)
            existingClient.sftp((err, sftp) => {
                if (err) {
                    const formattedError = formatSshError(err);
                    console.error(`[SFTP] SFTP request error (reuse): ${formattedError}`)
                    event.reply(`sftp-error-${id}`, formattedError)
                    return
                }
                console.log(`[SFTP] SFTP session ready (reuse) for ID: ${id}`)
                sftpClients.set(id, sftp)
                event.reply(`sftp-status-${id}`, 'SFTP сессия готова')
            })
            return
        }

        cleanupConnection(id)

        const sshClient = new Client()
        sshClients.set(id, sshClient)
        sshConfigs.set(id, config)

        // Добавляем обработчик ошибок сразу
        sshClient.on('error', (err: Error & { level?: string }) => {
            const formattedError = formatSshError(err);
            console.error(`[SFTP] SSH client error for ID: ${id}: ${formattedError}`)
            event.reply(`sftp-error-${id}`, formattedError)
            cleanupConnection(id)
        })

        const socket = net.connect({
            port: config.port || 22,
            host: config.host,
            timeout: 15000
        })
        sshSockets.set(id, socket)

        socket.on('connect', async () => {
            console.log(`[SFTP] TCP socket connected for ID: ${id}`)
            socket.setNoDelay(true)
            const connectConfig: ConnectConfig = {
                sock: socket,
                username: config.user,
                readyTimeout: 20000,
                keepaliveInterval: 10000,
                keepaliveCountMax: 3,
                hostVerifier: (key: Buffer) => verifyHostKey(key, config, getMainWindow)
            }

            if (config.authType === 'key' && config.privateKeyPath) {
                try {
                    connectConfig.privateKey = await fs.promises.readFile(config.privateKeyPath)
                } catch (err) {
                    console.error(`[SFTP] Private key read error: ${err}`)
                    event.reply(`sftp-error-${id}`, `Ошибка чтения ключа: ${err}`)
                    cleanupConnection(id)
                    return
                }
            } else {
                const appConfig = loadConfig()
                const serverId = config.id
                if (serverId && appConfig.encryptedPasswords?.[serverId]) {
                    try {
                        connectConfig.password = vault.decrypt(appConfig.encryptedPasswords[serverId])
                    } catch {
                        const lang = appConfig.language || 'ru'
                        const msg = lang === 'ru' ? 'Хранилище заблокировано или расшифровка не удалась' : 'Vault is locked or decryption failed'
                        event.reply(`sftp-error-${id}`, msg)
                        cleanupConnection(id)
                        return
                    }
                } else {
                    connectConfig.password = config.password
                }
            }

            console.log(`[SFTP] Starting SSH handshake for ID: ${id}`)
            sshClient.connect(connectConfig)
        })

        socket.on('timeout', () => {
            console.error(`[SFTP] TCP connection timeout for ID: ${id}`)
            event.reply(`sftp-error-${id}`, 'Тайм-аут соединения (TCP)')
            cleanupConnection(id)
        })

        socket.on('error', (err: Error) => {
            console.error(`[SFTP] Socket error for ID: ${id}: ${err.message}`)
            event.reply(`sftp-error-${id}`, `Ошибка сокета: ${err.message}`)
            cleanupConnection(id)
        })

        sshClient.on('ready', () => {
            console.log(`[SFTP] SSH client ready, requesting SFTP for ID: ${id}`)
            sshClient.sftp((err, sftp) => {
                if (err) {
                    const formattedError = formatSshError(err);
                    console.error(`[SFTP] SFTP request error: ${formattedError}`)
                    event.reply(`sftp-error-${id}`, formattedError)
                    return
                }
                console.log(`[SFTP] SFTP session ready for ID: ${id}`)
                sftpClients.set(id, sftp)
                event.reply(`sftp-status-${id}`, 'SFTP сессия готова')
            })
        })

        sshClient.on('end', () => {
            console.log(`[SFTP] SSH connection ended for ID: ${id}`)
            event.reply(`sftp-status-${id}`, 'SFTP-соединение завершено')
            cleanupConnection(id)
        })

        sshClient.on('close', () => {
            console.log(`[SFTP] SSH connection closed for ID: ${id}`)
            event.reply(`sftp-status-${id}`, 'SFTP-соединение закрыто')
            cleanupConnection(id)
        })
    })

    const normalizeRemotePath = (p: string) => p.replace(/\/+/g, '/').replace(/\/$/, '') || '/'

    ipcMain.handle('sftp-realpath', async (_, payload: { id: string; path: string }): Promise<string> => {
        if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string' || typeof payload.path !== 'string') return '/'
        const { id, path } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) return '/'

        return new Promise((resolve, reject) => {
            sftp.realpath(path, (err, resolvedPath) => {
                if (err) reject(err)
                else resolve(resolvedPath)
            })
        })
    })

    ipcMain.handle('sftp-stat', async (_, payload: { id: string; path: string }): Promise<SftpFileEntry['attrs'] | null> => {
        if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string' || typeof payload.path !== 'string') return null
        const { id, path } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        return new Promise((resolve, reject) => {
            sftp.stat(path, (err, stats) => {
                if (err) reject(err)
                else resolve(stats)
            })
        })
    })

    ipcMain.handle('sftp-extract', async (_, payload: { id: string; remotePath: string }): Promise<boolean> => {
        const { id, remotePath } = payload
        console.log(`[SFTP] Extracting archive: ${remotePath} (ID: ${id})`)
        const client = sshClients.get(id)
        if (!client) throw new Error('SSH-клиент не найден')

        const ext = path.extname(remotePath).toLowerCase()
        const dir = path.dirname(remotePath)
        let cmd = ''

        const escapePath = (p: string) => `'` + p.replace(/'/g, `'\\''`) + `'`
        const escapedPath = escapePath(remotePath)
        const escapedDir = escapePath(dir)

        if (ext === '.zip') {
            cmd = `unzip -o ${escapedPath} -d ${escapedDir}`
        } else if (ext === '.tar') {
            cmd = `tar -xf ${escapedPath} -C ${escapedDir}`
        } else if (ext === '.gz' || ext === '.tgz') {
            cmd = `tar -xzf ${escapedPath} -C ${escapedDir}`
        } else if (ext === '.bz2') {
            cmd = `tar -xjf ${escapedPath} -C ${escapedDir}`
        } else {
            throw new Error('Неподдерживаемый формат архива')
        }

        return new Promise((resolve, reject) => {
            client.exec(cmd, (err, stream) => {
                if (err) return reject(err)
                let errorOutput = ''
                stream.stderr.on('data', (data: Buffer) => {
                    errorOutput += data.toString()
                })
                stream.on('close', (code: number) => {
                    if (code === 0) resolve(true)
                    else reject(new Error(errorOutput || `Ошибка распаковки (код ${code})`))
                })
            })
        })
    })

    async function downloadRecursive(
        id: string,
        remote: string,
        local: string,
        sftpOverride?: SFTPWrapper,
        transferId: string = 'internal',
        state?: { transferred: number; total: number; rootPath: string }
    ): Promise<SftpDownloadResult | undefined> {
        const sftp = sftpOverride || sftpClients.get(id)
        if (!sftp) return undefined

        const normalizedRemote = normalizeRemotePath(remote)

        return new Promise((resolve, reject) => {
            sftp.stat(normalizedRemote, (err, stats) => {
                if (err) return reject(err)

                if (stats.isDirectory()) {
                    if (!fs.existsSync(local)) fs.mkdirSync(local, { recursive: true })

                    const win = getMainWindow()
                    if (win && !state) {
                        const progress: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 0, type: 'download' }
                        win.webContents.send(`sftp-progress-${id}`, progress)
                    }

                    sftp.readdir(normalizedRemote, async (err, list) => {
                        if (err) return reject(err)
                        try {
                            for (const item of list) {
                                if (item.filename === '.' || item.filename === '..') continue
                                if (transferId !== 'internal' && !sftpTransferClients.has(transferId) && sftpOverride) break;
                                await downloadRecursive(id, `${normalizedRemote}/${item.filename}`, path.join(local, item.filename), sftp, transferId, state)
                            }
                            if (win && !state) {
                                const progress: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 100, type: 'download' }
                                win.webContents.send(`sftp-progress-${id}`, progress)
                            }
                            resolve({ remotePath: normalizedRemote, localPath: local, isDir: true })
                        } catch (re) {
                            reject(re)
                        }
                    })
                } else {
                    let lastProgressTime = 0
                    let lastIndividualTransferred = 0

                    sftp.fastGet(normalizedRemote, local, {
                        step: (transferred, _chunk, total) => {
                            if (transferId !== 'internal' && !sftpTransferClients.has(transferId) && sftpOverride) return;

                            if (state) {
                                state.transferred += (transferred - lastIndividualTransferred)
                                lastIndividualTransferred = transferred
                            }

                            const now = Date.now()
                            if (now - lastProgressTime > 100 || transferred === total) {
                                lastProgressTime = now
                                const win = getMainWindow()
                                if (win) {
                                    if (state) {
                                        const progress = state.total > 0 ? Math.min(Math.round((state.transferred / state.total) * 100), 100) : 100
                                        const progressData: SftpProgress = { id: transferId, remotePath: state.rootPath, progress, transferred: state.transferred, total: state.total, type: 'download' }
                                        win.webContents.send(`sftp-progress-${id}`, progressData)
                                    } else {
                                        const progress = Math.round((transferred / total) * 100)
                                        const progressData: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress, transferred, total, type: 'download' }
                                        win.webContents.send(`sftp-progress-${id}`, progressData)
                                    }
                                }
                            }
                        }
                    }, (err) => {
                        if (err) {
                            const readStream = sftp.createReadStream(normalizedRemote)
                            const writeStream = fs.createWriteStream(local)

                            let transferred = 0
                            readStream.on('data', (chunk: Buffer) => {
                                if (transferId !== 'internal' && !sftpTransferClients.has(transferId) && sftpOverride) {
                                    readStream.destroy();
                                    return;
                                }
                                transferred += chunk.length
                                if (state) {
                                    state.transferred += chunk.length
                                }

                                const now = Date.now()
                                if (now - lastProgressTime > 100 || transferred === stats.size) {
                                    lastProgressTime = now
                                    const win = getMainWindow()
                                    if (win) {
                                        if (state) {
                                            const progress = state.total > 0 ? Math.min(Math.round((state.transferred / state.total) * 100), 100) : 100
                                            win.webContents.send(`sftp-progress-${id}`, { id: transferId, remotePath: state.rootPath, progress, transferred: state.transferred, total: state.total, type: 'download' })
                                        } else {
                                            const progress = Math.round((transferred / stats.size) * 100)
                                            win.webContents.send(`sftp-progress-${id}`, { id: transferId, remotePath: normalizedRemote, progress, transferred, total: stats.size, type: 'download' })
                                        }
                                    }
                                }
                            })

                            writeStream.on('close', () => {
                                if (!state) {
                                    const win = getMainWindow()
                                    if (win) win.webContents.send(`sftp-progress-${id}`, { id: transferId, remotePath: normalizedRemote, progress: 100, type: 'download' })
                                }
                                resolve({ remotePath: normalizedRemote, localPath: local, size: stats.size })
                            })
                            writeStream.on('error', (e) => {
                                if (fs.existsSync(local)) try { fs.unlinkSync(local) } catch { /* ignore */ }
                                reject(e)
                            })
                            readStream.on('error', reject)
                            readStream.pipe(writeStream)
                        }
                        else {
                            if (!state) {
                                const win = getMainWindow()
                                if (win) {
                                    const progressData: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 100, type: 'download' }
                                    win.webContents.send(`sftp-progress-${id}`, progressData)
                                }
                            }
                            resolve({ remotePath: normalizedRemote, localPath: local, size: stats.size })
                        }
                    })
                }
            })
        })
    }

    ipcMain.handle('sftp-download-multiple-files', async (_event, payload: { id: string; files: { remotePath: string; filename: string; transferId: string; isDir?: boolean }[] }): Promise<(SftpDownloadResult | undefined)[] | null> => {
        const { id, files } = payload
        const client = sshClients.get(id)
        if (!client) return null

        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Выберите папку для сохранения'
        })

        if (canceled || filePaths.length === 0) return null
        const destDir = filePaths[0]

        const results: (SftpDownloadResult | undefined)[] = []
        for (const file of files) {
            const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
                client.sftp((err, s) => {
                    if (err) reject(err)
                    else resolve(s)
                })
            })
            if (file.transferId) registerTransferClient(id, file.transferId, sftp);

            const localPath = path.join(destDir, file.filename)

            let state: { transferred: number; total: number; rootPath: string } | undefined
            if (file.isDir) {
                const totalSize = await getRemoteFolderSize(sftp, file.remotePath)
                state = { transferred: 0, total: totalSize, rootPath: file.remotePath }
            }

            const result = await downloadRecursive(id, file.remotePath, localPath, sftp, file.transferId, state)

            if (file.transferId) {
                unregisterTransferClient(file.transferId);
                if (state) {
                    const win = getMainWindow()
                    if (win) {
                        win.webContents.send(`sftp-progress-${id}`, { id: file.transferId, remotePath: file.remotePath, progress: 100, type: 'download' })
                    }
                }
            }
            sftp.end();
            results.push(result)
        }
        return results
    })

    ipcMain.handle('sftp-chmod', async (_, payload: { id: string; path: string; mode: number | string }): Promise<boolean | null> => {
        const { id, path, mode } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        return new Promise((resolve, reject) => {
            sftp.chmod(path, mode, (err) => {
                if (err) reject(new Error(`Ошибка изменения прав: ${err.message}`))
                else resolve(true)
            })
        })
    })

    ipcMain.handle('sftp-readdir', async (_, payload: { id: string; path: string }): Promise<SftpFileEntry[] | null> => {
        if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string' || typeof payload.path !== 'string') return null
        const { id, path } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        return new Promise((resolve, reject) => {
            sftp.readdir(path, async (err, list) => {
                if (err) return reject(new Error(`Ошибка чтения директории: ${err.message}`))

                try {
                    const enhancedList = await Promise.all(list.map(async (file) => {
                        const isLink = (file.attrs.mode & 0o170000) === 0o120000
                        if (isLink) {
                            try {
                                const fullPath = `${path}/${file.filename}`.replace(/\/+/g, '/')
                                const targetAttrs = await new Promise<SftpFileEntry['attrs']>((res, rej) => {
                                    sftp.stat(fullPath, (errStat, s) => (errStat ? rej(errStat) : res(s)))
                                })
                                return { ...file, targetAttrs }
                            } catch {
                                return file
                            }
                        }
                        return file
                    }))
                    resolve(enhancedList)
                } catch {
                    // Fallback to original list if something goes wrong during enhancement
                    resolve(list)
                }
            })
        })
    })

    ipcMain.handle('sftp-download-file', async (_event, payload: { id: string; remotePath: string; filename: string; transferId: string }): Promise<SftpDownloadResult | undefined | null> => {
        const { id, remotePath, filename, transferId } = payload
        console.log(`[SFTP] Downloading file: ${remotePath} (ID: ${id}, TransferID: ${transferId})`)
        const client = sshClients.get(id)
        if (!client) return null

        const { canceled, filePath } = await dialog.showSaveDialog({
            defaultPath: filename,
            title: 'Сохранить файл'
        })

        if (canceled || !filePath) return null

        const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
            client.sftp((err, s) => {
                if (err) reject(err)
                else resolve(s)
            })
        })
        if (transferId) registerTransferClient(id, transferId, sftp);

        try {
            const stats = await new Promise<SftpFileEntry['attrs']>((res, rej) => sftp.stat(remotePath, (e, s) => e ? rej(e) : res(s)))
            const isDir = (stats.mode & 0o170000) === 0o040000

            let state: { transferred: number; total: number; rootPath: string } | undefined
            if (isDir) {
                const totalSize = await getRemoteFolderSize(sftp, remotePath)
                state = { transferred: 0, total: totalSize, rootPath: remotePath }
            }

            const result = await downloadRecursive(id, remotePath, filePath, sftp, transferId, state)

            if (state) {
                const win = getMainWindow()
                if (win) {
                    win.webContents.send(`sftp-progress-${id}`, { id: transferId, remotePath: remotePath, progress: 100, type: 'download' })
                }
            }
            return result
        } finally {
            if (transferId) unregisterTransferClient(transferId);
            sftp.end();
        }
    })

    ipcMain.handle('sftp-select-files', async (_, mode: 'file' | 'folder' = 'file') => {
        const properties: OpenDialogOptions['properties'] = ['multiSelections']
        if (mode === 'folder') {
            properties.push('openDirectory')
        } else {
            properties.push('openFile')
        }

        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties,
            title: mode === 'folder' ? 'Выберите папки для загрузки' : 'Выберите файлы для загрузки'
        })

        if (canceled || filePaths.length === 0) return null

        const results = []
        for (const filePath of filePaths) {
            const stats = await fs.promises.stat(filePath)
            const isDir = stats.isDirectory()
            results.push({
                path: filePath,
                name: path.basename(filePath),
                size: isDir ? await getFolderSize(filePath) : stats.size,
                isDir
            })
        }
        return results
    })

    ipcMain.handle('sftp-upload-file', async (_event, payload: { id: string; remoteDir: string }): Promise<string[] | null> => {
        const { id, remoteDir } = payload
        console.log(`[SFTP] Uploading files to: ${remoteDir} (ID: ${id})`)
        const client = sshClients.get(id)
        if (!client) return null

        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            title: 'Выберите файлы для загрузки'
        })

        if (canceled || filePaths.length === 0) return null

        const results: string[] = []
        for (const localPath of filePaths) {
            const filename = path.basename(localPath)
            const remotePath = `${remoteDir}/${filename}`.replace(/\/+/g, '/')
            const transferId = Math.random().toString(36).substring(2, 9);

            const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
                client.sftp((err, s) => {
                    if (err) reject(err)
                    else resolve(s)
                })
            })
            registerTransferClient(id, transferId, sftp);

            const result = await new Promise<string>((resolve, reject) => {
                sftp.fastPut(localPath, remotePath, {
                    step: (total_transferred, _chunk, total) => {
                        if (!sftpTransferClients.has(transferId)) return;
                        const progress = Math.round((total_transferred / total) * 100)
                        const win = getMainWindow()
                        if (win) {
                            const progressData: SftpProgress = { id: transferId, remotePath, progress, transferred: total_transferred, total, type: 'upload' }
                            win.webContents.send(`sftp-progress-${id}`, progressData)
                        }
                    }
                }, (err) => {
                    unregisterTransferClient(transferId);
                    sftp.end();

                    if (err) reject(err)
                    else {
                        const win = getMainWindow()
                        if (win) {
                            const progressData: SftpProgress = { id: transferId, remotePath, progress: 100, type: 'upload' }
                            win.webContents.send(`sftp-progress-${id}`, progressData)
                        }
                        resolve(remotePath)
                    }
                })
            })
            results.push(result)
        }
        return results
    })

    ipcMain.handle('sftp-upload-files-from-paths', async (_event, payload: { id: string; remoteDir: string; transfers: { localPath: string; transferId: string }[] }): Promise<SftpUploadResult[] | null> => {
        const { id, remoteDir, transfers } = payload
        console.log(`[SFTP] Uploading ${transfers.length} items to: ${remoteDir} (ID: ${id})`)
        const client = sshClients.get(id)
        if (!client) return null

        const uploadRecursive = async (
            local: string,
            remote: string,
            sftp: SFTPWrapper,
            transferId: string,
            state?: { transferred: number; total: number; rootPath: string }
        ): Promise<SftpUploadResult> => {
            const normalizedRemote = normalizeRemotePath(remote)
            const stats = await fs.promises.stat(local)
            if (stats.isDirectory()) {
                await new Promise((resolve) => sftp.mkdir(normalizedRemote, () => resolve(true)))

                const win = getMainWindow()
                if (win && !state) {
                    const progress: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 0, type: 'upload' }
                    win.webContents.send(`sftp-progress-${id}`, progress)
                }

                const files = await fs.promises.readdir(local)
                const items: SftpUploadResult[] = []
                for (const file of files) {
                    if (!sftpTransferClients.has(transferId)) break;
                    items.push(await uploadRecursive(path.join(local, file), `${normalizedRemote}/${file}`, sftp, transferId, state))
                }

                if (win && !state) {
                    const progress: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 100, type: 'upload' }
                    win.webContents.send(`sftp-progress-${id}`, progress)
                }
                return { remotePath: normalizedRemote, isDir: true, items }
            } else {
                let lastProgressTime = 0
                let lastIndividualTransferred = 0

                return new Promise((resolve, reject) => {
                    sftp.fastPut(local, normalizedRemote, {
                        step: (transferred, _chunk, total) => {
                            if (!sftpTransferClients.has(transferId)) return;

                            if (state) {
                                state.transferred += (transferred - lastIndividualTransferred)
                                lastIndividualTransferred = transferred
                            }

                            const now = Date.now()
                            if (now - lastProgressTime > 100 || transferred === total) {
                                lastProgressTime = now
                                const win = getMainWindow()
                                if (win) {
                                    if (state) {
                                        const progress = state.total > 0 ? Math.min(Math.round((state.transferred / state.total) * 100), 100) : 100
                                        const progressData: SftpProgress = { id: transferId, remotePath: state.rootPath, progress, transferred: state.transferred, total: state.total, type: 'upload' }
                                        win.webContents.send(`sftp-progress-${id}`, progressData)
                                    } else {
                                        const progress = Math.round((transferred / total) * 100)
                                        const progressData: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress, transferred, total, type: 'upload' }
                                        win.webContents.send(`sftp-progress-${id}`, progressData)
                                    }
                                }
                            }
                        }
                    }, (err) => {
                        if (err) {
                            const msg = err.message || String(err)
                            if (msg.includes('No response from server') || msg.includes('Channel closed') || msg.includes('destroyed')) {
                                resolve({ remotePath: normalizedRemote, cancelled: true })
                            } else {
                                reject(err)
                            }
                        } else {
                            if (!state) {
                                const win = getMainWindow()
                                if (win) {
                                    const progressData: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 100, type: 'upload' }
                                    win.webContents.send(`sftp-progress-${id}`, progressData)
                                }
                            }
                            resolve({ remotePath: normalizedRemote, size: stats.size })
                        }
                    })
                })
            }
        }

        const results: SftpUploadResult[] = []
        for (const transfer of transfers) {
            const filename = path.basename(transfer.localPath)
            const remotePath = `${remoteDir}/${filename}`.replace(/\/+/g, '/')

            const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
                client.sftp((err, s) => {
                    if (err) reject(err)
                    else resolve(s)
                })
            })
            registerTransferClient(id, transfer.transferId, sftp);

            const stats = await fs.promises.stat(transfer.localPath)
            let state: { transferred: number; total: number; rootPath: string } | undefined
            if (stats.isDirectory()) {
                const totalSize = await getFolderSize(transfer.localPath)
                state = { transferred: 0, total: totalSize, rootPath: remotePath }
            }

            const res = await uploadRecursive(transfer.localPath, remotePath, sftp, transfer.transferId, state)

            if (state) {
                const win = getMainWindow()
                if (win) {
                    win.webContents.send(`sftp-progress-${id}`, { id: transfer.transferId, remotePath: remotePath, progress: 100, type: 'upload' })
                }
            }

            unregisterTransferClient(transfer.transferId);
            sftp.end();
            results.push(res)
        }
        return results
    })

    ipcMain.handle('sftp-cancel-upload', async (_, payload: { id: string; remotePath?: string; transferId?: string }): Promise<boolean> => {
        const { id, transferId } = payload

        if (transferId) {
            const transferSftp = sftpTransferClients.get(transferId)
            if (transferSftp) {
                console.log(`[SFTP] Cancelling specific transfer: ${transferId}`)
                transferSftp.end()
                sftpTransferClients.delete(transferId)
            }
        } else {
            const sftp = sftpClients.get(id)
            if (sftp) {
                console.log(`[SFTP] Cancelling main SFTP session for ID: ${id}`)
                sftp.end()
                sftpClients.delete(id)
            }
        }
        return true
    })

    ipcMain.handle('sftp-open-in-editor', async (_event, payload: { id: string; remotePath: string; filename: string; transferId?: string }): Promise<boolean | null> => {
        const { id, remotePath, filename, transferId = `editor-${Math.random().toString(36).substring(2, 9)}` } = payload
        console.log(`[SFTP] Opening file in editor: ${remotePath} (ID: ${id})`)
        const client = sshClients.get(id)
        if (!client) return null

        // Создаем отдельный SFTP-канал для этого трансфера, чтобы его можно было прервать независимо
        const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
            client.sftp((err, s) => {
                if (err) reject(err)
                else resolve(s)
            })
        })

        if (transferId) {
            sftpTransferClients.set(transferId, sftp)
        }

        const tmpDir = app.getPath('temp')
        const fileDir = path.join(tmpDir, `yash_${Date.now()}`)
        if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true })
        const localPath = path.join(fileDir, filename)

        // Регистрируем временную директорию для очистки
        if (!sftpTempDirs.has(id)) {
            sftpTempDirs.set(id, new Set())
        }
        sftpTempDirs.get(id)!.add(fileDir)

        await new Promise((resolve, reject) => {
            let lastProgressTime = 0
            sftp.fastGet(remotePath, localPath, {
                step: (transferred, _chunk, total) => {
                    if (transferId && !sftpTransferClients.has(transferId)) {
                        // Трансфер был отменен
                        return
                    }
                    const now = Date.now()
                    if (now - lastProgressTime > 100 || transferred === total) {
                        lastProgressTime = now
                        const progress = Math.round((transferred / total) * 100)
                        const win = getMainWindow()
                        if (win) {
                            const progressData: SftpProgress = { id: transferId, remotePath, progress, transferred, total, type: 'download' }
                            win.webContents.send(`sftp-progress-${id}`, progressData)
                        }
                    }
                }
            }, (err) => {
                if (transferId) sftpTransferClients.delete(transferId)
                sftp.end() // Закрываем временный канал

                if (err) reject(err)
                else {
                    const win = getMainWindow()
                    if (win) {
                        const progressData: SftpProgress = { id: transferId, remotePath, progress: 100, type: 'download' }
                        win.webContents.send(`sftp-progress-${id}`, progressData)
                    }
                    resolve(localPath)
                }
            })
        })

        // Setup file watcher
        let debounceTimer: NodeJS.Timeout | null = null
        const watcher = fs.watch(localPath, (eventType) => {
            if (eventType === 'change') {
                if (debounceTimer) clearTimeout(debounceTimer)
                debounceTimer = setTimeout(() => {
                    const win = getMainWindow()
                    if (win) {
                        win.webContents.send(`sftp-file-changed-${id}`, {
                            localPath,
                            remotePath,
                            filename
                        })
                    }
                }, 500)
            }
        })

        if (!sftpWatchers.has(id)) {
            sftpWatchers.set(id, new Map())
        }
        sftpWatchers.get(id)!.set(localPath, watcher)

        await shell.openPath(localPath)
        return true
    })

    ipcMain.handle('sftp-upload-direct', async (_, payload: { id: string; localPath: string; remotePath: string; transferId?: string }): Promise<boolean> => {
        const { id, localPath, remotePath, transferId = 'direct-upload' } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) throw new Error('SFTP client not found')

        return new Promise((resolve, reject) => {
            sftp.fastPut(localPath, remotePath, (err) => {
                if (err) reject(err)
                else {
                    const win = getMainWindow()
                    if (win) {
                        const progress: SftpProgress = { id: transferId, remotePath, progress: 100, type: 'upload' }
                        win.webContents.send(`sftp-progress-${id}`, progress)
                    }
                    resolve(true)
                }
            })
        })
    })

    /**
     * Рекурсивно удаляет папку и её содержимое на удаленном сервере.
     */
    async function rmRecursive(sftp: SFTPWrapper, remotePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            sftp.readdir(remotePath, async (err, list) => {
                if (err) return reject(err)
                try {
                    const tasks = list.map(async (item) => {
                        if (item.filename === '.' || item.filename === '..') return
                        const itemPath = `${remotePath}/${item.filename}`.replace(/\/+/g, '/')
                        const isDir = (item.attrs.mode & 0o170000) === 0o040000
                        if (isDir) {
                            await rmRecursive(sftp, itemPath)
                        } else {
                            await new Promise<void>((res, rej) => {
                                sftp.unlink(itemPath, (e) => (e ? rej(e) : res()))
                            })
                        }
                    })
                    await Promise.all(tasks)
                    sftp.rmdir(remotePath, (e) => (e ? reject(e) : resolve()))
                } catch (e) {
                    reject(e)
                }
            })
        })
    }

    ipcMain.handle('sftp-rm', async (_, payload: { id: string; path: string; isDir: boolean }): Promise<boolean | null> => {
        const { id, path, isDir } = payload
        console.log(`[SFTP] Removing ${isDir ? 'directory' : 'file'}: ${path} (ID: ${id})`)
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        try {
            if (isDir) {
                await rmRecursive(sftp, path)
            } else {
                await new Promise<void>((resolve, reject) => {
                    sftp.unlink(path, (err) => {
                        if (err) reject(err)
                        else resolve()
                    })
                })
            }
            return true
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(`Ошибка удаления ${isDir ? 'папки' : 'файла'}: ${message}`)
        }
    })

    ipcMain.handle('sftp-mkdir', async (_, payload: { id: string; path: string }): Promise<boolean | null> => {
        if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string' || typeof payload.path !== 'string') return null
        const { id, path } = payload
        console.log(`[SFTP] Creating directory: ${path} (ID: ${id})`)
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        return new Promise((resolve, reject) => {
            sftp.mkdir(path, (err) => {
                if (err) reject(new Error(`Ошибка создания папки: ${err.message}`))
                else resolve(true)
            })
        })
    })

    ipcMain.handle('sftp-rename', async (_, payload: { id: string; oldPath: string; newPath: string }): Promise<boolean | null> => {
        if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string' || typeof payload.oldPath !== 'string' || typeof payload.newPath !== 'string') return null
        const { id, oldPath, newPath } = payload
        console.log(`[SFTP] Renaming: ${oldPath} -> ${newPath} (ID: ${id})`)
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        return new Promise((resolve, reject) => {
            sftp.rename(oldPath, newPath, (err) => {
                if (err) reject(new Error(`Ошибка переименования: ${err.message}`))
                else resolve(true)
            })
        })
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

    ipcMain.on('open-port-forwarding-window', (_, config: SSHConfig) => {
        // Эмиттим событие, которое поймает main.ts
        app.emit('open-port-forwarding-window', config)
    })

    ipcMain.handle('ssh-forward-start', async (_event, payload: {
        id: string,
        config: SSHConfig,
        localAddress: string,
        localPort: number,
        remoteAddress: string,
        remotePort: number
    }) => {
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
                hostVerifier: (key: Buffer) => verifyHostKey(key, config, getMainWindow)
            }

            if (config.authType === 'key' && config.privateKeyPath) {
                try {
                    connectConfig.privateKey = fs.readFileSync(config.privateKeyPath)
                } catch (err) {
                    reject(new Error(`Failed to read private key: ${err}`))
                    return
                }
            } else {
                const appConfig = loadConfig()
                const serverId = config.id
                if (serverId && appConfig.encryptedPasswords?.[serverId]) {
                    try {
                        connectConfig.password = vault.decrypt(appConfig.encryptedPasswords[serverId])
                    } catch {
                        const lang = appConfig.language || 'ru'
                        const msg = lang === 'ru' ? 'Хранилище заблокировано или расшифровка не удалась' : 'Vault is locked or decryption failed'
                        reject(new Error(msg))
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
        if (typeof id !== 'string' || id.length > 64) return false
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

    // Импорт/Экспорт конфига
    ipcMain.handle('export-config', async () => {
        const config = loadConfig()
        const { canceled, filePath } = await dialog.showSaveDialog({
            title: 'Экспорт настроек',
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
        return {
            isUnlocked: vault.isUnlocked(),
            isInitialized: !!config.encryption?.salt
        }
    })

    ipcMain.handle('vault-init', async () => {
        const config = loadConfig()
        // If already initialized AND unlocked, don't re-init
        if (config.encryption?.salt && vault.isUnlocked()) return null

        const recoveryKey = crypto.randomBytes(32).toString('base64')
        const salt = crypto.randomBytes(16).toString('base64')

        vault.unlock(recoveryKey, salt)

        config.encryption = { version: 1, salt }
        config.encryptedPasswords = {}
        config.hasAcknowledgedRecoveryKey = false

        if (safeStorage.isEncryptionAvailable()) {
            config.cachedRecoveryKey = safeStorage.encryptString(recoveryKey).toString('base64')
        }

        await saveConfigAsync(config)
        return { recoveryKey, config }
    })

    ipcMain.handle('vault-unlock', async (_, recoveryKey: string) => {
        if (typeof recoveryKey !== 'string' || recoveryKey.length < 10 || recoveryKey.length > 1024) return false

        try {
            const config = loadConfig()
            if (!config.encryption?.salt) return false
            const keyBuffer = Buffer.from(recoveryKey, 'base64')
            if (keyBuffer.length !== 32) return false

            vault.unlock(recoveryKey, config.encryption.salt)

            const firstEncrypted = Object.values(config.encryptedPasswords || {})[0]
            if (firstEncrypted) {
                try {
                    vault.decrypt(firstEncrypted)
                } catch {
                    vault.lock()
                    return false
                }
            }

            if (vault.isUnlocked()) {
                // Cache for auto-unlock
                if (safeStorage.isEncryptionAvailable()) {
                    config.cachedRecoveryKey = safeStorage.encryptString(recoveryKey).toString('base64')
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
        if (typeof serverId !== 'string' || serverId.length > 64) return null
        if (!vault.isUnlocked()) return null

        const config = loadConfig()
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
        if (!vault.isUnlocked()) return null

        const config = loadConfig()
        const oldPasswords: Record<string, string> = {}

        // Decrypt all
        for (const [id, enc] of Object.entries(config.encryptedPasswords || {})) {
            try {
                oldPasswords[id] = vault.decrypt(enc)
            } catch { /* ignore failed decryptions */ }
        }

        const newRecoveryKey = crypto.randomBytes(32).toString('base64')
        const newSalt = crypto.randomBytes(16).toString('base64')

        vault.unlock(newRecoveryKey, newSalt)

        config.encryption = { version: 1, salt: newSalt }
        config.encryptedPasswords = {}

        // Re-encrypt all
        for (const [id, pass] of Object.entries(oldPasswords)) {
            config.encryptedPasswords[id] = vault.encrypt(pass)
        }

        if (safeStorage.isEncryptionAvailable()) {
            config.cachedRecoveryKey = safeStorage.encryptString(newRecoveryKey).toString('base64')
        }

        await saveConfigAsync(config)
        return newRecoveryKey
    })

    ipcMain.handle('vault-reset', async () => {
        const config = loadConfig()
        const recoveryKey = crypto.randomBytes(32).toString('base64')
        const salt = crypto.randomBytes(16).toString('base64')

        vault.unlock(recoveryKey, salt)
        config.encryption = { version: 1, salt }
        config.encryptedPasswords = {}
        config.hasAcknowledgedRecoveryKey = false

        if (safeStorage.isEncryptionAvailable()) {
            config.cachedRecoveryKey = safeStorage.encryptString(recoveryKey).toString('base64')
        } else {
            delete config.cachedRecoveryKey
        }

        await saveConfigAsync(config)
        return { recoveryKey, config }
    })

    ipcMain.handle('import-config', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: 'Импорт настроек',
            filters: [{ name: 'JSON', extensions: ['json'] }],
            properties: ['openFile']
        })

        if (!canceled && filePaths.length > 0) {
            try {
                const content = await fs.promises.readFile(filePaths[0], 'utf-8')
                const newConfig = JSON.parse(content) as AppConfig

                // Минимальная валидация
                if (typeof newConfig !== 'object' || !Array.isArray(newConfig.favorites)) {
                    throw new Error('Некорректный формат файла настроек')
                }

                const hasEncryption = !!newConfig.encryption?.salt
                const hasEncryptedPasswordsObject = typeof newConfig.encryptedPasswords === 'object' && newConfig.encryptedPasswords !== null
                const isLegacyFormat = !hasEncryption && !hasEncryptedPasswordsObject
                let generatedRecoveryKey: string | null = null

                // Lock current vault before switching config
                vault.lock()

                delete newConfig.cachedRecoveryKey

                if (isLegacyFormat) {
                    const salt = crypto.randomBytes(16).toString('base64')
                    const recoveryKey = crypto.randomBytes(32).toString('base64')
                    generatedRecoveryKey = recoveryKey

                    newConfig.encryption = { version: 1, salt }
                    newConfig.encryptedPasswords = {}
                    newConfig.hasAcknowledgedRecoveryKey = false

                    vault.unlock(recoveryKey, salt)
                    if (safeStorage.isEncryptionAvailable()) {
                        newConfig.cachedRecoveryKey = safeStorage.encryptString(recoveryKey).toString('base64')
                    } else {
                        delete newConfig.cachedRecoveryKey
                    }

                    if (Array.isArray(newConfig.favorites)) {
                        for (const favorite of newConfig.favorites) {
                            if (!favorite.id) {
                                favorite.id = crypto.randomUUID()
                            }

                            if (favorite.password && favorite.id) {
                                let legacyPassword = ''
                                const rawPassword = favorite.password

                                if (safeStorage.isEncryptionAvailable()) {
                                    try {
                                        legacyPassword = safeStorage.decryptString(Buffer.from(rawPassword, 'base64'))
                                    } catch {
                                        try {
                                            legacyPassword = Buffer.from(rawPassword, 'base64').toString('utf8')
                                        } catch {
                                            legacyPassword = rawPassword
                                        }
                                    }
                                } else {
                                    try {
                                        legacyPassword = Buffer.from(rawPassword, 'base64').toString('utf8')
                                    } catch {
                                        legacyPassword = rawPassword
                                    }
                                }

                                if (legacyPassword) {
                                    newConfig.encryptedPasswords[favorite.id] = vault.encrypt(legacyPassword)
                                }
                            }

                            delete favorite.password
                        }
                    }
                } else if (Array.isArray(newConfig.favorites)) {
                    for (const favorite of newConfig.favorites) {
                        delete favorite.password
                    }
                }

                await saveConfigAsync(newConfig)
                clearConfigCache()

                const reloadedConfig = loadConfig()
                return { config: reloadedConfig, isLegacyFormat, recoveryKey: generatedRecoveryKey }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                throw new Error(`Ошибка при импорте: ${message}`)
            }
        }
        return null
    })
}
