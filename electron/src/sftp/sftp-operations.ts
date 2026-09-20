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
 * Рекурсивно удаляет удалённую директорию, ограничивая число одновременно
 * выполняемых SFTP-операций значением `concurrency` (минимум 1).
 *
 * Все шаги — readdir / unlink / rmdir — выполняются через общий пул задач:
 * `queue` выступает LIFO-стеком (pop — O(1)), а `pump` стартует задачи до
 * предела `maxConcurrent`. Поэтому независимо от размера и глубины дерева
 * активных SFTP-операций никогда не больше `concurrency`, и каждая задача
 * либо выполнится, либо будет остановлена веткой ошибки — без зависаний и
 * потери задач. Развёртывание директорий рекурсивно (expand) выполняется
 * через задачи, а не через JS-стек, так что глубина дерева безопасна.
 *
 * Директория удаляется (rmdir) только после завершения всех своих детей:
 * счётчик `remaining` декрементится при каждом unlink/rmdir дочернего
 * элемента, а `closed` гарантирует, что rmdir ставится в очередь ровно один
 * раз. При первой же ошибке пул останавливается, и promise отклоняется после
 * завершения уже запущенных задач.
 *
 * Симлинки не разворачиваются — удаляются как файлы (mode 0o120000).
 */
export function deleteRemoteTree(sftp: SFTPWrapper, rootPath: string, concurrency: number): Promise<void> {
    const maxConcurrent = Math.max(1, Math.floor(concurrency))

    return new Promise<void>((resolve, reject) => {
        interface DirFrame {
            path: string
            parent: DirFrame | null
            remaining: number
            closed: boolean
        }

        const queue: Array<() => void> = []
        let active = 0
        let failure: unknown = null
        let settled = false

        const pump = (): void => {
            while (failure === null && active < maxConcurrent && queue.length > 0) {
                queue.pop()!()
            }
        }

        const enqueue = (job: () => Promise<void>): void => {
            queue.push(() => start(job))
            pump()
        }

        const start = (job: () => Promise<void>): void => {
            active++
            job()
                .catch((err) => {
                    failure ??= err
                })
                .finally(() => {
                    active--
                    pump()
                    if (!settled && active === 0) {
                        settled = true
                        if (failure !== null) reject(failure)
                        else resolve()
                    }
                })
        }

        const childRemoved = (dir: DirFrame): void => {
            dir.remaining--
            if (dir.remaining > 0 || dir.closed) return
            dir.closed = true
            enqueue(async () => {
                await sftpRmdir(sftp, dir.path)
                if (dir.parent) childRemoved(dir.parent)
            })
        }

        const expand = (path: string, parent: DirFrame | null): void => {
            enqueue(async () => {
                const list = await sftpReaddir(sftp, path)
                const children = list
                    .filter((item) => item.filename !== '.' && item.filename !== '..')
                    .map((item) => {
                        const isLink = (item.attrs.mode & 0o170000) === 0o120000
                        const isDir = !isLink && (item.attrs.mode & 0o170000) === 0o040000
                        return {
                            path: `${path}/${item.filename}`.replace(/\/+/g, '/'),
                            isDir
                        }
                    })

                const frame: DirFrame = { path, parent, remaining: children.length, closed: false }
                for (const child of children) {
                    if (child.isDir) {
                        expand(child.path, frame)
                    } else {
                        enqueue(async () => {
                            await sftpUnlink(sftp, child.path)
                            childRemoved(frame)
                        })
                    }
                }

                if (frame.remaining === 0) childRemoved(frame)
            })
        }

        expand(rootPath, null)
    })
}
