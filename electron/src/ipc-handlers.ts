import {app, BrowserWindow, dialog, ipcMain, type IpcMainEvent, type OpenDialogOptions, shell} from 'electron'
import {Client, type ConnectConfig, type SFTPWrapper} from 'ssh2'
import * as net from 'node:net'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as pty from 'node-pty'
import {loadConfig, saveConfig} from './config.js'
import {checkUpdates, quitAndInstall, startUpdateDownload} from './update-service.js'
import {
    cleanupAll,
    cleanupConnection,
    sftpClients,
    sftpTempDirs,
    sftpTransferClients,
    sftpWatchers,
    sshClients,
    sshConfigs,
    sshSockets,
    ptyProcesses
} from './ssh-manager.js'
import {
    AppConfig,
    SftpConnectPayload,
    SftpDownloadResult,
    SftpFileEntry,
    SftpProgress,
    SftpUploadResult,
    SshConnectPayload
} from './types.js'

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

    // SSH Соединения (через системный SSH и node-pty)
    ipcMain.on('ssh-connect', (event: IpcMainEvent, payload: SshConnectPayload) => {
        const { id, config, cols = 80, rows = 24 } = payload
        console.log(`[SSH] Connecting to ${config.host} (ID: ${id})`)

        cleanupConnection(id)
        sshConfigs.set(id, config)

        const isWin = process.platform === 'win32'
        const sshArgs = [
            '-o', 'StrictHostKeyChecking=accept-new',
            '-p', (config.port || 22).toString(),
            `${config.user}@${config.host}`
        ]
        if (config.authType === 'key' && config.privateKeyPath) {
            sshArgs.push('-i', config.privateKeyPath)
        }

        const env = { ...process.env } as Record<string, string>
        if (!isWin) {
            const standardPaths = ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
            const currentPaths = (env.PATH || '').split(':')
            standardPaths.forEach(p => {
                if (!currentPaths.includes(p)) currentPaths.push(p)
            })
            env.PATH = currentPaths.filter(Boolean).join(':')
        }

        const spawnOptions: pty.IPtyForkOptions = {
            name: 'xterm-256color',
            cols: cols || 80,
            rows: rows || 24,
            cwd: process.cwd(),
            env
        }

        let ptyProcess: pty.IPty
        try {
            // Попытка 1: Просто ssh
            ptyProcess = pty.spawn(isWin ? 'ssh.exe' : 'ssh', sshArgs, spawnOptions)
        } catch (err) {
            console.error(`[SSH] Spawn attempt 1 failed: ${err}`)
            try {
                // Попытка 2: Абсолютные пути
                let altPath = ''
                if (isWin) {
                    altPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32\\OpenSSH\\ssh.exe')
                } else {
                    const commonUnixPaths = ['/usr/bin/ssh', '/usr/local/bin/ssh', '/bin/ssh']
                    for (const p of commonUnixPaths) {
                        if (fs.existsSync(p)) {
                            altPath = p
                            break
                        }
                    }
                }
                if (altPath) {
                    ptyProcess = pty.spawn(altPath, sshArgs, spawnOptions)
                } else {
                    throw err
                }
            } catch (err2) {
                console.error(`[SSH] Spawn attempt 2 failed: ${err2}`)
                // Попытка 3: Через оболочку
                try {
                    const shell = isWin ? 'powershell.exe' : 'bash'
                    const shellArgs = isWin
                        ? ['-NoProfile', '-Command', `ssh ${sshArgs.join(' ')}`]
                        : ['-c', `ssh ${sshArgs.map(a => `'${a}'`).join(' ')}`]

                    ptyProcess = pty.spawn(shell, shellArgs, spawnOptions)
                } catch (err3) {
                    const msg = err3 instanceof Error ? err3.message : String(err3)
                    console.error(`[SSH] All spawn attempts failed: ${msg}`)
                    event.reply(`ssh-error-${id}`, `Failed to start system SSH: ${msg}`)
                    return
                }
            }
        }

        ptyProcesses.set(id, ptyProcess)

        let passwordSent = false
        let statusSent = false
        const password = config.password ? Buffer.from(config.password, 'base64').toString('utf8') : ''

        ptyProcess.onData((data) => {
            // Отправляем данные на фронтенд
            event.reply(`ssh-output-${id}`, Buffer.from(data))

            // Обработка запроса пароля
            // Ищем паттерн [user]@host's password:
            if (!passwordSent && config.authType !== 'key' && password) {
                const lowerData = data.toLowerCase()
                if (lowerData.includes('password:') || lowerData.includes('пароль:')) {
                    ptyProcess.write(password + '\n')
                    passwordSent = true
                }
            }

            // Имитируем статус готовности (системный ssh не дает явного события "ready" через PTY)
            // Но мы можем считать, что соединение установлено, когда пошли первые данные
            if (data.length > 0 && !statusSent) {
                 event.reply(`ssh-status-${id}`, 'Установлено соединение')
                 statusSent = true
            }
        })

        ptyProcess.onExit(({ exitCode, signal }) => {
            console.log(`[SSH] PTY process exited for ID: ${id} (code: ${exitCode}, signal: ${signal})`)
            ptyProcesses.delete(id)
            event.reply(`ssh-status-${id}`, 'Соединение закрыто')
        })

        // Начальные команды
        if (config.initialCommands) {
            const commands = config.initialCommands.split('\n').filter(c => c.trim() !== '')
            if (commands.length > 0) {
                // Ждем немного перед отправкой команд
                setTimeout(() => {
                    const currentPty = ptyProcesses.get(id)
                    if (currentPty) {
                        for (const cmd of commands) {
                            currentPty.write(cmd + '\n')
                        }
                    }
                }, 1000)
            }
        }
    })

    ipcMain.on('ssh-input', (_, payload: { id: string; data: string }) => {
        ptyProcesses.get(payload.id)?.write(payload.data)
    })

    ipcMain.on('ssh-resize', (_, payload: { id: string; cols: number; rows: number }) => {
        ptyProcesses.get(payload.id)?.resize(payload.cols, payload.rows)
    })

    /**
     * Рекурсивно вычисляет суммарный размер файлов в папке.
     */
    function getFolderSize(dirPath: string): number {
        let size = 0
        try {
            const files = fs.readdirSync(dirPath)
            for (const file of files) {
                const filePath = path.join(dirPath, file)
                try {
                    const stats = fs.lstatSync(filePath)
                    if (stats.isSymbolicLink()) continue
                    if (stats.isDirectory()) {
                        size += getFolderSize(filePath)
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
        try {
            const stats = fs.statSync(filePath)
            const isDir = stats.isDirectory()
            return {
                isDir,
                size: isDir ? getFolderSize(filePath) : stats.size
            }
        } catch (err) {
            console.error(`[FS] Error stating file ${filePath}:`, err)
            return null
        }
    })

    /**
     * Рекурсивно вычисляет суммарный размер файлов в удаленной папке.
     */
    async function getRemoteFolderSize(sftp: SFTPWrapper, remotePath: string): Promise<number> {
        let size = 0
        return new Promise((resolve) => {
            sftp.readdir(remotePath, async (err, list) => {
                if (err) return resolve(0)
                try {
                    for (const item of list) {
                        if (item.filename === '.' || item.filename === '..') continue
                        const itemPath = `${remotePath}/${item.filename}`.replace(/\/+/g, '/')
                        const isDir = (item.attrs.mode & 0o170000) === 0o040000
                        if (isDir) {
                            size += await getRemoteFolderSize(sftp, itemPath)
                        } else {
                            size += item.attrs.size
                        }
                    }
                    resolve(size)
                } catch (e) {
                    console.error(`[SFTP] Error calculating remote folder size for ${remotePath}:`, e)
                    resolve(size)
                }
            })
        })
    }

    ipcMain.on('ssh-get-os-info', (event: IpcMainEvent, id: string) => {
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
        } else {
            console.log(`[SSH] Skipping OS info for ID: ${id} (ssh2 client not ready)`)
        }
    })

    ipcMain.on('ssh-close', (_, id: string) => cleanupConnection(id))

    // SFTP Соединения
    ipcMain.on('sftp-connect', (event: IpcMainEvent, payload: SftpConnectPayload) => {
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
                event.reply(`sftp-status-${id}`, 'SFTP сессия готова')
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

    ipcMain.handle('sftp-stat', async (_, payload: { id: string; path: string }): Promise<SftpFileEntry['attrs'] | null> => {
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
            if (file.transferId) sftpTransferClients.set(file.transferId, sftp);

            const localPath = path.join(destDir, file.filename)

            let state: { transferred: number; total: number; rootPath: string } | undefined
            if (file.isDir) {
                const totalSize = await getRemoteFolderSize(sftp, file.remotePath)
                state = { transferred: 0, total: totalSize, rootPath: file.remotePath }
            }

            const result = await downloadRecursive(id, file.remotePath, localPath, sftp, file.transferId, state)

            if (file.transferId) {
                sftpTransferClients.delete(file.transferId);
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
        if (transferId) sftpTransferClients.set(transferId, sftp);

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
            if (transferId) sftpTransferClients.delete(transferId);
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

        return filePaths.map(filePath => {
            const stats = fs.statSync(filePath)
            const isDir = stats.isDirectory()
            return {
                path: filePath,
                name: path.basename(filePath),
                size: isDir ? getFolderSize(filePath) : stats.size,
                isDir
            }
        })
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
            sftpTransferClients.set(transferId, sftp);

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
                    sftpTransferClients.delete(transferId);
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
            const stats = fs.statSync(local)
            if (stats.isDirectory()) {
                await new Promise((resolve) => sftp.mkdir(normalizedRemote, () => resolve(true)))

                const win = getMainWindow()
                if (win && !state) {
                    const progress: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 0, type: 'upload' }
                    win.webContents.send(`sftp-progress-${id}`, progress)
                }

                const files = fs.readdirSync(local)
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
            sftpTransferClients.set(transfer.transferId, sftp);

            const stats = fs.statSync(transfer.localPath)
            let state: { transferred: number; total: number; rootPath: string } | undefined
            if (stats.isDirectory()) {
                const totalSize = getFolderSize(transfer.localPath)
                state = { transferred: 0, total: totalSize, rootPath: remotePath }
            }

            const res = await uploadRecursive(transfer.localPath, remotePath, sftp, transfer.transferId, state)

            if (state) {
                const win = getMainWindow()
                if (win) {
                    win.webContents.send(`sftp-progress-${id}`, { id: transfer.transferId, remotePath: remotePath, progress: 100, type: 'upload' })
                }
            }

            sftpTransferClients.delete(transfer.transferId);
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
                    for (const item of list) {
                        if (item.filename === '.' || item.filename === '..') continue
                        const itemPath = `${remotePath}/${item.filename}`.replace(/\/+/g, '/')
                        const isDir = (item.attrs.mode & 0o170000) === 0o040000
                        if (isDir) {
                            await rmRecursive(sftp, itemPath)
                        } else {
                            await new Promise<void>((res, rej) => {
                                sftp.unlink(itemPath, (e) => (e ? rej(e) : res()))
                            })
                        }
                    }
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
            if (process.platform === 'darwin') {
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
        if (url.trim().startsWith('http')) {
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
                    new Error('Некорректный формат файла настроек')
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
