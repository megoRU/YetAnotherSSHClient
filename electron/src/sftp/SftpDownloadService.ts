import { app, BrowserWindow, dialog, type MessageBoxOptions, shell } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import type { SFTPWrapper } from 'ssh2'
import type { SftpDownloadResult, SftpProgress } from '../../../src/types.js'
import type { SftpDownloadFileRequest, SftpDownloadMultipleRequest } from '../../../src/ipc/sftp.js'
import {
    sftpTempDirs,
    sftpWatchers
} from '../ssh-manager.js'
import { loadConfigAsync, saveConfigAsync } from '../config.js'
import {
    getNormalizedExtension,
    getRemoteFolderSize,
    launchApplicationForFile,
    normalizeRemotePath
} from './sftp-utils.js'
import { sftpReaddir, sftpStat } from './sftp-operations.js'
import { aggregateTransferProgress, createTransferProgressReporter, createTransferState, ratioTransferProgress, withTransferSession, type TransferState } from './sftp-transfer-common.js'
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
        payload: SftpDownloadFileRequest
    ): Promise<SftpDownloadResult | undefined | null> {
        const { id, remotePath, filename, transferId } = payload
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

        return withTransferSession(client, this.transferManager, id, { transferId }, async (sftp) => {
            const stats = await sftpStat(sftp, remotePath)
            const isDir = (stats.mode & 0o170000) === 0o040000

            let state: TransferState | undefined
            if (isDir) {
                const totalSize = await getRemoteFolderSize(sftp, remotePath)
                state = createTransferState(remotePath, totalSize)
            }

            const result = await this.downloadRecursive(getMainWindow, id, remotePath, filePath, sftp, transferId, state)

            if (state) {
                const win = getMainWindow()
                if (win) {
                    sftpProgressBatcher.push(id, win, { id: transferId, remotePath: remotePath, progress: 100, type: 'download' })
                }
            }
            return result
        })
    }

    public async downloadMultipleFiles(
        getMainWindow: () => BrowserWindow | null,
        payload: SftpDownloadMultipleRequest
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

            const localPath = path.join(destDir, file.filename)

            const result = await withTransferSession(client, this.transferManager, id, { transferId: file.transferId }, async (sftp) => {
                let state: TransferState | undefined
                if (file.isDir) {
                    const totalSize = await getRemoteFolderSize(sftp, file.remotePath)
                    state = createTransferState(file.remotePath, totalSize)
                }

                const result = await this.downloadRecursive(getMainWindow, id, file.remotePath, localPath, sftp, file.transferId, state)

                if (file.transferId && state) {
                    const win = getMainWindow()
                    if (win) {
                        sftpProgressBatcher.push(id, win, { id: file.transferId, remotePath: file.remotePath, progress: 100, type: 'download' })
                    }
                }
                return result
            })
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

        const tmpDir = app.getPath('temp')
        const fileDir = path.join(tmpDir, `yash_${Date.now()}`)
        if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true })
        const localPath = path.join(fileDir, filename)

        if (!sftpTempDirs.has(id)) {
            sftpTempDirs.set(id, new Set())
        }
        sftpTempDirs.get(id)!.add(fileDir)

        const reporter = createTransferProgressReporter({
            sessionId: id,
            transferId,
            type: 'download',
            getWin: getMainWindow,
            isActive: () => this.transferManager.isTransferActive(transferId)
        })

        await withTransferSession(client, this.transferManager, id, { transferId }, async () => {
            await sftpTransferWorkerClient.transferFile(
                id,
                'get',
                localPath,
                remotePath,
                (transferred, total) => {
                    const progress = ratioTransferProgress(transferred, total, 0)
                    reporter.emit(remotePath, progress, transferred, total)
                },
                transferId
            )
            const win = getMainWindow()
            if (win) {
                sftpProgressBatcher.push(id, win, { id: transferId, remotePath, progress: 100, type: 'download' })
            }
        })

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
        state?: TransferState
    ): Promise<SftpDownloadResult | undefined> {
        const sftp = sftpOverride || this.connectionService.getSftpClient(id)
        if (!sftp) return undefined

        const normalizedRemote = normalizeRemotePath(remote)

        const stats = await sftpStat(sftp, normalizedRemote)

        if (stats.isDirectory()) {
            if (!fs.existsSync(local)) fs.mkdirSync(local, { recursive: true })

            const win = getMainWindow()
            if (win && !state) {
                const progress: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 0, type: 'download' }
                sftpProgressBatcher.push(id, win, progress)
            }

            const list = await sftpReaddir(sftp, normalizedRemote)
            for (const item of list) {
                if (item.filename === '.' || item.filename === '..') continue
                if (transferId !== 'internal' && !this.transferManager.isTransferActive(transferId) && sftpOverride) break
                await this.downloadRecursive(getMainWindow, id, `${normalizedRemote}/${item.filename}`, path.join(local, item.filename), sftp, transferId, state)
            }
            if (win && !state) {
                const progress: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 100, type: 'download' }
                sftpProgressBatcher.push(id, win, progress)
            }
            return { remotePath: normalizedRemote, localPath: local, isDir: true }
        } else {
            let lastIndividualTransferred = 0
            const reporter = createTransferProgressReporter({
                sessionId: id,
                transferId,
                type: 'download',
                getWin: getMainWindow,
                isActive: () => transferId === 'internal' || !sftpOverride || this.transferManager.isTransferActive(transferId)
            })

            try {
                await sftpTransferWorkerClient.transferFile(
                    id,
                    'get',
                    local,
                    normalizedRemote,
                    (transferred, total) => {
                        if (state) {
                            state.transferred += (transferred - lastIndividualTransferred)
                            lastIndividualTransferred = transferred
                        }

                        if (state) {
                            const progress = aggregateTransferProgress(state)
                            reporter.emit(state.rootPath, progress, state.transferred, state.total)
                        } else {
                            const progress = ratioTransferProgress(transferred, total, 0)
                            reporter.emit(normalizedRemote, progress, transferred, total)
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
                return { remotePath: normalizedRemote, localPath: local, size: stats.size }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                if (transferId !== 'internal' && sftpOverride && !this.transferManager.isTransferActive(transferId)) {
                    return { remotePath: normalizedRemote, localPath: local }
                } else if (msg.includes('No response from server') || msg.includes('Channel closed') || msg.includes('destroyed')) {
                    return { remotePath: normalizedRemote, localPath: local }
                } else {
                    throw err
                }
            }
        }
    }
}