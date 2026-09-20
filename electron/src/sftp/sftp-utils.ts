import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { type SFTPWrapper } from 'ssh2'
import { t } from '../i18n-main.js'
import { sftpMkdir, sftpReaddir, sftpRmdir, sftpStat, sftpUnlink } from './sftp-operations.js'

export interface LaunchApplicationResult {
    success: boolean
    error?: string
}

export function normalizeRemotePath(p: string): string {
    return p.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

export function getTempRemotePath(remotePath: string, transferId: string): string {
    const normalized = normalizeRemotePath(remotePath)
    const parts = normalized.split('/').filter(Boolean)
    if (parts.length === 0) return normalizeRemotePath(`/.uploading-${transferId}`)
    const filename = parts.pop()!
    const parentDir = '/' + parts.join('/')
    const tempFilename = `.${filename}.uploading-${transferId}`
    return normalizeRemotePath(`${parentDir}/${tempFilename}`)
}

export function isNoSuchFileError(err: unknown): boolean {
    if (!err) return false
    const e = err as { code?: number | string; message?: string }
    return (
        e.code === 2 || // SSH_FX_NO_SUCH_FILE
        e.code === 'ENOENT' ||
        Boolean(e.message && (e.message.includes('No such file') || e.message.includes('ENOENT')))
    )
}

export async function removeRemotePathStrict(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    const normalized = normalizeRemotePath(remotePath)

    let stats
    try {
        stats = await sftpStat(sftp, normalized)
    } catch (err) {
        if (isNoSuchFileError(err)) return
        throw err
    }

    if ((stats.mode & 0o170000) === 0o040000) {
        let list
        try {
            list = await sftpReaddir(sftp, normalized)
        } catch (err) {
            if (isNoSuchFileError(err)) return
            throw err
        }
        for (const item of list) {
            if (item.filename === '.' || item.filename === '..') continue
            const itemPath = `${normalized}/${item.filename}`.replace(/\/+/g, '/')
            await removeRemotePathStrict(sftp, itemPath)
        }
        await sftpRmdir(sftp, normalized).catch((err) => {
            if (!isNoSuchFileError(err)) throw err
        })
    } else {
        await sftpUnlink(sftp, normalized).catch((err) => {
            if (!isNoSuchFileError(err)) throw err
        })
    }
}

export async function removeRemotePath(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    try {
        await removeRemotePathStrict(sftp, remotePath)
    } catch (err) {
        console.warn(`[SFTP] Best-effort cleanup failed for ${remotePath}:`, err)
    }
}

async function mergeAndRemoveRemoteDir(sftp: SFTPWrapper, sourceDir: string, destDir: string): Promise<void> {
    const items = await sftpReaddir(sftp, sourceDir)
    for (const item of items) {
        if (item.filename === '.' || item.filename === '..') continue
        const sourceItem = normalizeRemotePath(`${sourceDir}/${item.filename}`)
        const destItem = normalizeRemotePath(`${destDir}/${item.filename}`)
        const isItemDir = (item.attrs.mode & 0o170000) === 0o040000

        if (isItemDir) {
            const destStats = await sftpStat(sftp, destItem).catch(() => null)
            if (!destStats || (destStats.mode & 0o170000) !== 0o040000) {
                try {
                    await sftpMkdir(sftp, destItem)
                } catch (mkdirErr) {
                    const errWithCode = mkdirErr as Error & { code?: number | string }
                    const isAlreadyExists = errWithCode.code === 4 || errWithCode.code === 'EEXIST' || Boolean(String(errWithCode.message).includes('EEXIST'))
                    if (!isAlreadyExists) throw mkdirErr
                }
            }
            await mergeAndRemoveRemoteDir(sftp, sourceItem, destItem)
        } else {
            await promoteRemotePath(sftp, sourceItem, destItem)
        }
    }
    await sftpRmdir(sftp, sourceDir)
}

export async function promoteRemotePath(sftp: SFTPWrapper, tempPath: string, targetPath: string): Promise<void> {
    const normalizedTemp = normalizeRemotePath(tempPath)
    const normalizedTarget = normalizeRemotePath(targetPath)

    return new Promise((resolve, reject) => {
        sftp.rename(normalizedTemp, normalizedTarget, (err) => {
            if (!err) return resolve()

            sftp.stat(normalizedTarget, (statErr, targetStats) => {
                if (statErr || !targetStats) {
                    // Target does not exist, original rename error is fatal
                    return reject(err)
                }

                const isTargetDir = (targetStats.mode & 0o170000) === 0o040000
                const isTempDirCheck = new Promise<boolean>((res) => {
                    sftp.stat(normalizedTemp, (tErr, tStats) => {
                        if (!tErr && tStats && (tStats.mode & 0o170000) === 0o040000) res(true)
                        else res(false)
                    })
                })

                isTempDirCheck.then((isTempDir) => {
                    if (isTargetDir && isTempDir) {
                        mergeAndRemoveRemoteDir(sftp, normalizedTemp, normalizedTarget)
                            .then(resolve)
                            .catch(reject)
                    } else if (!isTargetDir && !isTempDir) {
                        // Safe file replacement: backup target file first before unlinking
                        const backupPath = `${normalizedTarget}.target.backup-${crypto.randomUUID()}`
                        sftp.rename(normalizedTarget, backupPath, (backupErr) => {
                            if (backupErr) {
                                // Failed to backup target, abort without touching original file
                                return reject(err)
                            }

                            sftp.rename(normalizedTemp, normalizedTarget, (promoteErr) => {
                                if (promoteErr) {
                                    // Promotion failed: restore original target file from backup
                                    sftp.rename(backupPath, normalizedTarget, (restoreErr) => {
                                        if (restoreErr) {
                                            console.error(`[SFTP] Failed to restore target backup ${backupPath} to ${normalizedTarget}:`, restoreErr)
                                        }
                                        reject(promoteErr)
                                    })
                                } else {
                                    // Promotion succeeded: remove backup file
                                    sftp.unlink(backupPath, (unlinkErr) => {
                                        if (unlinkErr) {
                                            console.warn(`[SFTP] Warning: Failed to clean up target backup file ${backupPath}:`, unlinkErr)
                                        }
                                        resolve()
                                    })
                                }
                            })
                        })
                    } else {
                        // Mismatched types (file vs dir collision)
                        reject(new Error(`Cannot overwrite ${isTargetDir ? 'directory' : 'file'} with ${isTempDir ? 'directory' : 'file'}`))
                    }
                }).catch(reject)
            })
        })
    })
}

export function formatSshError(err: Error & { level?: string }): string {
    const message = err.message || String(err)
    if (
        err.level === 'client-authentication' ||
        message.includes('authentication failed') ||
        message.includes('All configured authentication methods failed')
    ) {
        return `AUTH_FAILURE: ${t('terminal.authFailed')}`
    }
    return message
}

export function escapeRemotePath(p: string): string {
    return `'` + p.replace(/'/g, `'\\''`) + `'`
}

export function getNormalizedExtension(filename: string): string {
    return path.extname(filename).trim().toLowerCase()
}

export function launchApplicationForFile(applicationPath: string, filePath: string): LaunchApplicationResult {
    const absoluteApplicationPath = path.resolve(applicationPath)
    const absoluteFilePath = path.resolve(filePath)
    if (!fs.existsSync(absoluteApplicationPath)) {
        return {
            success: false,
            error: 'APP_NOT_FOUND'
        }
    }

    if (process.platform === 'darwin' && absoluteApplicationPath.toLowerCase().endsWith('.app')) {
        spawn('open', ['-a', absoluteApplicationPath, absoluteFilePath], {
            detached: true,
            stdio: 'ignore'
        }).unref()
        return { success: true }
    }

    spawn(absoluteApplicationPath, [absoluteFilePath], {
        detached: true,
        stdio: 'ignore'
    }).unref()
    return { success: true }
}

export async function getFolderSize(dirPath: string, depth = 0, visited = new Set<string>()): Promise<number> {
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

export async function getRemoteFolderSize(sftp: SFTPWrapper, remotePath: string, depth = 0): Promise<number> {
    if (depth > 20) return 0

    let items
    try {
        items = await sftpReaddir(sftp, remotePath)
    } catch (err) {
        console.error(`[SFTP] Error calculating remote folder size for ${remotePath}:`, err)
        return 0
    }

    let total = 0
    for (const item of items) {
        if (item.filename === '.' || item.filename === '..') continue
        const itemPath = `${remotePath}/${item.filename}`.replace(/\/+/g, '/')
        const isDir = (item.attrs.mode & 0o170000) === 0o040000
        const isLink = (item.attrs.mode & 0o170000) === 0o120000
        if (isLink) continue
        if (isDir) {
            total += await getRemoteFolderSize(sftp, itemPath, depth + 1)
        } else {
            total += item.attrs.size
        }
    }
    return total
}
