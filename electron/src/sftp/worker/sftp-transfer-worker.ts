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
    | { cmd: 'cancelJob'; jobId: string }
    | { cmd: 'cancelSession'; sessionId: string }
    | { cmd: 'closeSession'; sessionId: string }
    | { cmd: 'shutdown' }

interface SessionState {
    client: Client
    socket: net.Socket
}

interface JobState {
    sessionId: string
    cancelled: boolean
    finished: boolean
    sftp: SFTPWrapper | null
}

/**
 * Одна SSH-сессия может выполнять несколько передач одновременно. Каждая передача
 * (job) использует собственный SFTP-канал поверх общего SSH-соединения сессии,
 * поэтому отмена отдельного transfer прерывает только его канал и не затрагивает
 * остальные передачи той же сессии.
 */
const sessions = new Map<string, SessionState>()
const jobs = new Map<string, JobState>()
const pendingSessions = new Map<string, Promise<Client>>()
// Счётчик эпох сессии: каждый closeSession/cancelSession инкрементирует эпоху.
// openSession фиксирует эпоху в момент старта и при завершении подключения
// проверяет, не изменилась ли она — это гарантирует, что in-flight подключение,
// открытое до закрытия, не закэшируется в `sessions` и не повлияет на новое
// подключение того же sessionId (reconnect).
const sessionEpochs = new Map<string, number>()

function postDone(jobId: string, error?: string): void {
    parentPort.postMessage({ cmd: 'done', jobId, error })
}

function postProgress(jobId: string, transferred: number, total: number): void {
    parentPort.postMessage({ cmd: 'progress', jobId, transferred, total })
}

function finishJob(jobId: string, error?: string): void {
    const job = jobs.get(jobId)
    if (!job || job.finished) return
    job.finished = true
    jobs.delete(jobId)
    if (job.sftp) {
        try {
            job.sftp.removeAllListeners()
            job.sftp.end()
        } catch { /* ignore */ }
    }
    postDone(jobId, error)
}

function openSession(sessionId: string, connectConfig: ConnectConfig): Promise<Client> {
    return new Promise<Client>((resolve, reject) => {
        void (async () => {
            let settled = false
            const epoch = sessionEpochs.get(sessionId) ?? 0
            const fail = (err: Error) => {
                if (settled) return
                settled = true
                try { socket.removeAllListeners() } catch { /* ignore */ }
                try { socket.destroy() } catch { /* ignore */ }
                try { client.removeAllListeners() } catch { /* ignore */ }
                try { client.destroy() } catch { /* ignore */ }
                reject(err)
            }

        const socket = net.connect({
            port: connectConfig.port || 22,
            host: connectConfig.host,
            timeout: 15000
        })

        const client = new Client()
        client.on('error', () => {
            // Гонки не должно быть: error от устаревшего (уже закрытого или
            // заменённого на reconnect) клиента не должен трогать текущую сессию.
            if (sessions.get(sessionId)?.client !== client) return
            closeSession(sessionId)
        })

        try {
            await new Promise<void>((resolveConnect, rejectConnect) => {
                socket.once('connect', resolveConnect)
                socket.once('error', rejectConnect)
                socket.once('timeout', () => {
                    socket.destroy()
                    rejectConnect(new Error('TCP connection timeout'))
                })
            })
        } catch (err) {
            fail(err instanceof Error ? err : new Error(String(err)))
            return
        }

        try { socket.setNoDelay(true) } catch { /* ignore */ }

        try {
            await new Promise<void>((resolveReady, rejectReady) => {
                client.once('ready', resolveReady)
                client.once('error', rejectReady)
                client.connect({ ...connectConfig, sock: socket })
            })
        } catch (err) {
            fail(err instanceof Error ? err : new Error(String(err)))
            return
        }

        if (settled) return
        settled = true

        // Сессия была закрыта/отменена (эпоха изменилась), пока устанавливалось
        // соединение, — не кэшируем устаревший клиент и разрушаем его, чтобы
        // он не «пережил» собственное закрытие и не повлиял на новое подключение.
        const isStale = (sessionEpochs.get(sessionId) ?? 0) !== epoch
        if (isStale) {
            try { socket.removeAllListeners() } catch { /* ignore */ }
            try { socket.destroy() } catch { /* ignore */ }
            try { client.removeAllListeners() } catch { /* ignore */ }
            try { client.destroy() } catch { /* ignore */ }
        } else {
            sessions.set(sessionId, { client, socket })
        }
        resolve(client)
        })()
    })
}

function ensureSession(sessionId: string, connectConfig: ConnectConfig): Promise<Client> {
    const existing = sessions.get(sessionId)
    if (existing) return Promise.resolve(existing.client)

    const pending = pendingSessions.get(sessionId)
    if (pending) return pending

    const promise = openSession(sessionId, connectConfig).finally(() => {
        pendingSessions.delete(sessionId)
    })
    pendingSessions.set(sessionId, promise)
    return promise
}

function cancelJob(jobId: string): void {
    const job = jobs.get(jobId)
    if (!job || job.finished) return
    job.cancelled = true
    if (job.sftp) {
        try { job.sftp.end() } catch { /* ignore */ }
    }
    // Страховка: если канал не ответит на close, не даём job зависнуть.
    setTimeout(() => {
        const current = jobs.get(jobId)
        if (current && current.cancelled && !current.finished) {
            finishJob(jobId, 'Transfer cancelled')
        }
    }, 1000)
}

