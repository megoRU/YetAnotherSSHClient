import * as fs from 'node:fs'
import type { SFTPWrapper } from 'ssh2'
import { t } from '../i18n-main.js'
import type { SftpFileEntry } from '../../../src/types.js'
import type { SftpChmodRequest, SftpMkdirRequest, SftpReaddirRequest, SftpRenameRequest, SftpRmRequest, SftpRealpathRequest } from '../../../src/ipc/sftp.js'
import { createConcurrencyLimiter, sftpChmod, sftpMkdir, sftpReaddir, sftpRealpath, sftpRename, sftpRmdir, sftpStat, sftpUnlink, type ConcurrencyLimiter } from './sftp-operations.js'
import { getFolderSize } from './sftp-utils.js'
import type { SftpConnectionService } from './SftpConnection.js'

const DELETE_CONCURRENCY = 16

export class SftpFileService {
    constructor(private connectionService: SftpConnectionService) {}

    public async realpath(payload: SftpRealpathRequest): Promise<string> {
        const { id, path } = payload
        const sftp = this.connectionService.getSftpClient(id)
        if (!sftp) return '/'

        return sftpRealpath(sftp, path)
    }

    public async readdir(payload: SftpReaddirRequest): Promise<SftpFileEntry[] | null> {
        const { id, path } = payload
        const sftp = this.connectionService.getSftpClient(id)
        if (!sftp) return null

        try {
            const list = await sftpReaddir(sftp, path)
            const enhancedList = await Promise.all(list.map(async (file) => {
                const isLink = (file.attrs.mode & 0o170000) === 0o120000
                if (!isLink) return file
                try {
                    const fullPath = `${path}/${file.filename}`.replace(/\/+/g, '/')
                    const targetAttrs = await sftpStat(sftp, fullPath)
                    return { ...file, targetAttrs }
                } catch {
                    return file
                }
            }))
            return enhancedList
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(t('errors.readdirError', { message }))
        }
    }

    public async mkdir(payload: SftpMkdirRequest): Promise<boolean | null> {
        const { id, path } = payload
        console.log(`[SFTP] Creating directory: ${path} (ID: ${id})`)
        const sftp = this.connectionService.getSftpClient(id)
        if (!sftp) return null

        try {
            await sftpMkdir(sftp, path)
            return true
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(t('errors.mkdirError', { message }))
        }
    }

    public async chmod(payload: SftpChmodRequest): Promise<boolean | null> {
        const { id, path, mode } = payload
        const sftp = this.connectionService.getSftpClient(id)
        if (!sftp) return null

        try {
            await sftpChmod(sftp, path, mode)
            return true
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(t('errors.chmodError', { message }))
        }
    }

    public async rename(payload: SftpRenameRequest): Promise<boolean | null> {
        const { id, oldPath, newPath } = payload
        console.log(`[SFTP] Renaming: ${oldPath} -> ${newPath} (ID: ${id})`)
        const sftp = this.connectionService.getSftpClient(id)
        if (!sftp) return null

        try {
            await sftpRename(sftp, oldPath, newPath)
            return true
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(t('errors.renameError', { message }))
        }
    }

    public async rm(payload: SftpRmRequest): Promise<boolean | null> {
        const { id, path, isDir } = payload
        console.log(`[SFTP] Removing ${isDir ? 'directory' : 'file'}: ${path} (ID: ${id})`)
        const sftp = this.connectionService.getSftpClient(id)
        if (!sftp) return null

        try {
            if (isDir) {
                await this.rmRecursive(sftp, path)
            } else {
                await sftpUnlink(sftp, path)
            }
            return true
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(t('errors.deleteError', { type: isDir ? t('sftp.folder').toLowerCase() : t('sftp.file').toLowerCase(), message }))
        }
    }

    public async statLocal(filePath: string): Promise<{ isDir: boolean; size: number } | null> {
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
    }

    /**
     * Рекурсивно удаляет удалённую директорию.
     * Один общий limiter на всё дерево: число одновременных SFTP-операций
     * ограничено, чтобы при тысячах файлов не порождалось безлимитное
     * количество параллельных запросов к серверу.
     * Симлинки не разворачиваются — удаляются как файлы (mode 0o120000).
     */
    private async rmRecursive(sftp: SFTPWrapper, remotePath: string, limiter?: ConcurrencyLimiter): Promise<void> {
        const limit = limiter ?? createConcurrencyLimiter(DELETE_CONCURRENCY)
        const items = await sftpReaddir(sftp, remotePath)
        const tasks = items
            .filter((item) => item.filename !== '.' && item.filename !== '..')
            .map((item) => {
                const itemPath = `${remotePath}/${item.filename}`.replace(/\/+/g, '/')
                const isDir = (item.attrs.mode & 0o170000) === 0o040000
                const isLink = (item.attrs.mode & 0o170000) === 0o120000
                return limit.run(async () => {
                    if (isDir && !isLink) {
                        await this.rmRecursive(sftp, itemPath, limit)
                    } else {
                        await sftpUnlink(sftp, itemPath)
                    }
                })
            })
        await Promise.all(tasks)
        await sftpRmdir(sftp, remotePath)
    }
}