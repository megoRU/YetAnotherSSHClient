import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Message-driven тесты sftp-transfer-worker.
 *
 * Воркер вынесен в отдельный utilityProcess и общается только через
 * process.parentPort. В unit-тестах мы подменяем parentPort + ssh2.Client +
 * node:net.connect на фейки и гоняем реальный код сообщениями (transfer/cancelJob/
 * cancelSession/closeSession), контролируя тайминги подключения вручную.
 */

const h = vi.hoisted(() => {
    type Listener = (...args: unknown[]) => void

    class FakeEmitter {
        private listeners = new Map<string, Set<Listener>>()

        protected add(evt: string, fn: Listener, once: boolean): void {
            const wrapped: Listener = (...args) => {
                if (once) this.removeListener(evt, wrapped)
                fn(...args)
            }
            const set = this.listeners.get(evt) ?? new Set<Listener>()
            set.add(wrapped)
            this.listeners.set(evt, set)
        }

        public on(evt: string, fn: Listener): this {
            this.add(evt, fn, false)
            return this
        }

        public once(evt: string, fn: Listener): this {
            this.add(evt, fn, true)
            return this
        }

        public removeListener(evt: string, fn: Listener): void {
            this.listeners.get(evt)?.delete(fn)
        }

        public removeAllListeners(): void {
            this.listeners.clear()
        }

        public emit(evt: string, ...args: unknown[]): void {
            for (const fn of Array.from(this.listeners.get(evt) ?? [])) {
                fn(...args)
            }
        }
    }

    class FakeSocket extends FakeEmitter {
        static instances: FakeSocket[] = []
        destroyed = false

        constructor() {
            super()
            FakeSocket.instances.push(this)
        }

        setNoDelay(): void {}

        destroy(): void {
            this.destroyed = true
            this.removeAllListeners()
        }
    }

    class FakeClient extends FakeEmitter {
        static instances: FakeClient[] = []
        destroyed = false
        connected = false
        sftpCalls = 0

        constructor() {
            super()
            FakeClient.instances.push(this)
        }

        connect(): this {
            this.connected = true
            return this
        }

        destroy(): void {
            this.destroyed = true
        }

        end(): void {}

        sftp(cb: (err: unknown, sftp?: unknown) => void): void {
            this.sftpCalls += 1
            if (behavior.get() === 'never') return
            const fake = getFakeSftp(this)
            queueMicrotask(() => cb(null, fake))
        }
    }

    type PostedMessage = { cmd: string; jobId?: string; error?: string; transferred?: number; total?: number }

    const messages: PostedMessage[] = []
    const messageListeners: Array<(event: { data: unknown }) => void> = []
    const parentPortMock = {
        postMessage: (message: unknown): void => {
            messages.push(message as PostedMessage)
        },
        on: (_event: string, listener: (event: { data: unknown }) => void): void => {
            messageListeners.push(listener)
        }
    }

    const netConnect = (): FakeSocket => new FakeSocket()

    const sftpPendingCallbacks: Array<(err?: unknown) => void> = []
    let sftpBehavior: 'resolve' | 'never' = 'resolve'
    const behavior = {
        get: (): 'resolve' | 'never' => sftpBehavior,
        set: (value: 'resolve' | 'never'): void => {
            sftpBehavior = value
        }
    }

    interface SftpFake {
        fastPut: (...args: unknown[]) => void
        fastGet: (...args: unknown[]) => void
        stat: (...args: unknown[]) => void
        end: () => void
        removeAllListeners: () => void
    }

    const clientSftp = new Map<FakeClient, SftpFake>()

    function getFakeSftp(client: FakeClient): SftpFake {
        let fake = clientSftp.get(client)
        if (!fake) {
            fake = {
                fastPut: (_l, _r, _o, cb) => {
                    if (typeof cb === 'function') sftpPendingCallbacks.push(cb as (err?: unknown) => void)
                },
                fastGet: (_l, _r, _o, cb) => {
                    if (typeof cb === 'function') sftpPendingCallbacks.push(cb as (err?: unknown) => void)
                },
                stat: (_p, cb) => {
                    sftpPendingCallbacks.push((err) => {
                        if (!err) (cb as (e: unknown, a?: { size: number }) => void)(null, { size: 1 })
                    })
                },
                end: () => {},
                removeAllListeners: () => {}
            }
            clientSftp.set(client, fake)
        }
        return fake
    }

    return { FakeSocket, FakeClient, netConnect, parentPortMock, messages, messageListeners, sftpPendingCallbacks, behavior }
})

vi.mock('node:net', () => ({ connect: h.netConnect }))
vi.mock('ssh2', () => ({ Client: h.FakeClient }))

interface TransferCommand {
    cmd: 'transfer'
    jobId: string
    sessionId: string
    type: 'put' | 'get'
    connectConfig: Record<string, unknown>
    localPath: string
    remotePath: string
}

let emitMessage: (message: unknown) => void = () => {}