function cancelSession(sessionId: string): void {
    for (const [jobId, job] of Array.from(jobs.entries())) {
        if (job.sessionId === sessionId && !job.finished) {
            job.cancelled = true
            finishJob(jobId, 'Transfer cancelled')
        }
    }
    closeSession(sessionId)
}

function closeSession(sessionId: string): void {
    // Инвалидируем открывающиеся/открытые подключения этого sessionId:
    // in-flight openSession увидит смену эпохи и не закэшируется.
    sessionEpochs.set(sessionId, (sessionEpochs.get(sessionId) ?? 0) + 1)
    pendingSessions.delete(sessionId)

    for (const [jobId, job] of Array.from(jobs.entries())) {
        if (job.sessionId === sessionId && !job.finished) {
            finishJob(jobId, 'Session closed')
        }
    }

    const session = sessions.get(sessionId)
    if (!session) return
    sessions.delete(sessionId)
    try { session.socket.removeAllListeners() } catch { /* ignore */ }
    try { session.socket.destroy() } catch { /* ignore */ }
    try { session.client.removeAllListeners() } catch { /* ignore */ }
    try { session.client.destroy() } catch { /* ignore */ }
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
    } catch (err) {
        // Отмену не надо «чинить» фолбэком — передача уже прервана.
        if (jobs.get(jobId)?.cancelled) throw err
        // Некоторые серверы некорректно обрабатывают fastGet — откатываемся на потоковый read.
        const stats = await new Promise<{ size: number }>((resolve, reject) => {
            sftp.stat(remotePath, (errStat, attrs) => (errStat ? reject(errStat) : resolve(attrs)))
        })
        await new Promise<void>((resolve, reject) => {
            const readStream = sftp.createReadStream(remotePath)
            const writeStream = fs.createWriteStream(localPath)
            let transferred = 0
            let lastProgressTime = 0
            let aborted = false
            readStream.on('data', (chunk: Buffer) => {
                if (jobs.get(jobId)?.cancelled) {
                    if (!aborted) {
                        aborted = true
                        try { readStream.destroy() } catch { /* ignore */ }
                        try { writeStream.destroy() } catch { /* ignore */ }
                    }
                    return
                }
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

function runTransfer(
    jobId: string,
    sessionId: string,
    type: JobType,
    connectConfig: ConnectConfig,
    localPath: string,
    remotePath: string
): void {
    jobs.set(jobId, { sessionId, cancelled: false, finished: false, sftp: null })

    void (async () => {
        try {
            const client = await ensureSession(sessionId, connectConfig)

            const beforeChannel = jobs.get(jobId)
            if (!beforeChannel) return
            if (beforeChannel.cancelled) {
                finishJob(jobId, 'Transfer cancelled')
                return
            }

            const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
                let settled = false
                // Сервер может не ответить на запрос SFTP-подсистемы (например,
                // sftp отключен) — без таймаута job завис бы навсегда.
                const timer = setTimeout(() => {
                    if (settled) return
                    settled = true
                    // Закрываем только если `client` всё ещё является текущим
                    // клиентом сессии. Иначе это устаревший клиент закрытой сессии —
                    // трогать новое подключение (reconnect) нельзя.
                    if (sessions.get(sessionId)?.client === client) {
                        closeSession(sessionId)
                    } else {
                        try { client.end() } catch { /* ignore */ }
                    }
                    reject(new Error('SFTP subsystem timeout'))
                }, 30000)
                client.sftp((err, s) => {
                    if (settled) return
                    settled = true
                    clearTimeout(timer)
                    if (err) reject(err)
                    else resolve(s)
                })
            })

            const afterChannel = jobs.get(jobId)
            if (!afterChannel) {
                try { sftp.end() } catch { /* ignore */ }
                return
            }
            if (afterChannel.cancelled) {
                try { sftp.end() } catch { /* ignore */ }
                finishJob(jobId, 'Transfer cancelled')
                return
            }
            afterChannel.sftp = sftp

            if (type === 'put') {
                await runFastPut(jobId, sftp, localPath, remotePath)
            } else {
                await runFastGet(jobId, sftp, localPath, remotePath)
            }

            const finished = jobs.get(jobId)
            if (!finished) return
            if (finished.cancelled) {
                finishJob(jobId, 'Transfer cancelled')
            } else {
                finishJob(jobId)
            }
        } catch (err) {
            const job = jobs.get(jobId)
            const message = job?.cancelled
                ? 'Transfer cancelled'
                : (err instanceof Error ? err.message : String(err))
            finishJob(jobId, message)
        }
    })()
}

parentPort.on('message', (event) => {
    const message = event.data as MainMessage
    switch (message.cmd) {
        case 'transfer': {
            runTransfer(
                message.jobId,
                message.sessionId,
                message.type,
                message.connectConfig,
                message.localPath,
                message.remotePath
            )
            break
        }
        case 'cancelJob': {
            cancelJob(message.jobId)
            break
        }
        case 'cancelSession': {
            cancelSession(message.sessionId)
            break
        }
        case 'closeSession': {
            closeSession(message.sessionId)
            break
        }
        case 'shutdown': {
            for (const jobId of Array.from(jobs.keys())) {
                finishJob(jobId, 'Worker shutdown')
            }
            for (const sessionId of Array.from(sessions.keys())) {
                closeSession(sessionId)
            }
            process.exit(0)
            break
        }
    }
})
