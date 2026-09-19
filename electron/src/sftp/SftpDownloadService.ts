import { app, BrowserWindow, dialog, type MessageBoxOptions, shell } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import type { SFTPWrapper } from 'ssh2'
import {
    sftpTempDirs,
    sftpWatchers
} from '../ssh-manager.js'
import { loadConfigAsync, saveConfigAsync } from '../config.js'
import type { SftpDownloadResult, SftpFileEntry, SftpProgress } from '../../../src/types.js'
import {
    getNormalizedExtension,
    getRemoteFolderSize,
    launchApplicationForFile,
    normalizeRemotePath
} from './sftp-utils.js'
import { sftpProgressBatcher } from './sftp-progress-batcher.js'
import { sftpTransferWorkerClient } from './sftp-transfer-worker-client.js'
import { t } from '../i18n-main.js'
import type { SftpConnectionService } from './SftpConnection.js'
import type { SftpTransferManagerService } from './SftpTransferManager.js'

export class SftpDownloadService {
    constructor(
        private connectionService: SftpConnectionService,
        private transferManager: SftpTransferManagerService
    ) {}

    public async downloadFile(
        getMainWindow: () => BrowserWindow | null,
        payload: { id: string; remotePath: string; filename: string; transferId: string }
    ): Promise<SftpDownloadResult | undefined | null> {
        const { id, remotePath, filename, transferId } = payload
        console.log(`[SFTP] Downloading file: ${remotePath} (ID: ${id}, TransferID: ${transferId})`)
        const client = this.connectionService.getSshClient(id)
        if (!client) return null

        const { canceled, filePath } = await dialog.showSaveDialog({
            defaultPath: filename,
            title: t('sftp.download')
        })

        if (canceled || !filePath) return null

        const win = getMainWindow()
        if (win && transferId) {
            win.webContents.send(`sftp-transfer-start-${id}`, {
                id: transferId,
                filename,
                remotePath,
                type: 'download',
                status: 'active'
            })
        }

        const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
            client.sftp((err, s) => {
                if (err) reject(err)
                else resolve(s)
            })
        })
        if (transferId) this.transferManager.registerTransfer(id, transferId, sftp)

        try {
            const stats = await new Promise<SftpFileEntry['attrs']>((res, rej) => sftp.stat(remotePath, (e, s) => e ? rej(e) : res(s)))
            const isDir = (stats.mode & 0o170000) === 0o040000

            let state: { transferred: number; total: number; rootPath: string } | undefined
            if (isDir) {
                const totalSize = await getRemoteFolderSize(sftp, remotePath)
                state = { transferred: 0, total: totalSize, rootPath: remotePath }
            }

            const result = await this.downloadRecursive(getMainWindow, id, remotePath, filePath, sftp, transferId, state)

            if (state) {
                const win = getMainWindow()
                if (win) {
                    sftpProgressBatcher.push(id, win, { id: transferId, remotePath: remotePath, progress: 100, type: 'download' })
                }
            }
            return result
        } finally {
            if (transferId) this.transferManager.unregisterTransfer(transferId)
            sftp.end()
        }
    }

    public async downloadMultipleFiles(
        getMainWindow: () => BrowserWindow | null,
        payload: { id: string; files: { remotePath: string; filename: string; transferId: string; isDir?: boolean }[] }
    ): Promise<(SftpDownloadResult | undefined)[] | null> {
        const { id, files } = payload
        const client = this.connectionService.getSshClient(id)
        if (!client) return null

        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Выберите папку для сохранения'
        })

        if (canceled || filePaths.length === 0) return null
        const destDir = filePaths[0]
        const win = getMainWindow()

        const results: (SftpDownloadResult | undefined)[] = []
        for (const file of files) {
            if (win && file.transferId) {
                win.webContents.send(`sftp-transfer-start-${id}`, {
                    id: file.transferId,
                    filename: file.filename,
                    remotePath: file.remotePath,
                    type: 'download',
                    status: 'active',
                    isDir: file.isDir
                })
            }

            const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
                client.sftp((err, s) => {
                    if (err) reject(err)
                    else resolve(s)
                })
            })
            if (file.transferId) this.transferManager.registerTransfer(id, file.transferId, sftp)

            const localPath = path.join(destDir, file.filename)

            let state: { transferred: number; total: number; rootPath: string } | undefined
            if (file.isDir) {
                const totalSize = await getRemoteFolderSize(sftp, file.remotePath)
                state = { transferred: 0, total: totalSize, rootPath: file.remotePath }
            }

            let result: SftpDownloadResult | undefined
            try {
                result = await this.downloadRecursive(getMainWindow, id, file.remotePath, localPath, sftp, file.transferId, state)

                if (file.transferId && state) {
                    const win = getMainWindow()
                    if (win) {
                        sftpProgressBatcher.push(id, win, { id: file.transferId, remotePath: file.remotePath, progress: 100, type: 'download' })
                    }
                }
            } finally {
                if (file.transferId) {
                    this.transferManager.unregisterTransfer(file.transferId)
                }
                sftp.end()
            }
            results.push(result)
        }
        return results
    }

    public async openInEditor(
        getMainWindow: () => BrowserWindow | null,
        payload: { id: string; remotePath: string; filename: string; transferId?: string }
    ): Promise<boolean | null> {
        const { id, remotePath, filename, transferId = `editor-${crypto.randomUUID()}` } = payload
        console.log(`[SFTP] Opening file in editor: ${remotePath} (ID: ${id})`)

        const localPath = await this.downloadAndWatch(getMainWindow, id, remotePath, filename, transferId)
        const extension = getNormalizedExtension(filename)
        const appConfig = await loadConfigAsync()
        const associatedApplicationPath = extension ? appConfig.fileAssociations[extension] : undefined

        if (associatedApplicationPath) {
            const launchResult = launchApplicationForFile(associatedApplicationPath, localPath)
            if (launchResult.success) {
                return true
            }

            const win = getMainWindow()
            const messageBoxOptions: MessageBoxOptions = {
                type: 'warning',
                title: appConfig.language === 'en' ? 'File association is unavailable' : 'Файловая ассоциация недоступна',
                message: appConfig.language === 'en'
                    ? `Saved application for ${extension} was not found.`
                    : `Сохраненное приложение для ${extension} не найдено.`,
                detail: associatedApplicationPath,
                buttons: appConfig.language === 'en'
                    ? ['Choose new application', 'Remove association', 'Cancel']
                    : ['Выбрать новое приложение', 'Удалить ассоциацию', 'Отмена'],
                defaultId: 0,
                cancelId: 2
            }
            const response = win
                ? await dialog.showMessageBox(win, messageBoxOptions)
                : await dialog.showMessageBox(messageBoxOptions)

            if (response.response === 0) {
                const selectedApplicationPath = await this.selectApplicationPath()
                if (!selectedApplicationPath) {
                    return null
                }
                appConfig.fileAssociations[extension] = selectedApplicationPath
                await saveConfigAsync(appConfig)
                const selectedLaunchResult = launchApplicationForFile(selectedApplicationPath, localPath)
                if (!selectedLaunchResult.success) {
                    throw new Error(t('errors.selectedAppNotFound'))
                }
                return true
            }

            if (response.response === 1) {
                delete appConfig.fileAssociations[extension]
                await saveConfigAsync(appConfig)
                return null
            }

            return null
        }

        await shell.openPath(localPath)
        return true
    }

    public async openWith(
        getMainWindow: () => BrowserWindow | null,
        payload: { id: string; remotePath: string; filename: string; transferId?: string; applicationPath?: string; rememberAssociation?: boolean }
    ): Promise<boolean | null> {
        const { id, remotePath, filename, applicationPath, rememberAssociation = false, transferId = `openwith-${crypto.randomUUID()}` } = payload
        console.log(`[SFTP] Opening file with app: ${remotePath} (ID: ${id})`)

        const localPath = await this.downloadAndWatch(getMainWindow, id, remotePath, filename, transferId)
        let appPath = applicationPath || ''
        if (!appPath) {
            const selectedApplicationPath = await this.selectApplicationPath()
            if (!selectedApplicationPath) {
                return null
            }
            appPath = selectedApplicationPath
        }

        const launchResult = launchApplicationForFile(appPath, localPath)
        if (!launchResult.success) {
            throw new Error(t('errors.selectedAppNotFound'))
        }

        const extension = getNormalizedExtension(filename)
        if (extension && rememberAssociation) {
            const appConfig = await loadConfigAsync()
            appConfig.fileAssociations[extension] = appPath
            await saveConfigAsync(appConfig)
        }

        return true
    }

    private async selectApplicationPath(): Promise<string | null> {
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
        if (canceled || filePaths.length === 0) {
            return null
        }
        return filePaths[0]
    }

    private async downloadAndWatch(
        getMainWindow: () => BrowserWindow | null,
        id: string,
        remotePath: string,
        filename: string,
        transferId: string
    ): Promise<string> {
        const client = this.connectionService.getSshClient(id)
        if (!client) throw new Error(t('errors.sshClientNotFound'))

        const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
            client.sftp((err, s) => {
                if (err) reject(err)
                else resolve(s)
            })
        })

        this.transferManager.registerTransfer(id, transferId, sftp)

        const tmpDir = app.getPath('temp')
        const fileDir = path.join(tmpDir, `yash_${Date.now()}`)
        if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true })
        const localPath = path.join(fileDir, filename)

        if (!sftpTempDirs.has(id)) {
            sftpTempDirs.set(id, new Set())
        }
        sftpTempDirs.get(id)!.add(fileDir)

        try {
            let lastProgressTime = 0
            await sftpTransferWorkerClient.transferFile(
                id,
                'get',
                remotePath,
                localPath,
                (transferred, total) => {
                    if (!this.transferManager.isTransferActive(transferId)) return
                    const now = Date.now()
                    if (now - lastProgressTime > 100 || transferred === total) {
                        lastProgressTime = now
                        const progress = total > 0 ? Math.round((transferred / total) * 100) : 0
                        const win = getMainWindow()
                        if (win) {
                            sftpProgressBatcher.push(id, win, { id: transferId, remotePath, progress, transferred, total, type: 'download' })
                        }
                    }
                },
                transferId
            )
            const win = getMainWindow()
            if (win) {
                sftpProgressBatcher.push(id, win, { id: transferId, remotePath, progress: 100, type: 'download' })
            }
        } finally {
            this.transferManager.unregisterTransfer(transferId)
            sftp.end()
        }

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

        return localPath
    }

    private async downloadRecursive(
        getMainWindow: () => BrowserWindow | null,
        id: string,
        remote: string,
        local: string,
        sftpOverride?: SFTPWrapper,
        transferId: string = 'internal',
        state?: { transferred: number; total: number; rootPath: string }
    ): Promise<SftpDownloadResult | undefined> {
        const sftp = sftpOverride || this.connectionService.getSftpClient(id)
        if (!sftp) return undefined

        const normalizedRemote = normalizeRemotePath(remote)

        return new Promise((resolve, reject) => {
            sftp.stat(normalizedRemote, async (err, stats) => {
                if (err) return reject(err)

                if (stats.isDirectory()) {
                    if (!fs.existsSync(local)) fs.mkdirSync(local, { recursive: true })

                    const win = getMainWindow()
                    if (win && !state) {
                        const progress: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 0, type: 'download' }
                        sftpProgressBatcher.push(id, win, progress)
                    }

                    sftp.readdir(normalizedRemote, async (err, list) => {
                        if (err) return reject(err)
                        try {
                            for (const item of list) {
                                if (item.filename === '.' || item.filename === '..') continue
                                if (transferId !== 'internal' && !this.transferManager.isTransferActive(transferId) && sftpOverride) break
                                await this.downloadRecursive(getMainWindow, id, `${normalizedRemote}/${item.filename}`, path.join(local, item.filename), sftp, transferId, state)
                            }
                            if (win && !state) {
                                const progress: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 100, type: 'download' }
                                sftpProgressBatcher.push(id, win, progress)
                            }
                            resolve({ remotePath: normalizedRemote, localPath: local, isDir: true })
                        } catch (re) {
                            reject(re)
                        }
                    })
                } else {
                    let lastProgressTime = 0
                    let lastIndividualTransferred = 0

                    try {
                        await sftpTransferWorkerClient.transferFile(
                            id,
                            'get',
                            normalizedRemote,
                            local,
                            (transferred, total) => {
                                if (transferId !== 'internal' && !this.transferManager.isTransferActive(transferId) && sftpOverride) return

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
                                            sftpProgressBatcher.push(id, win, progressData)
                                        } else {
                                            const progress = Math.round((transferred / total) * 100)
                                            const progressData: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress, transferred, total, type: 'download' }
                                            sftpProgressBatcher.push(id, win, progressData)
                                        }
                                    }
                                }
                            },
                            transferId
                        )

                        if (!state) {
                            const win = getMainWindow()
                            if (win) {
                                const progressData: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 100, type: 'download' }
                                sftpProgressBatcher.push(id, win, progressData)
                            }
                        }
                        resolve({ remotePath: normalizedRemote, localPath: local, size: stats.size })
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err)
                        if (transferId !== 'internal' && sftpOverride && !this.transferManager.isTransferActive(transferId)) {
                            resolve({ remotePath: normalizedRemote, localPath: local })
                        } else if (msg.includes('No response from server') || msg.includes('Channel closed') || msg.includes('destroyed')) {
                            resolve({ remotePath: normalizedRemote, localPath: local })
                        } else {
                            reject(err)
                        }
                    }
                }
            })
        })
    }
}
