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
 * Рекурсивно удаляет удалённую директорию bounded-способом:
 * число одновременных SFTP-операций ограничено `concurrency`, а память —
 * размером активного набора, а не размером дерева.
 *
 * Каждый шаг очереди — одна SFTP-операция (readdir / unlink / rmdir).
 * Директория «раскрывается» порциями по `concurrency` детей и снова
 * ставится в очередь до тех пор, пока не развернёт всех детей; rmdir
 * выполняется только после завершения всех детей. Поэтому для дерева с
 * сотнями тысяч файлов не создаётся массив Promise на каждый элемент —
 * очередь держит O(concurrency²) задач.
 *
 * Симлинки не разворачиваются — удаляются как файлы (mode 0o120000).
 */
export function deleteRemoteTree(sftp: SFTPWrapper, rootPath: string, concurrency: number): Promise<void> {
    const maxConcurrent = Math.max(1, Math.floor(concurrency))

    return new Promise<void>((resolve, reject) => {
        interface TreeItem {
            path: string
            isDir: boolean
        }

        interface DirFrame {
            path: string
            children: TreeItem[]
            next: number
            remaining: number
            parent: DirFrame | null
        }

        const ready: Array<() => Promise<void>> = []
        const openFrames = new Set<DirFrame>()
        let activeWorkers = 0
        let failure: unknown = null
        let settled = false

        const pump = (): void => {
            while (!failure && activeWorkers < maxConcurrent && ready.length > 0) {
                const task = ready.shift()!
                activeWorkers++
                task()
                    .catch((err) => {
                        failure ??= err
                    })
                    .finally(() => {
                        activeWorkers--
                        if (failure) {
                            if (!settled) {
                                settled = true
                                reject(failure)
                            }
                        } else {
                            pump()
                        }
                    })
            }
        }

        const schedule = (task: () => Promise<void>): void => {
            ready.push(task)
            pump()
        }

        const readChildren = (frame: DirFrame, list: { filename: string; attrs: { mode: number } }[]): void => {
            frame.children = list
                .filter((item) => item.filename !== '.' && item.filename !== '..')
                .map((item) => {
                    const isLink = (item.attrs.mode & 0o170000) === 0o120000
                    const isDir = !isLink && (item.attrs.mode & 0o170000) === 0o040000
                    return {
                        path: `${frame.path}/${item.filename}`.replace(/\/+/g, '/'),
                        isDir
                    }
                })
        }

        const notifyChildDone = (frame: DirFrame): void => {
            frame.remaining--
            maybeEnqueueRmdir(frame)
        }

        const maybeEnqueueRmdir = (frame: DirFrame): void => {
            if (!openFrames.has(frame) || frame.remaining !== 0 || frame.next < frame.children.length) return
            openFrames.delete(frame)
            schedule(async () => {
                await sftpRmdir(sftp, frame.path)
                if (frame.parent) {
                    notifyChildDone(frame.parent)
                } else if (!settled) {
                    settled = true
                    resolve()
                }
            })
        }

        const scheduleExpand = (frame: DirFrame): void => {
            schedule(async () => {
                const list = await sftpReaddir(sftp, frame.path)
                readChildren(frame, list)
                dispatchChildren(frame)
            })
        }

        const dispatchChildren = (frame: DirFrame): void => {
            const end = Math.min(frame.children.length, frame.next + maxConcurrent)
            for (; frame.next < end; frame.next++) {
                const child = frame.children[frame.next]
                frame.remaining++
                if (child.isDir) {
                    const sub: DirFrame = { path: child.path, children: [], next: 0, remaining: 0, parent: frame }
                    openFrames.add(sub)
                    scheduleExpand(sub)
                } else {
                    schedule(async () => {
                        await sftpUnlink(sftp, child.path)
                        notifyChildDone(frame)
                    })
                }
            }

            if (frame.next < frame.children.length) {
                // Продолжение уходит в конец очереди — директории обрабатываются
                // честным round-robin, а очередь остаётся ограниченной.
                schedule(async () => { dispatchChildren(frame) })
            } else {
                maybeEnqueueRmdir(frame)
            }
        }

        const root: DirFrame = { path: rootPath, children: [], next: 0, remaining: 0, parent: null }
        openFrames.add(root)
        scheduleExpand(root)
    })
}