beforeAll(async () => {
    Object.defineProperty(process, 'parentPort', { value: h.parentPortMock, configurable: true })
    vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit')
    })
    await import('../electron/src/sftp/worker/sftp-transfer-worker.js')
    emitMessage = (message) => {
        h.messageListeners[0]({ data: message })
    }
})

let idCounter = 0
function nextId(): string {
    idCounter += 1
    return `id-${idCounter}`
}

function transferCommand(jobId: string, sessionId: string): TransferCommand {
    return {
        cmd: 'transfer',
        jobId,
        sessionId,
        type: 'put',
        connectConfig: { host: 'example.com', port: 22 },
        localPath: '/local-file',
        remotePath: '/remote-file'
    }
}

type WorkerMessage = (typeof h.messages)[number]
type TestClient = InstanceType<typeof h.FakeClient>
type TestSocket = InstanceType<typeof h.FakeSocket>

function findDone(jobId: string): WorkerMessage | undefined {
    for (let i = h.messages.length - 1; i >= 0; i--) {
        const message = h.messages[i]
        if (message.cmd === 'done' && message.jobId === jobId) return message
    }
    return undefined
}

async function flush(times = 40): Promise<void> {
    for (let i = 0; i < times; i++) {
        await Promise.resolve()
    }
}

/** Ждёт выполнения условия; не использовать в тестах с fake timers. */
async function waitFor(condition: () => boolean, timeoutMs = 500): Promise<void> {
    const start = Date.now()
    while (!condition()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`waitFor timeout: условие не выполнилось за ${timeoutMs}ms`)
        }
        await Promise.resolve()
    }
}

/** Запускает transfer и доводит подключение сессии до ready. */
async function startConnectedTransfer(jobId: string, sessionId: string): Promise<{ client: TestClient; socket: TestSocket }> {
    emitMessage(transferCommand(jobId, sessionId))
    await flush()
    const socket = h.FakeSocket.instances[h.FakeSocket.instances.length - 1]
    const client = h.FakeClient.instances[h.FakeClient.instances.length - 1]
    socket.emit('connect')
    await flush()
    client.emit('ready')
    await flush(80)
    return { client, socket }
}

beforeEach(() => {
    h.FakeSocket.instances.length = 0
    h.FakeClient.instances.length = 0
    h.sftpPendingCallbacks.length = 0
    h.messages.length = 0
    h.behavior.set('resolve')
})

afterEach(() => {
    vi.useRealTimers()
    h.FakeClient.instances.forEach((client) => client.removeAllListeners())
    h.FakeSocket.instances.forEach((socket) => socket.removeAllListeners())
    try {
        emitMessage({ cmd: 'shutdown' })
    } catch { /* process.exit замокан */ }
})

