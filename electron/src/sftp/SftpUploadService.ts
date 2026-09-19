import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import type { SftpProgress, SftpUploadResult } from '../../../src/types.js'
import { getFolderSize, getTempRemotePath, normalizeRemotePath, promoteRemotePath, removeRemotePath } from './sftp-utils.js'
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
        payload: { id: string; remoteDir: string; transfers: { localPath: string; transferId: string }[] }
    ): Promise<SftpUploadResult[] | null> {
        const { id, remoteDir, transfers } = payload
        console.log(`[SFTP] Uploading ${transfers.length} items to: ${remoteDir} (ID: ${id})`)
        const client = this.connectionService.getSshClient(id)
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
                    sftpProgressBatcher.push(id, win, progress)
                }

                const files = await fs.promises.readdir(local)
                const items: SftpUploadResult[] = []
                for (const file of files) {
                    if (!this.transferManager.isTransferActive(transferId)) break
                    items.push(await uploadRecursive(path.join(local, file), `${normalizedRemote}/${file}`, sftp, transferId, state))
                }

                if (win && !state) {
                    const progress: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress: 100, type: 'upload' }
                    sftpProgressBatcher.push(id, win, progress)
                }
                return { remotePath: normalizedRemote, isDir: true, items }
            } else {
                let lastProgressTime = 0
                let lastIndividualTransferred = 0

                try {
                    await sftpTransferWorkerClient.transferFile(
                        id,
                        'put',
                        local,
                        normalizedRemote,
                        (transferred, total) => {
                            if (!this.transferManager.isTransferActive(transferId)) return

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
                                        sftpProgressBatcher.push(id, win, progressData)
                                    } else {
                                        const progress = Math.round((transferred / total) * 100)
                                        const progressData: SftpProgress = { id: transferId, remotePath: normalizedRemote, progress, transferred, total, type: 'upload' }
                                        sftpProgressBatcher.push(id, win, progressData)
                                    }
                                }
                            }
                        }
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
                    const msg = err instanceof Error ? err.message : String(err)
                    if (msg.includes('No response from server') || msg.includes('Channel closed') || msg.includes('destroyed')) {
                        return { remotePath: normalizedRemote, cancelled: true }
                    }
                    throw err
                }
            }
        }

        const results: SftpUploadResult[] = []
        for (const transfer of transfers) {
            const filename = path.basename(transfer.localPath)
            const targetRemotePath = normalizeRemotePath(`${remoteDir}/${filename}`)
            const tempRemotePath = getTempRemotePath(targetRemotePath, transfer.transferId)

            const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
                client.sftp((err, s) => {
                    if (err) reject(err)
                    else resolve(s)
                })
            })
            this.transferManager.registerTransfer(id, transfer.transferId, sftp, tempRemotePath)

            let uploadSucceeded = false
            try {
                const stats = await fs.promises.stat(transfer.localPath)
                let state: { transferred: number; total: number; rootPath: string } | undefined
                if (stats.isDirectory()) {
                    const totalSize = await getFolderSize(transfer.localPath)
                    state = { transferred: 0, total: totalSize, rootPath: targetRemotePath }
                }

                const res = await uploadRecursive(transfer.localPath, tempRemotePath, sftp, transfer.transferId, state)

                if (res.cancelled || !this.transferManager.isTransferActive(transfer.transferId)) {
                    await removeRemotePath(sftp, tempRemotePath)
                    results.push({ remotePath: targetRemotePath, cancelled: true })
                    continue
                }

                if (!this.transferManager.tryStartCompleting(transfer.transferId)) {
                    // Transfer was cancelled right as upload finished
                    await removeRemotePath(sftp, tempRemotePath)
                    results.push({ remotePath: targetRemotePath, cancelled: true })
                    continue
                }

                await promoteRemotePath(sftp, tempRemotePath, targetRemotePath)
                uploadSucceeded = true

                if (state) {
                    const win = getMainWindow()
                    if (win) {
                        sftpProgressBatcher.push(id, win, { id: transfer.transferId, remotePath: targetRemotePath, progress: 100, type: 'upload' })
                    }
                }

                results.push({ ...res, remotePath: targetRemotePath })
            } catch (err) {
                if (!uploadSucceeded) {
                    try {
                        await removeRemotePath(sftp, tempRemotePath)
                    } catch { /* ignore cleanup error */ }
                }
                throw err
            } finally {
                this.transferManager.unregisterTransfer(transfer.transferId)
                sftp.end()
            }
        }
        return results
    }

    public async uploadDirect(
        getMainWindow: () => BrowserWindow | null,
        payload: { id: string; localPath: string; remotePath: string; transferId?: string }
    ): Promise<boolean> {
        const { id, localPath, remotePath, transferId = `direct-${crypto.randomUUID()}` } = payload
        const targetRemotePath = normalizeRemotePath(remotePath)
        const tempRemotePath = getTempRemotePath(targetRemotePath, transferId)

        const client = this.connectionService.getSshClient(id)
        if (!client) throw new Error(t('errors.sshClientNotFound'))

        const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
            client.sftp((err, s) => {
                if (err) reject(err)
                else resolve(s)
            })
        })
        this.transferManager.registerTransfer(id, transferId, sftp, tempRemotePath)

        let lastProgressTime = 0
        let uploadSucceeded = false

        try {
            await sftpTransferWorkerClient.transferFile(
                id,
                'put',
                localPath,
                tempRemotePath,
                (transferred, total) => {
                    if (!this.transferManager.isTransferActive(transferId)) return
                    const now = Date.now()
                    if (now - lastProgressTime > 100 || transferred === total) {
                        lastProgressTime = now
                        const progress = total > 0 ? Math.round((transferred / total) * 100) : 100
                        const win = getMainWindow()
                        if (win) {
                            const progressData: SftpProgress = { id: transferId, remotePath: targetRemotePath, progress, transferred, total, type: 'upload' }
                            sftpProgressBatcher.push(id, win, progressData)
                        }
                    }
                }
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
            if (!uploadSucceeded) {
                try {
                    await removeRemotePath(sftp, tempRemotePath)
                } catch { /* ignore cleanup error */ }
            }
            throw err
        } finally {
            this.transferManager.unregisterTransfer(transferId)
            sftp.end()
        }
    }
}
