import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import type { SFTPWrapper } from 'ssh2'
import type { SftpProgress, SftpUploadResult } from '../../../src/types.js'
import type { SftpUploadDirectRequest, SftpUploadFilesFromPathsRequest } from '../../../src/ipc/sftp.js'
import { getFolderSize, getTempRemotePath, normalizeRemotePath, promoteRemotePath, removeRemotePath } from './sftp-utils.js'
import { sftpMkdir } from './sftp-operations.js'
import { aggregateTransferProgress, createTransferProgressReporter, createTransferState, ratioTransferProgress, withTransferSession, type TransferState } from './sftp-transfer-common.js'
import { sftpProgressBatcher } from './sftp-progress-batcher.js'
import { sftpTransferWorkerClient } from './sftp-transfer-worker-client.js'
import { t } from '../i18n-main.js'
import type { SftpConnectionService } from './SftpConnection.js'
import type { SftpTransferManagerService } from './SftpTransferManager.js'

export class SftpUploadService {
    constructor(
        private connectionService: SftpConnectionService,
        private transferManager: SftpTransferManagerService
    ) {}

    public async selectFiles(mode: 'file' | 'folder' = 'file') {
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
    }

    public async uploadFilesFromPaths(
        getMainWindow: () => BrowserWindow | null,
        payload: SftpUploadFilesFromPathsRequest
    ): Promise<SftpUploadResult[] | null> {
        const { id, remoteDir, transfers } = payload
        console.log(`[SFTP] Uploading ${transfers.length} items to: ${remoteDir} (ID: ${id})`)
        const client = this.connectionService.getSshClient(id)
        if (!client) return null

        const results: SftpUploadResult[] = []
        for (const transfer of transfers) {
            const filename = path.basename(transfer.localPath)
            const targetRemotePath = normalizeRemotePath(`${remoteDir}/${filename}`)
            const tempRemotePath = getTempRemotePath(targetRemotePath, transfer.transferId)

            const result = await withTransferSession(client, this.transferManager, id, {
                transferId: transfer.transferId,
                tempRemotePath
            }, async (sftp): Promise<SftpUploadResult> => {
                let uploadSucceeded = false
                try {
                    const stats = await fs.promises.stat(transfer.localPath)
                    let state: TransferState | undefined
                    if (stats.isDirectory()) {
                        const totalSize = await getFolderSize(transfer.localPath)
                        state = createTransferState(targetRemotePath, totalSize)
                    }

                    const res = await this.uploadRecursive(getMainWindow, id, transfer.localPath, tempRemotePath, sftp, transfer.transferId, state)

                    if (res.cancelled || !this.transferManager.isTransferActive(transfer.transferId)) {
                        await removeRemotePath(sftp, tempRemotePath)
                        return { remotePath: targetRemotePath, cancelled: true }
                    }

                    if (!this.transferManager.tryStartCompleting(transfer.transferId)) {
                        // Transfer was cancelled right as upload finished
                        await removeRemotePath(sftp, tempRemotePath)
                        return { remotePath: targetRemotePath, cancelled: true }
                    }

                    await promoteRemotePath(sftp, tempRemotePath, targetRemotePath)
                    uploadSucceeded = true

                    if (state) {
                        const win = getMainWindow()
                        if (win) {
                            sftpProgressBatcher.push(id, win, { id: transfer.transferId, remotePath: targetRemotePath, progress: 100, type: 'upload' })
                        }
                    }

                    return { ...res, remotePath: targetRemotePath }
                } catch (err) {
                    if (!uploadSucceeded) {
                        await removeRemotePath(sftp, tempRemotePath)
                    }
                    throw err
                }
            })
            results.push(result)
        }
        return results
    }

