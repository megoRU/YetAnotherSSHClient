import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import * as net from 'node:net'
import * as fs from 'node:fs'

const XFER_CONCURRENCY = 16

interface ParentPortMessageEvent {
    data: unknown
}

interface ParentPortLike {
    on: (event: 'message', listener: (event: ParentPortMessageEvent) => void) => void
    postMessage: (message: unknown) => void
}

const rawParentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort
if (!rawParentPort) {
    throw new Error('sftp-transfer-worker must run inside an Electron utilityProcess')
}
const parentPort: ParentPortLike = rawParentPort

type JobType = 'put' | 'get'

interface TransferRequest {
    cmd: 'transfer'
    jobId: string
    sessionId: string
    type: JobType
    connectConfig: ConnectConfig
    localPath: string
    remotePath: string
}

type MainMessage =
    | TransferRequest
    | { cmd: 'cancel'; sessionId: string }
    | { cmd: 'closeSession'; sessionId: string }
    | { cmd: 'shutdown' }

interface Connection {
    client: Client
    sftp: SFTPWrapper
    socket: net.Socket
}

const connections = new Map<string, Connection>()

function postDone(jobId: string, error?: string): void {
    parentPort.postMessage({ cmd: 'done', jobId, error })
}

function postProgress(jobId: string, transferred: number, total: number): void {
    parentPort.postMessage({ cmd: 'progress', jobId, transferred, total })
}

function closeConnection(sessionId: string): void {
    const entry = connections.get(sessionId)
    if (!entry) return
    connections.delete(sessionId)
    try { entry.sftp.end() } catch { /* ignore */ }
    try { entry.socket.destroy() } catch { /* ignore */ }
    try { entry.client.destroy() } catch { /* ignore */ }
}

async function ensureConnection(sessionId: string, connectConfig: ConnectConfig): Promise<SFTPWrapper> {
    const existing = connections.get(sessionId)
    if (existing) return existing.sftp

    const socket = net.connect({
        port: connectConfig.port || 22,
        host: connectConfig.host,
        timeout: 15000
    })

    try {
        await new Promise<void>((resolve, reject) => {
            socket.once('connect', () => resolve())
            socket.once('error', reject)
            socket.once('timeout', () => {
                socket.destroy()
                reject(new Error('TCP connection timeout'))
            })
        })
    } catch (err) {
        socket.destroy()
        throw err
    }

    socket.setNoDelay(true)

    const client = new Client()
    client.on('error', (err) => {
        console.log(`[SFTP-Worker] SSH client error (${sessionId}): ${err.message}`)
        closeConnection(sessionId)
    })

    try {
        await new Promise<void>((resolve, reject) => {
            client.once('ready', () => resolve())
            client.once('error', reject)
            client.connect({ ...connectConfig, sock: socket })
        })
    } catch (err) {
        socket.destroy()
        client.destroy()
        throw err
    }

    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
        client.sftp((err, s) => (err ? reject(err) : resolve(s)))
    })

    connections.set(sessionId, { client, sftp, socket })
    return sftp
}

function runFastPut(jobId: string, sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let lastProgressTime = 0
        sftp.fastPut(localPath, remotePath, {
            concurrency: XFER_CONCURRENCY,
            step: (transferred, _chunk, total) => {
                const now = Date.now()
                if (now - lastProgressTime > 100 || transferred === total) {
                    lastProgressTime = now
                    postProgress(jobId, transferred, total)
                }
            }
        }, (err) => (err ? reject(err) : resolve()))
    })
}

async function runFastGet(jobId: string, sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
    try {
        await new Promise<void>((resolve, reject) => {
            let lastProgressTime = 0
            sftp.fastGet(remotePath, localPath, {
                concurrency: XFER_CONCURRENCY,
                step: (transferred, _chunk, total) => {
                    const now = Date.now()
                    if (now - lastProgressTime > 100 || transferred === total) {
                        lastProgressTime = now
                        postProgress(jobId, transferred, total)
                    }
                }
            }, (err) => (err ? reject(err) : resolve()))
        })
        return
    } catch {
        // Некоторые серверы некорректно обрабатывают fastGet — откатываемся на потоковый read.
        const stats = await new Promise<{ size: number }>((resolve, reject) => {
            sftp.stat(remotePath, (err, attrs) => (err ? reject(err) : resolve(attrs)))
        })
        await new Promise<void>((resolve, reject) => {
            const readStream = sftp.createReadStream(remotePath)
            const writeStream = fs.createWriteStream(localPath)
            let transferred = 0
            let lastProgressTime = 0
            readStream.on('data', (chunk: Buffer) => {
                transferred += chunk.length
                const now = Date.now()
                if (now - lastProgressTime > 100 || transferred >= stats.size) {
                    lastProgressTime = now
                    postProgress(jobId, transferred, stats.size)
                }
            })
            writeStream.on('close', () => resolve())
            writeStream.on('error', (e: NodeJS.ErrnoException) => {
                if (fs.existsSync(localPath)) {
                    try { fs.unlinkSync(localPath) } catch { /* ignore */ }
                }
                reject(e)
            })
            readStream.on('error', (e: NodeJS.ErrnoException) => {
                if (fs.existsSync(localPath)) {
                    try { fs.unlinkSync(localPath) } catch { /* ignore */ }
                }
                reject(e)
            })
        })
    }
}

async function runTransfer(
    jobId: string,
    sessionId: string,
    type: JobType,
    connectConfig: ConnectConfig,
    localPath: string,
    remotePath: string
): Promise<void> {
    let sftp: SFTPWrapper
    try {
        sftp = await ensureConnection(sessionId, connectConfig)
    } catch (err) {
        postDone(jobId, err instanceof Error ? err.message : String(err))
        return
    }

    try {
        if (type === 'put') {
            await runFastPut(jobId, sftp, localPath, remotePath)
        } else {
            await runFastGet(jobId, sftp, localPath, remotePath)
        }
        postDone(jobId)
    } catch (err) {
        postDone(jobId, err instanceof Error ? err.message : String(err))
    }
}

parentPort.on('message', (event) => {
    const message = event.data as MainMessage
    switch (message.cmd) {
        case 'transfer': {
            void runTransfer(
                message.jobId,
                message.sessionId,
                message.type,
                message.connectConfig,
                message.localPath,
                message.remotePath
            )
            break
        }
        case 'cancel':
        case 'closeSession': {
            closeConnection(message.sessionId)
            break
        }
        case 'shutdown': {
            connections.forEach((_, sessionId) => closeConnection(sessionId))
            process.exit(0)
            break
        }
    }
})