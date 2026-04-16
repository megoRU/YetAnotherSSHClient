import { ipcMain, dialog, shell, app, type IpcMainEvent, BrowserWindow } from 'electron'
import { Client, PseudoTtyOptions, type ConnectConfig } from 'ssh2'
import * as net from 'node:net'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadConfig, saveConfig } from './config.js'
import { checkUpdates, startUpdateDownload, quitAndInstall } from './update-service.js'
import { sshClients, shellStreams, sshSockets, sftpClients, sftpWatchers, sshConfigs, cleanupConnection, cleanupAll } from './ssh-manager.js'
import { AppConfig, SshConnectPayload, SftpConnectPayload, SftpFileEntry, SftpProgress, SftpDownloadResult, SftpUploadResult } from './types.js'

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
 * Регистрирует все IPC-обработчики приложения.
 *
 * @param {() => BrowserWindow | null} getMainWindow - Функция для получения актуального экземпляра главного окна.
 */
export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null) {
    // Конфигурация
    ipcMain.handle('get-config', () => loadConfig())
    ipcMain.handle('save-config', (_, config: AppConfig) => {
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
        saveConfig(config)
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
        const { id, config, cols = 80, rows = 24 } = payload

        // Предварительная очистка если сессия с таким ID уже была
        sshSockets.get(id)?.destroy()
        sshClients.get(id)?.destroy()
        shellStreams.delete(id)
        sshClients.delete(id)
        sshSockets.delete(id)

        const sshClient = new Client()
        sshClients.set(id, sshClient)
        sshConfigs.set(id, config)

        const socket = net.connect(config.port || 22, config.host)
        sshSockets.set(id, socket)

        socket.on('connect', () => {
            socket.setNoDelay(true)

            const connectConfig: ConnectConfig = {
                sock: socket,
                username: config.user,
                readyTimeout: 20000,
                keepaliveInterval: 10000,
                keepaliveCountMax: 3
            }

            if (config.authType === 'key' && config.privateKeyPath) {
                try {
                    connectConfig.privateKey = fs.readFileSync(config.privateKeyPath)
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err)
                    event.reply(`ssh-error-${id}`, `Failed to read private key: ${message}`)
                    cleanupConnection(id)
                    return
                }
            } else {
                connectConfig.password = Buffer.from(config.password ?? '', 'base64').toString('utf8')
            }

            sshClient.connect(connectConfig)
        })

        socket.on('error', (err: Error) => {
            event.reply(`ssh-error-${id}`, `Socket error: ${err.message}`)
            cleanupConnection(id)
        })

        sshClient.on('ready', () => {
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
                        }, 500)
                    }
                }

                stream.on('close', () => {
                    sshClient.end()
                    event.reply(`ssh-status-${id}`, 'Соединение закрыто')
                })
            })
        })

        sshClient.on('error', (err: Error & { level?: string }) => {
            event.reply(`ssh-error-${id}`, formatSshError(err))
            cleanupConnection(id)
        })
    })

    ipcMain.on('ssh-input', (_, payload: { id: string; data: string }) => {
        shellStreams.get(payload.id)?.write(payload.data)
    })

    ipcMain.on('ssh-resize', (_, payload: { id: string; cols: number; rows: number }) => {
        shellStreams.get(payload.id)?.setWindow(payload.rows, payload.cols, 0, 0)
    })

    ipcMain.on('ssh-get-os-info', (event: IpcMainEvent, id: string) => {
        const client = sshClients.get(id)
        if (client) {
            // Пытаемся получить подробную информацию через os-release, если не выходит — uname -a
            const cmd = 'cat /etc/os-release || uname -a'
            client.exec(cmd, (err, stream) => {
                if (err) return
                let output = ''
                stream.on('data', (data: Buffer) => {
                    output += data.toString()
                }).on('close', () => {
                    event.reply(`ssh-os-info-${id}`, output)
                })
            })
        }
    })

    ipcMain.on('ssh-close', (_, id: string) => cleanupConnection(id))

    // SFTP Соединения
    ipcMain.on('sftp-connect', (event: IpcMainEvent, payload: SftpConnectPayload) => {
        const { id, config } = payload
        console.log(`[SFTP] Connecting to ${config.host}:${config.port || 22} (ID: ${id})`)

        cleanupConnection(id)

        const sshClient = new Client()
        sshClients.set(id, sshClient)
        sshConfigs.set(id, config)

        const socket = net.connect({
            port: config.port || 22,
            host: config.host,
            timeout: 15000
        })
        sshSockets.set(id, socket)

        socket.on('connect', () => {
            console.log(`[SFTP] TCP socket connected for ID: ${id}`)
            socket.setNoDelay(true)
            const connectConfig: ConnectConfig = {
                sock: socket,
                username: config.user,
                readyTimeout: 20000,
                keepaliveInterval: 10000,
                keepaliveCountMax: 3
            }

            if (config.authType === 'key' && config.privateKeyPath) {
                try {
                    connectConfig.privateKey = fs.readFileSync(config.privateKeyPath)
                } catch (err) {
                    console.error(`[SFTP] Private key read error: ${err}`)
                    event.reply(`sftp-error-${id}`, `Ошибка чтения ключа: ${err}`)
                    cleanupConnection(id)
                    return
                }
            } else {
                connectConfig.password = Buffer.from(config.password ?? '', 'base64').toString('utf8')
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
                event.reply(`sftp-status-${id}`, 'SFTP-сессия готова')
            })
        })

        sshClient.on('error', (err: Error & { level?: string }) => {
            const formattedError = formatSshError(err);
            console.error(`[SFTP] SSH client error for ID: ${id}: ${formattedError}`)
            event.reply(`sftp-error-${id}`, formattedError)
            cleanupConnection(id)
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

    ipcMain.handle('sftp-extract', async (_, payload: { id: string; remotePath: string }): Promise<boolean> => {
        const { id, remotePath } = payload
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

    async function downloadRecursive(id: string, remote: string, local: string): Promise<SftpDownloadResult | undefined> {
        const sftp = sftpClients.get(id)
        if (!sftp) return undefined

        const normalizedRemote = normalizeRemotePath(remote)

        return new Promise((resolve, reject) => {
            sftp.stat(normalizedRemote, (err, stats) => {
                if (err) return reject(err)

                if (stats.isDirectory()) {
                    if (!fs.existsSync(local)) fs.mkdirSync(local, { recursive: true })

                    const win = getMainWindow()
                    if (win) {
                        const progress: SftpProgress = { remotePath: normalizedRemote, progress: 0, type: 'download' }
                        win.webContents.send(`sftp-progress-${id}`, progress)
                    }

                    sftp.readdir(normalizedRemote, async (err, list) => {
                        if (err) return reject(err)
                        try {
                            for (const item of list) {
                                if (item.filename === '.' || item.filename === '..') continue
                                await downloadRecursive(id, `${normalizedRemote}/${item.filename}`, path.join(local, item.filename))
                            }
                            if (win) {
                                const progress: SftpProgress = { remotePath: normalizedRemote, progress: 100, type: 'download' }
                                win.webContents.send(`sftp-progress-${id}`, progress)
                            }
                            resolve({ remotePath: normalizedRemote, localPath: local, isDir: true })
                        } catch (re) {
                            reject(re)
                        }
                    })
                } else {
                    let lastProgressTime = 0
                    sftp.fastGet(normalizedRemote, local, {
                        step: (transferred, _chunk, total) => {
                            const now = Date.now()
                            if (now - lastProgressTime > 100 || transferred === total) {
                                lastProgressTime = now
                                const progress = Math.round((transferred / total) * 100)
                                const win = getMainWindow()
                                if (win) {
                                    const progressData: SftpProgress = { remotePath: normalizedRemote, progress, transferred, total, type: 'download' }
                                    win.webContents.send(`sftp-progress-${id}`, progressData)
                                }
                            }
                        }
                    }, (err) => {
                        if (err) {
                            const readStream = sftp.createReadStream(normalizedRemote)
                            const writeStream = fs.createWriteStream(local)

                            let transferred = 0
                            readStream.on('data', (chunk: Buffer) => {
                                transferred += chunk.length
                                const now = Date.now()
                                if (now - lastProgressTime > 100 || transferred === stats.size) {
                                    lastProgressTime = now
                                    const progress = Math.round((transferred / stats.size) * 100)
                                    const win = getMainWindow()
                                    if (win) win.webContents.send(`sftp-progress-${id}`, { remotePath: normalizedRemote, progress, transferred, total: stats.size, type: 'download' })
                                }
                            })

                            writeStream.on('close', () => {
                                const win = getMainWindow()
                                if (win) win.webContents.send(`sftp-progress-${id}`, { remotePath: normalizedRemote, progress: 100, type: 'download' })
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
                            const win = getMainWindow()
                            if (win) {
                                const progressData: SftpProgress = { remotePath: normalizedRemote, progress: 100, type: 'download' }
                                win.webContents.send(`sftp-progress-${id}`, progressData)
                            }
                            resolve({ remotePath: normalizedRemote, localPath: local, size: stats.size })
                        }
                    })
                }
            })
        })
    }

    ipcMain.handle('sftp-download-multiple-files', async (_event, payload: { id: string; files: { remotePath: string; filename: string; isDir?: boolean }[] }): Promise<(SftpDownloadResult | undefined)[] | null> => {
        const { id, files } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Выберите папку для сохранения'
        })

        if (canceled || filePaths.length === 0) return null
        const destDir = filePaths[0]

        const results: (SftpDownloadResult | undefined)[] = []
        for (const file of files) {
            const localPath = path.join(destDir, file.filename)
            const result = await downloadRecursive(id, file.remotePath, localPath)
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
        const { id, path } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        return new Promise((resolve, reject) => {
            sftp.readdir(path, (err, list) => {
                if (err) reject(new Error(`Ошибка чтения директории: ${err.message}`))
                else resolve(list)
            })
        })
    })

    ipcMain.handle('sftp-download-file', async (_event, payload: { id: string; remotePath: string; filename: string }): Promise<SftpDownloadResult | undefined | null> => {
        const { id, remotePath, filename } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        const { canceled, filePath } = await dialog.showSaveDialog({
            defaultPath: filename,
            title: 'Сохранить файл'
        })

        if (canceled || !filePath) return null
        return downloadRecursive(id, remotePath, filePath)
    })

    ipcMain.handle('sftp-upload-file', async (_event, payload: { id: string; remoteDir: string }): Promise<string[] | null> => {
        const { id, remoteDir } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            title: 'Выберите файлы для загрузки'
        })

        if (canceled || filePaths.length === 0) return null

        const results: string[] = []
        for (const localPath of filePaths) {
            const filename = path.basename(localPath)
            const remotePath = `${remoteDir}/${filename}`.replace(/\/+/g, '/')

            const result = await new Promise<string>((resolve, reject) => {
                sftp.fastPut(localPath, remotePath, {
                    step: (total_transferred, _chunk, total) => {
                        const progress = Math.round((total_transferred / total) * 100)
                        const win = getMainWindow()
                        if (win) {
                            const progressData: SftpProgress = { remotePath, progress, transferred: total_transferred, total, type: 'upload' }
                            win.webContents.send(`sftp-progress-${id}`, progressData)
                        }
                    }
                }, (err) => {
                    if (err) reject(err)
                    else {
                        const win = getMainWindow()
                        if (win) {
                            const progressData: SftpProgress = { remotePath, progress: 100, type: 'upload' }
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

    ipcMain.handle('sftp-upload-files-from-paths', async (_event, payload: { id: string; remoteDir: string; filePaths: string[] }): Promise<SftpUploadResult[] | null> => {
        const { id, remoteDir, filePaths } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        const uploadRecursive = async (local: string, remote: string): Promise<SftpUploadResult> => {
            const normalizedRemote = normalizeRemotePath(remote)
            const stats = fs.statSync(local)
            if (stats.isDirectory()) {
                await new Promise((resolve) => sftp.mkdir(normalizedRemote, () => resolve(true)))

                const win = getMainWindow()
                if (win) {
                    const progress: SftpProgress = { remotePath: normalizedRemote, progress: 0, type: 'upload' }
                    win.webContents.send(`sftp-progress-${id}`, progress)
                }

                const files = fs.readdirSync(local)
                const items: SftpUploadResult[] = []
                for (const file of files) {
                    items.push(await uploadRecursive(path.join(local, file), `${normalizedRemote}/${file}`))
                }

                if (win) {
                    const progress: SftpProgress = { remotePath: normalizedRemote, progress: 100, type: 'upload' }
                    win.webContents.send(`sftp-progress-${id}`, progress)
                }
                return { remotePath: normalizedRemote, isDir: true, items }
            } else {
                let lastProgressTime = 0
                return new Promise((resolve, reject) => {
                    sftp.fastPut(local, normalizedRemote, {
                        step: (transferred, _chunk, total) => {
                            const now = Date.now()
                            if (now - lastProgressTime > 100 || transferred === total) {
                                lastProgressTime = now
                                const progress = Math.round((transferred / total) * 100)
                                const win = getMainWindow()
                                if (win) {
                                    const progressData: SftpProgress = { remotePath: normalizedRemote, progress, transferred, total, type: 'upload' }
                                    win.webContents.send(`sftp-progress-${id}`, progressData)
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
                            const win = getMainWindow()
                            if (win) {
                                const progressData: SftpProgress = { remotePath: normalizedRemote, progress: 100, type: 'upload' }
                                win.webContents.send(`sftp-progress-${id}`, progressData)
                            }
                            resolve({ remotePath: normalizedRemote, size: stats.size })
                        }
                    })
                })
            }
        }

        const results: SftpUploadResult[] = []
        for (const localPath of filePaths) {
            const filename = path.basename(localPath)
            const remotePath = `${remoteDir}/${filename}`.replace(/\/+/g, '/')
            results.push(await uploadRecursive(localPath, remotePath))
        }
        return results
    })

    ipcMain.handle('sftp-cancel-upload', async (_, payload: { id: string; remotePath?: string }): Promise<boolean> => {
        const { id } = payload
        cleanupConnection(id)
        return true
    })

    ipcMain.handle('sftp-open-in-editor', async (_event, payload: { id: string; remotePath: string; filename: string }): Promise<boolean | null> => {
        const { id, remotePath, filename } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        const tmpDir = app.getPath('temp')
        const fileDir = path.join(tmpDir, `yash_${Date.now()}`)
        if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true })
        const localPath = path.join(fileDir, filename)

        await new Promise((resolve, reject) => {
            let lastProgressTime = 0
            sftp.fastGet(remotePath, localPath, {
                step: (transferred, _chunk, total) => {
                    const now = Date.now()
                    if (now - lastProgressTime > 100 || transferred === total) {
                        lastProgressTime = now
                        const progress = Math.round((transferred / total) * 100)
                        const win = getMainWindow()
                        if (win) {
                            const progressData: SftpProgress = { remotePath, progress, transferred, total, type: 'download' }
                            win.webContents.send(`sftp-progress-${id}`, progressData)
                        }
                    }
                }
            }, (err) => {
                if (err) reject(err)
                else {
                    const win = getMainWindow()
                    if (win) {
                        const progressData: SftpProgress = { remotePath, progress: 100, type: 'download' }
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

    ipcMain.handle('sftp-upload-direct', async (_, payload: { id: string; localPath: string; remotePath: string }): Promise<boolean> => {
        const { id, localPath, remotePath } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) throw new Error('SFTP client not found')

        return new Promise((resolve, reject) => {
            sftp.fastPut(localPath, remotePath, (err) => {
                if (err) reject(err)
                else {
                    const win = getMainWindow()
                    if (win) {
                        const progress: SftpProgress = { remotePath, progress: 100, type: 'upload' }
                        win.webContents.send(`sftp-progress-${id}`, progress)
                    }
                    resolve(true)
                }
            })
        })
    })

    ipcMain.handle('sftp-rm', async (_, payload: { id: string; path: string; isDir: boolean }): Promise<boolean | null> => {
        const { id, path, isDir } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        return new Promise((resolve, reject) => {
            if (isDir) {
                sftp.rmdir(path, (err) => {
                    if (err) reject(new Error(`Ошибка удаления папки: ${err.message}`))
                    else resolve(true)
                })
            } else {
                sftp.unlink(path, (err) => {
                    if (err) reject(new Error(`Ошибка удаления файла: ${err.message}`))
                    else resolve(true)
                })
            }
        })
    })

    ipcMain.handle('sftp-mkdir', async (_, payload: { id: string; path: string }): Promise<boolean | null> => {
        const { id, path } = payload
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
        const { id, oldPath, newPath } = payload
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

    // Внешние ссылки
    ipcMain.on('open-external', (_, url: string) => {
        if (typeof url === 'string' && url.trim().startsWith('http')) {
            shell.openExternal(url).catch(err => console.error('Failed to open external URL:', err))
        }
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
            fs.writeFileSync(filePath, JSON.stringify(config, null, 2))
            return true
        }
        return false
    })

    ipcMain.handle('import-config', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: 'Импорт настроек',
            filters: [{ name: 'JSON', extensions: ['json'] }],
            properties: ['openFile']
        })

        if (!canceled && filePaths.length > 0) {
            try {
                const content = fs.readFileSync(filePaths[0], 'utf-8')
                const newConfig = JSON.parse(content) as AppConfig

                // Минимальная валидация
                if (typeof newConfig !== 'object' || !Array.isArray(newConfig.favorites)) {
                    throw new Error('Некорректный формат файла настроек')
                }

                saveConfig(newConfig)
                return newConfig
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                throw new Error(`Ошибка при импорте: ${message}`)
            }
        }
        return null
    })
}