describe('sftp-transfer-worker', () => {
    it('closeSession: завершает активную передачу Session closed и разрушает сессию', async () => {
        const jobId = nextId()
        const sessionId = nextId()
        const { client, socket } = await startConnectedTransfer(jobId, sessionId)

        expect(client.sftpCalls).toBe(1)
        expect(h.sftpPendingCallbacks).toHaveLength(1)

        emitMessage({ cmd: 'closeSession', sessionId })
        await flush()

        expect(findDone(jobId)?.error).toBe('Session closed')
        expect(client.destroyed).toBe(true)
        expect(socket.destroyed).toBe(true)
    })

    it('closeSession без активных передач не бросает', async () => {
        emitMessage({ cmd: 'closeSession', sessionId: nextId() })
        await flush()
        emitMessage({ cmd: 'closeSession', sessionId: nextId() })
        await flush()
        expect(h.FakeClient.instances).toHaveLength(0)
    })

    it('cancelJob: no-op для неизвестного jobId', async () => {
        emitMessage({ cmd: 'cancelJob', jobId: nextId() })
        await flush()
        expect(h.messages).toHaveLength(0)
    })

    it('cancelJob после готовности канала прерывает передачу, не трогая сессию', async () => {
        vi.useFakeTimers()
        const jobId = nextId()
        const sessionId = nextId()
        const { client } = await startConnectedTransfer(jobId, sessionId)

        expect(h.sftpPendingCallbacks).toHaveLength(1)

        emitMessage({ cmd: 'cancelJob', jobId })
        vi.advanceTimersByTime(1000)
        await flush()

        expect(findDone(jobId)?.error).toBe('Transfer cancelled')
        expect(client.destroyed).toBe(false)
    })

    it('cancelJob до готовности SFTP-канала: канал не запрашивается, job отменяется', async () => {
        vi.useFakeTimers()
        const jobId = nextId()
        const sessionId = nextId()

        emitMessage(transferCommand(jobId, sessionId))
        await flush()
        expect(h.FakeClient.instances).toHaveLength(1)

        emitMessage({ cmd: 'cancelJob', jobId })

        const socket = h.FakeSocket.instances[0]
        const client = h.FakeClient.instances[0]
        socket.emit('connect')
        await flush()
        client.emit('ready')
        await flush(80)

        expect(client.sftpCalls).toBe(0)
        expect(findDone(jobId)?.error).toBe('Transfer cancelled')

        vi.advanceTimersByTime(1000)
        await flush()
    })

    it('closeSession во время openSession: in-flight подключение не кэшируется', async () => {
        const sessionId = nextId()
        const jobId = nextId()

        emitMessage(transferCommand(jobId, sessionId))
        await flush()
        const client = h.FakeClient.instances[0]

        emitMessage({ cmd: 'closeSession', sessionId })
        await flush()
        expect(findDone(jobId)?.error).toBe('Session closed')

        h.FakeSocket.instances[0].emit('connect')
        await flush()
        client.emit('ready')
        await flush(80)

        expect(client.destroyed).toBe(true)

        const newJob = nextId()
        await startConnectedTransfer(newJob, sessionId)
        expect(h.FakeClient.instances).toHaveLength(2)
        expect(h.FakeClient.instances[1].destroyed).toBe(false)
    })

    it('reconnect с тем же sessionId: используется новый клиент, старый не трогает сессию', async () => {
        const sessionId = nextId()
        const job1 = nextId()
        const job2 = nextId()

        const { client: first } = await startConnectedTransfer(job1, sessionId)
        emitMessage({ cmd: 'closeSession', sessionId })
        await flush()
        expect(first.destroyed).toBe(true)

        const { client: second } = await startConnectedTransfer(job2, sessionId)
        expect(h.FakeClient.instances).toHaveLength(2)
        expect(second).not.toBe(first)

        const messagesBefore = h.messages.length
        first.emit('error')
        await flush()

        expect(second.destroyed).toBe(false)
        expect(h.messages.slice(messagesBefore)).toHaveLength(0)
    })

    it('cancelSession завершает все передачи сессии и закрывает её', async () => {
        const sessionId = nextId()
        const job1 = nextId()
        const job2 = nextId()

        const { client } = await startConnectedTransfer(job1, sessionId)
        emitMessage(transferCommand(job2, sessionId))
        await waitFor(() => h.sftpPendingCallbacks.length === 2)
        expect(h.sftpPendingCallbacks).toHaveLength(2)

        emitMessage({ cmd: 'cancelSession', sessionId })
        await flush()

        expect(findDone(job1)?.error).toBe('Transfer cancelled')
        expect(findDone(job2)?.error).toBe('Transfer cancelled')
        expect(client.destroyed).toBe(true)
    })

    it('pendingSessions: параллельные передачи делят одно подключение', async () => {
        const sessionId = nextId()
        const job1 = nextId()
        const job2 = nextId()

        emitMessage(transferCommand(job1, sessionId))
        emitMessage(transferCommand(job2, sessionId))
        await flush()

        expect(h.FakeClient.instances).toHaveLength(1)
        expect(h.FakeSocket.instances).toHaveLength(1)

        const socket = h.FakeSocket.instances[0]
        const client = h.FakeClient.instances[0]
        socket.emit('connect')
        await flush()
        client.emit('ready')
        await waitFor(() => h.sftpPendingCallbacks.length === 2)

        expect(client.sftpCalls).toBe(2)
        expect(h.sftpPendingCallbacks).toHaveLength(2)

        h.sftpPendingCallbacks.splice(0).forEach((cb) => cb())
        await flush()

        expect(findDone(job1)?.error).toBeUndefined()
        expect(findDone(job2)?.error).toBeUndefined()

        const job3 = nextId()
        emitMessage(transferCommand(job3, sessionId))
        await flush()
        expect(h.FakeClient.instances).toHaveLength(1)
    })

    it('отмена одной передачи не ломает другую передачу той же сессии', async () => {
        vi.useFakeTimers()
        const sessionId = nextId()
        const job1 = nextId()
        const job2 = nextId()

        const { client } = await startConnectedTransfer(job1, sessionId)
        emitMessage(transferCommand(job2, sessionId))
        await flush(80)
        expect(h.sftpPendingCallbacks).toHaveLength(2)

        emitMessage({ cmd: 'cancelJob', jobId: job1 })
        vi.advanceTimersByTime(1000)
        await flush()

        expect(findDone(job1)?.error).toBe('Transfer cancelled')
        expect(findDone(job2)).toBeUndefined()
        expect(client.destroyed).toBe(false)

        h.sftpPendingCallbacks[1]()
        await flush()
        expect(findDone(job2)?.error).toBeUndefined()
    })

    it('таймаут SFTP-подсистемы: job не зависает, сессия закрывается', async () => {
        vi.useFakeTimers()
        h.behavior.set('never')

        const jobId = nextId()
        const sessionId = nextId()

        emitMessage(transferCommand(jobId, sessionId))
        await flush()
        const socket = h.FakeSocket.instances[0]
        const client = h.FakeClient.instances[0]
        socket.emit('connect')
        await flush()
        client.emit('ready')
        await flush(80)

        expect(client.sftpCalls).toBe(1)

        vi.advanceTimersByTime(30000)
        await flush()

        expect(findDone(jobId)?.error).toBe('Session closed')
        expect(client.destroyed).toBe(true)
    })
})