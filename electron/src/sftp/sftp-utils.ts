import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { type SFTPWrapper } from 'ssh2'
import { t } from '../i18n-main.js'

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

export async function removeRemotePathStrict(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    const normalized = normalizeRemotePath(remotePath)
    return new Promise((resolve, reject) => {
        sftp.stat(normalized, (err, stats) => {
            if (err) {
                // If path doesn't exist, removal is satisfied
                return resolve()
            }
            if (!stats) return resolve()

            if ((stats.mode & 0o170000) === 0o040000) {
                sftp.readdir(normalized, async (readErr, list) => {
                    if (readErr) return reject(readErr)
                    try {
                        for (const item of list) {
                            if (item.filename === '.' || item.filename === '..') continue
                            const itemPath = `${normalized}/${item.filename}`.replace(/\/+/g, '/')
                            await removeRemotePathStrict(sftp, itemPath)
                        }
                        sftp.rmdir(normalized, (rmdirErr) => {
                            if (rmdirErr) return reject(rmdirErr)
                            resolve()
                        })
                    } catch (e) {
                        reject(e)
                    }
                })
            } else {
                sftp.unlink(normalized, (unlinkErr) => {
                    if (unlinkErr) return reject(unlinkErr)
                    resolve()
                })
            }
        })
    })
}

export async function removeRemotePath(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    try {
        await removeRemotePathStrict(sftp, remotePath)
    } catch (err) {
        console.warn(`[SFTP] Best-effort cleanup failed for ${remotePath}:`, err)
    }
}

async function mergeAndRemoveRemoteDir(sftp: SFTPWrapper, sourceDir: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
        sftp.readdir(sourceDir, async (err, list) => {
            if (err) return reject(err)
            try {
                for (const item of list) {
                    if (item.filename === '.' || item.filename === '..') continue
                    const sourceItem = normalizeRemotePath(`${sourceDir}/${item.filename}`)
                    const destItem = normalizeRemotePath(`${destDir}/${item.filename}`)
                    const isItemDir = (item.attrs.mode & 0o170000) === 0o040000

                    if (isItemDir) {
                        await new Promise<void>((res, rej) => {
                            sftp.mkdir(destItem, (mkdirErr) => {
                                // Ignore error if destination directory already exists
                                if (mkdirErr && !mkdirErr.message?.includes('EEXIST') && !mkdirErr.message?.includes('Failure')) {
                                    return rej(mkdirErr)
                                }
                                res()
                            })
                        })
                        await mergeAndRemoveRemoteDir(sftp, sourceItem, destItem)
                    } else {
                        await promoteRemotePath(sftp, sourceItem, destItem)
                    }
                }
                sftp.rmdir(sourceDir, (rmdirErr) => {
                    if (rmdirErr) return reject(rmdirErr)
                    resolve()
                })
            } catch (e) {
                reject(e)
            }
        })
    })
}

export async function promoteRemotePath(sftp: SFTPWrapper, tempPath: string, targetPath: string): Promise<void> {
    const normalizedTemp = normalizeRemotePath(tempPath)
    const normalizedTarget = normalizeRemotePath(targetPath)

    return new Promise((resolve, reject) => {
        sftp.rename(normalizedTemp, normalizedTarget, (err) => {
            if (!err) return resolve()

            sftp.stat(normalizedTarget, (statErr, targetStats) => {
                if (statErr || !targetStats) {
                    // Target does not exist, so original rename error is fatal
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
                        // File replacing file on SFTP servers that require unlinking destination first
                        sftp.unlink(normalizedTarget, (unlinkErr) => {
                            if (unlinkErr) return reject(unlinkErr)
                            sftp.rename(normalizedTemp, normalizedTarget, (retryErr) => {
                                if (retryErr) return reject(retryErr)
                                resolve()
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

    return new Promise((resolve) => {
        sftp.readdir(remotePath, async (err, list) => {
            if (err) return resolve(0)
            try {
                const tasks = list.map(async (item) => {
                    if (item.filename === '.' || item.filename === '..') return 0
                    const itemPath = `${remotePath}/${item.filename}`.replace(/\/+/g, '/')
                    const isDir = (item.attrs.mode & 0o170000) === 0o040000
                    const isLink = (item.attrs.mode & 0o170000) === 0o120000
                    if (isLink) return 0
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
