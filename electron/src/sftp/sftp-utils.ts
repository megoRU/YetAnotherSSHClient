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
