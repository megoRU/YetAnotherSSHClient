import * as fs from 'node:fs'
import type { SFTPWrapper } from 'ssh2'
import { sftpClients } from '../ssh-manager.js'
import { t } from '../i18n-main.js'
import type { SftpFileEntry } from '../../../src/types.js'
import { getFolderSize } from './sftp-utils.js'

export class SftpFileService {
    public async realpath(payload: { id: string; path: string }): Promise<string> {
        const { id, path } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) return '/'

        return new Promise((resolve, reject) => {
            sftp.realpath(path, (err, resolvedPath) => {
                if (err) reject(err)
                else resolve(resolvedPath)
            })
        })
    }

    public async readdir(payload: { id: string; path: string }): Promise<SftpFileEntry[] | null> {
        const { id, path } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        return new Promise((resolve, reject) => {
            sftp.readdir(path, async (err, list) => {
                if (err) return reject(new Error(t('errors.readdirError', { message: err?.message || '' })))

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
                    resolve(list)
                }
            })
        })
    }

    public async mkdir(payload: { id: string; path: string }): Promise<boolean | null> {
        const { id, path } = payload
        console.log(`[SFTP] Creating directory: ${path} (ID: ${id})`)
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        return new Promise((resolve, reject) => {
            sftp.mkdir(path, (err) => {
                if (err) reject(new Error(t('errors.mkdirError', { message: err?.message || '' })))
                else resolve(true)
            })
        })
    }

    public async chmod(payload: { id: string; path: string; mode: number | string }): Promise<boolean | null> {
        const { id, path, mode } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        return new Promise((resolve, reject) => {
            sftp.chmod(path, mode, (err) => {
                if (err) reject(new Error(t('errors.chmodError', { message: err?.message || '' })))
                else resolve(true)
            })
        })
    }

    public async rename(payload: { id: string; oldPath: string; newPath: string }): Promise<boolean | null> {
        const { id, oldPath, newPath } = payload
        console.log(`[SFTP] Renaming: ${oldPath} -> ${newPath} (ID: ${id})`)
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        return new Promise((resolve, reject) => {
            sftp.rename(oldPath, newPath, (err) => {
                if (err) reject(new Error(t('errors.renameError', { message: err?.message || '' })))
                else resolve(true)
            })
        })
    }

    public async rm(payload: { id: string; path: string; isDir: boolean }): Promise<boolean | null> {
        const { id, path, isDir } = payload
        console.log(`[SFTP] Removing ${isDir ? 'directory' : 'file'}: ${path} (ID: ${id})`)
        const sftp = sftpClients.get(id)
        if (!sftp) return null

        try {
            if (isDir) {
                await this.rmRecursive(sftp, path)
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

    private async rmRecursive(sftp: SFTPWrapper, remotePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            sftp.readdir(remotePath, async (err, list) => {
                if (err) return reject(err)
                try {
                    const tasks = list.map(async (item) => {
                        if (item.filename === '.' || item.filename === '..') return
                        const itemPath = `${remotePath}/${item.filename}`.replace(/\/+/g, '/')
                        const isDir = (item.attrs.mode & 0o170000) === 0o040000
                        if (isDir) {
                            await this.rmRecursive(sftp, itemPath)
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
}
