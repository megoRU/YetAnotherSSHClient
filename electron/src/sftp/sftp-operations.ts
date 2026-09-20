import { Client, type FileEntryWithStats, type SFTPWrapper, type Stats } from 'ssh2'

/** Создаёт новую SFTP-сессию на существующем SSH-клиенте. */
export function getSftpSession(client: Client): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
        client.sftp((err, sftp) => {
            if (err) reject(err)
            else resolve(sftp)
        })
    })
}

export function sftpStat(sftp: SFTPWrapper, remotePath: string): Promise<Stats> {
    return new Promise((resolve, reject) => {
        sftp.stat(remotePath, (err, stats) => {
            if (err) reject(err)
            else resolve(stats)
        })
    })
}

export function sftpReaddir(sftp: SFTPWrapper, location: string): Promise<FileEntryWithStats[]> {
    return new Promise((resolve, reject) => {
        sftp.readdir(location, (err, list) => {
            if (err) reject(err)
            else resolve(list)
        })
    })
}

export function sftpMkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        sftp.mkdir(remotePath, (err) => {
            if (err) reject(err)
            else resolve()
        })
    })
}

export function sftpUnlink(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        sftp.unlink(remotePath, (err) => {
            if (err) reject(err)
            else resolve()
        })
    })
}

export function sftpRmdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        sftp.rmdir(remotePath, (err) => {
            if (err) reject(err)
            else resolve()
        })
    })
}

export function sftpRename(sftp: SFTPWrapper, srcPath: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        sftp.rename(srcPath, destPath, (err) => {
            if (err) reject(err)
            else resolve()
        })
    })
}

export function sftpChmod(sftp: SFTPWrapper, remotePath: string, mode: number | string): Promise<void> {
    return new Promise((resolve, reject) => {
        sftp.chmod(remotePath, mode, (err) => {
            if (err) reject(err)
            else resolve()
        })
    })
}

export function sftpRealpath(sftp: SFTPWrapper, remotePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        sftp.realpath(remotePath, (err, absPath) => {
            if (err) reject(err)
            else resolve(absPath)
        })
    })
}

/**
 * Ограничивает число одновременно выполняющихся асинхронных задач.
 * Используется для рекурсивных SFTP-операций (например, удаление папки),
 * чтобы не порождать тысячи параллельных запросов к SFTP-серверу.
 */
export interface ConcurrencyLimiter {
    run<T>(task: () => Promise<T>): Promise<T>
}

export function createConcurrencyLimiter(limit: number): ConcurrencyLimiter {
    const maxConcurrent = Math.max(1, Math.floor(limit))
    let active = 0
    const waiters: (() => void)[] = []

    const release = (): void => {
        active--
        const next = waiters.shift()
        if (next) {
            active++
            next()
        }
    }

    return {
        run<T>(task: () => Promise<T>): Promise<T> {
            return new Promise<T>((resolveRun, rejectRun) => {
                const execute = (): void => {
                    task().then(
                        (result) => {
                            release()
                            resolveRun(result)
                        },
                        (err) => {
                            release()
                            rejectRun(err)
                        }
                    )
                }

                if (active < maxConcurrent) {
                    active++
                    execute()
                } else {
                    waiters.push(() => {
                        active++
                        execute()
                    })
                }
            })
        }
    }
}