    public async uploadDirect(
        getMainWindow: () => BrowserWindow | null,
        payload: SftpUploadDirectRequest
    ): Promise<boolean> {
        const { id, localPath, remotePath, transferId = `direct-${crypto.randomUUID()}` } = payload
        const targetRemotePath = normalizeRemotePath(remotePath)
        const tempRemotePath = getTempRemotePath(targetRemotePath, transferId)

        const client = this.connectionService.getSshClient(id)
        if (!client) throw new Error(t('errors.sshClientNotFound'))

        const reporter = createTransferProgressReporter({
            sessionId: id,
            transferId,
            type: 'upload',
            getWin: getMainWindow,
            isActive: () => this.transferManager.isTransferActive(transferId)
        })

        return withTransferSession(client, this.transferManager, id, { transferId, tempRemotePath }, async (sftp): Promise<boolean> => {
            let uploadSucceeded = false

            try {
                await sftpTransferWorkerClient.transferFile(
                    id,
                    'put',
                    localPath,
                    tempRemotePath,
                    (transferred, total) => {
                        const progress = ratioTransferProgress(transferred, total, 100)
                        reporter.emit(targetRemotePath, progress, transferred, total)
                    },
                    transferId
                )

                if (!this.transferManager.isTransferActive(transferId)) {
                    await removeRemotePath(sftp, tempRemotePath)
                    return false
                }

                if (!this.transferManager.tryStartCompleting(transferId)) {
                    await removeRemotePath(sftp, tempRemotePath)
                    return false
                }

                await promoteRemotePath(sftp, tempRemotePath, targetRemotePath)
                uploadSucceeded = true

                const win = getMainWindow()
                if (win) {
                    const progressData: SftpProgress = { id: transferId, remotePath: targetRemotePath, progress: 100, type: 'upload' }
                    sftpProgressBatcher.push(id, win, progressData)
                }
                return true
            } catch (err) {
                if (!uploadSucceeded && !this.transferManager.isTransferActive(transferId)) {
                    await removeRemotePath(sftp, tempRemotePath)
                    return false
                }
                if (!uploadSucceeded) {
                    await removeRemotePath(sftp, tempRemotePath)
                }
                throw err
            }
        })
    }

    private async uploadRecursive(
        getMainWindow: () => BrowserWindow | null,
        id: string,
        local: string,
        remote: string,
        sftp: SFTPWrapper,
        transferId: string,
        state?: TransferState
    ): Promise<SftpUploadResult> {
        const normalizedRemote = normalizeRemotePath(remote)
        const stats = await fs.promises.stat(local)
        if (stats.isDirectory()) {
            await sftpMkdir(sftp, normalizedRemote)

            const win = getMainWindow()
            if (win && !state) {
                const progress: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 0, type: 'upload' }
                sftpProgressBatcher.push(id, win, progress)
            }

            const files = await fs.promises.readdir(local)
            const items: SftpUploadResult[] = []
            for (const file of files) {
                if (!this.transferManager.isTransferActive(transferId)) break
                items.push(await this.uploadRecursive(getMainWindow, id, path.join(local, file), `${normalizedRemote}/${file}`, sftp, transferId, state))
            }

            if (win && !state) {
                const progress: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 100, type: 'upload' }
                sftpProgressBatcher.push(id, win, progress)
            }
            return { remotePath: normalizedRemote, isDir: true, items }
        } else {
            let lastIndividualTransferred = 0
            const reporter = createTransferProgressReporter({
                sessionId: id,
                transferId,
                type: 'upload',
                getWin: getMainWindow,
                isActive: () => this.transferManager.isTransferActive(transferId)
            })

            try {
                await sftpTransferWorkerClient.transferFile(
                    id,
                    'put',
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
                            const progress = ratioTransferProgress(transferred, total, 100)
                            reporter.emit(normalizedRemote, progress, transferred, total)
                        }
                    },
                    transferId
                )

                if (!state) {
                    const win = getMainWindow()
                    if (win) {
                        const progressData: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 100, type: 'upload' }
                        sftpProgressBatcher.push(id, win, progressData)
                    }
                }
                return { remotePath: normalizedRemote, size: stats.size }
            } catch (err) {
                if (!this.transferManager.isTransferActive(transferId)) {
                    return { remotePath: normalizedRemote, cancelled: true }
                }
                const msg = err instanceof Error ? err.message : String(err)
                if (msg.includes('No response from server') || msg.includes('Channel closed') || msg.includes('destroyed')) {
                    return { remotePath: normalizedRemote, cancelled: true }
                }
                throw err
            }
        }
    }
}