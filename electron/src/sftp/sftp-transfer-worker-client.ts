import { utilityProcess, type UtilityProcess } from 'electron'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sshConfigs } from '../ssh-manager.js'
import { resolveConnectConfig } from './SftpConnection.js'
import { sftpTransferManager } from './SftpTransferManager.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface PendingJob {
    resolve: () => void
    reject: (err: Error) => void
    onProgress?: (transferred: number, total: number) => void
    transferId?: string
}

interface WorkerMessage {
    cmd: string
    jobId?: string
    transferred?: number
    total?: number
    error?: string
}

function resolveWorkerPath(): string {
    const base = path.join(__dirname, 'sftp-transfer-worker.js')
    const unpacked = base.replace(
        `${path.sep}app.asar${path.sep}`,
        `${path.sep}app.asar.unpacked${path.sep}`
    )
    return fs.existsSync(unpacked) ? unpacked : base
}

/**
 * Клиент выноса SFTP-передачи в отдельный utilityProcess.
 *
 * Байты файлов передаются (fastPut/fastGet) в дочернем процессе, поэтому SSH-
 * шифрование и парсинг пакетов перестают грузить главный поток main-процесса.
 * Это устраняет зависание окна при его перетаскивании во время активной передачи.
 *
 * Отмена адресная: клиент хранит соответствие transferId -> jobId и умеет
 * отменять конкретную передачу, не затрагивая остальные передачи той же сессии.
 */
export class SftpTransferWorkerClient {
    private child: UtilityProcess | null = null
    private starting: Promise<UtilityProcess> | null = null
    private pending = new Map<string, PendingJob>()
    private jobIdByTransfer = new Map<string, string>()
    private transferIdByJob = new Map<string, string>()
    private cancelledTransfers = new Set<string>()

    public async transferFile(
        sessionId: string,
        type: 'put' | 'get',
        localPath: string,
        remotePath: string,
        onProgress?: (transferred: number, total: number) => void,
        transferId?: string
    ): Promise<void> {
        if (transferId && this.cancelledTransfers.has(transferId)) {
            throw new Error('Transfer cancelled')
        }

        const config = sshConfigs.get(sessionId)
        if (!config) throw new Error('No SSH config for session')
        const connectConfig = await resolveConnectConfig(config)

        const child = await this.getChild()
        const jobId = `transfer-${crypto.randomUUID()}`
        this.pending.set(jobId, {
            resolve: () => {},
            reject: () => {},
            onProgress,
            transferId
        })

        if (transferId) {
            this.jobIdByTransfer.set(transferId, jobId)
            this.transferIdByJob.set(jobId, transferId)
        }

        const promise = new Promise<void>((resolve, reject) => {
            const job = this.pending.get(jobId)
            if (job) {
                job.resolve = resolve
                job.reject = reject
            }
        })

        child.postMessage({
            cmd: 'transfer',
            jobId,
            sessionId,
            type,
            connectConfig,
            localPath,
            remotePath
        })
        return promise
    }

    public cancelTransfer(transferId: string): void {
        this.cancelledTransfers.add(transferId)
        const jobId = this.jobIdByTransfer.get(transferId)
        if (jobId) {
            this.child?.postMessage({ cmd: 'cancelJob', jobId })
        }
    }

    public cancelSession(sessionId: string): void {
        this.child?.postMessage({ cmd: 'cancelSession', sessionId })
    }

    public closeSession(sessionId: string): void {
        this.child?.postMessage({ cmd: 'closeSession', sessionId })
    }

    public dispose(): void {
        try {
            this.child?.postMessage({ cmd: 'shutdown' })
        } catch { /* ignore */ }
        try {
            this.child?.kill()
        } catch { /* ignore */ }
        this.child = null
        this.starting = null
        this.rejectAll(new Error('SFTP transfer worker stopped'))
    }

    private getChild(): Promise<UtilityProcess> {
        if (this.child) return Promise.resolve(this.child)
        if (this.starting) return this.starting

        this.starting = (async () => {
            const workerPath = resolveWorkerPath()
            const child = utilityProcess.fork(workerPath, [], {
                serviceName: 'yash-sftp-transfer',
                stdio: 'inherit'
            })
            child.on('message', (message) => this.handleMessage(message as WorkerMessage))
            child.on('exit', (code) => {
                this.child = null
                this.starting = null
                this.rejectAll(new Error(`SFTP transfer worker exited with code ${code}`))
            })
            this.child = child
            return child
        })()

        return this.starting
    }

    private clearJob(jobId: string): void {
        const transferId = this.transferIdByJob.get(jobId)
        if (transferId) {
            this.jobIdByTransfer.delete(transferId)
            this.transferIdByJob.delete(jobId)
            this.cancelledTransfers.delete(transferId)
        }
    }

    private handleMessage(message: WorkerMessage): void {
        if (!message.jobId) return
        const job = this.pending.get(message.jobId)
        if (!job) return

        if (message.cmd === 'progress' && message.transferred !== undefined && message.total !== undefined) {
            job.onProgress?.(message.transferred, message.total)
            return
        }

        if (message.cmd === 'done') {
            this.pending.delete(message.jobId)
            this.clearJob(message.jobId)
            if (message.error) {
                job.reject(new Error(message.error))
            } else {
                job.resolve()
            }
        }
    }

    private rejectAll(err: Error): void {
        this.pending.forEach(job => job.reject(err))
        this.pending.clear()
        this.jobIdByTransfer.clear()
        this.transferIdByJob.clear()
        this.cancelledTransfers.clear()
    }
}

export const sftpTransferWorkerClient = new SftpTransferWorkerClient()

sftpTransferManager.cancelHook = (sessionId) => sftpTransferWorkerClient.cancelSession(sessionId)
sftpTransferManager.cancelTransferHook = (transferId) => sftpTransferWorkerClient.cancelTransfer(transferId)
sftpTransferManager.sessionClosedHook = (sessionId) => sftpTransferWorkerClient.closeSession(sessionId)