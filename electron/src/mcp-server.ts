import * as http from 'node:http'
import { Client, type ConnectConfig } from 'ssh2'
import * as fs from 'node:fs'
import { loadConfig, initializeVaultAndMigrate } from './config.js'
import { vault } from './vault.js'
import { SSHConfig, McpStatus, McpLogItem } from './types.js'
import { BrowserWindow } from 'electron'
import * as crypto from 'node:crypto'

interface PendingConfirmation {
    id: string
    connectionId: string
    serverName: string
    command: string
    timer: NodeJS.Timeout
    resolve: (approved: boolean) => void
}

interface SseSession {
    id: string
    res: http.ServerResponse
}

let server: http.Server | null = null
let currentPort: number | null = null
let connectedAgents = 0
const sseSessions = new Map<string, SseSession>()
const pendingConfirmations = new Map<string, PendingConfirmation>()


let getMainWindowRef: (() => BrowserWindow | null) | null = null

export function setMcpMainWindowGetter(getter: () => BrowserWindow | null) {
    getMainWindowRef = getter
}

function broadcastMcpEvent(event: string, payload: unknown) {
    if (!getMainWindowRef) return
    const win = getMainWindowRef()
    if (win && !win.isDestroyed()) {
        win.webContents.send(event, payload)
    }
}

export function getMcpStatus(): McpStatus {
    const config = loadConfig()
    return {
        enabled: config.mcpEnabled,
        running: server !== null && server.listening,
        port: currentPort || config.mcpPort,
        connectedAgents,
        requireConfirmation: config.mcpRequireConfirmation,
        allowedServerIds: config.mcpAllowedServerIds || [],
        pendingConfirmations: Array.from(pendingConfirmations.values()).map(p => ({
            id: p.id,
            connectionId: p.connectionId,
            serverName: p.serverName,
            command: p.command
        }))
    }
}

export function getMcpToken(): string {
    const config = loadConfig()
    return config.mcpToken || ''
}

export function handleMcpConfirmationResponse(id: string, approved: boolean, isTimeout = false) {
    const pending = pendingConfirmations.get(id)
    if (pending) {
        clearTimeout(pending.timer)
        pendingConfirmations.delete(id)
        pending.resolve(approved)
        broadcastMcpEvent('mcp-status-changed', getMcpStatus())

        if (!approved) {
            const config = loadConfig()
            const rejectEvent: McpLogItem = {
                id,
                timestamp: Date.now(),
                connectionId: pending.connectionId,
                action: 'execute_command',
                command: pending.command,
                status: 'rejected',
                error: isTimeout
                    ? (config.language === 'ru' ? 'Превышено время ожидания подтверждения (5 минут)' : 'Command approval timed out (5 minutes)')
                    : (config.language === 'ru' ? 'Выполнение отменено пользователем' : 'Execution cancelled by user')
            }
            broadcastMcpEvent('mcp-log', rejectEvent)
        }
    }
}

export async function startMcpServer(): Promise<boolean> {
    const config = loadConfig()
    if (server && server.listening) {
        if (currentPort === config.mcpPort) {
            return true
        }
        await stopMcpServer()
    }

    const port = config.mcpPort || 3000

    return new Promise((resolve) => {
        server = http.createServer((req, res) => {
            handleHttpRequest(req, res)
        })

        server.on('error', (err) => {
            console.error('[MCP] Server error:', err)
            server = null
            currentPort = null
            resolve(false)
        })

        server.listen(port, '127.0.0.1', () => {
            console.log(`[MCP] Server listening on http://127.0.0.1:${port}`)
            currentPort = port
            broadcastMcpEvent('mcp-status-changed', getMcpStatus())
            resolve(true)
        })
    })
}

export async function stopMcpServer(): Promise<void> {
    if (server) {
        return new Promise((resolve) => {
            for (const [, pending] of pendingConfirmations) {
                clearTimeout(pending.timer)
                pending.resolve(false)
            }
            pendingConfirmations.clear()

            for (const [, session] of sseSessions) {
                try { session.res.end() } catch { /* ignore */ }
            }
            sseSessions.clear()
            server?.close(() => {
                console.log('[MCP] Server stopped')
                server = null
                currentPort = null
                connectedAgents = 0
                broadcastMcpEvent('mcp-status-changed', getMcpStatus())
                resolve()
            })
        })
    }
}

export async function syncMcpServerState() {
    const config = loadConfig()
    if (config.mcpEnabled) {
        await startMcpServer()
    } else {
        await stopMcpServer()
    }
}

function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        })
        res.end()
        return
    }

    const config = loadConfig()
    const authHeader = req.headers['authorization']
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : ''

    if (token !== config.mcpToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid MCP token' }))
        return
    }

    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

    if (req.method === 'GET' && urlObj.pathname === '/sse') {
        const sessionId = crypto.randomUUID()

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        })
        if (typeof res.flushHeaders === 'function') {
            res.flushHeaders()
        }

        res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`)

        sseSessions.set(sessionId, { id: sessionId, res })
        connectedAgents = sseSessions.size
        broadcastMcpEvent('mcp-status-changed', getMcpStatus())

        req.on('close', () => {
            sseSessions.delete(sessionId)
            connectedAgents = sseSessions.size
            broadcastMcpEvent('mcp-status-changed', getMcpStatus())
        })
        return
    }

    if (req.method === 'POST') {
        const sessionId = urlObj.searchParams.get('sessionId')

        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', async () => {
            try {
                const json = JSON.parse(body)

                if (sessionId && sseSessions.has(sessionId)) {
                    const session = sseSessions.get(sessionId)!
                    res.writeHead(202, { 'Content-Type': 'text/plain' })
                    res.end('Accepted')

                    const response = await handleMcpJsonRpc(json)
                    if (response !== null && !session.res.writableEnded) {
                        session.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`)
                    }
                } else {
                    // Fallback direct HTTP JSON-RPC POST (without SSE session)
                    const response = await handleMcpJsonRpc(json)
                    if (response !== null) {
                        res.writeHead(200, { 'Content-Type': 'application/json' })
                        res.end(JSON.stringify(response))
                    } else {
                        res.writeHead(202)
                        res.end()
                    }
                }
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    error: { code: -32700, message: 'Parse error', data: String(err) },
                    id: null
                }))
            }
        })
        return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
}

async function handleMcpJsonRpc(request: unknown): Promise<unknown> {
    if (Array.isArray(request)) {
        return Promise.all(request.map(r => handleMcpJsonRpcSingle(r)))
    }
    return handleMcpJsonRpcSingle(request)
}

async function handleMcpJsonRpcSingle(req: unknown): Promise<unknown> {
    if (!req || typeof req !== 'object' || Array.isArray(req)) {
        return {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Invalid Request: payload must be an object' }
        }
    }

    const obj = req as Record<string, unknown>
    if (obj.jsonrpc !== '2.0') {
        return {
            jsonrpc: '2.0',
            id: obj.id ?? null,
            error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' }
        }
    }

    if (typeof obj.method !== 'string' || !obj.method) {
        return {
            jsonrpc: '2.0',
            id: obj.id ?? null,
            error: { code: -32600, message: 'Invalid Request: method is required and must be a string' }
        }
    }

    const id = obj.id
    if (id !== undefined && id !== null && typeof id !== 'string' && typeof id !== 'number') {
        return {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Invalid Request: id must be string, number, or null' }
        }
    }

    const params = obj.params
    if (params !== undefined && params !== null && typeof params !== 'object') {
        return {
            jsonrpc: '2.0',
            id: id ?? null,
            error: { code: -32602, message: 'Invalid params: params must be an object or array' }
        }
    }

    const method = obj.method

    // Notifications (no id response needed)
    if (id === undefined || id === null) {
        if (method === 'notifications/initialized') {
            console.log('[MCP] Client initialized notification received')
        }
        return null
    }

    switch (method) {
        case 'initialize':
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: {}
                    },
                    serverInfo: {
                        name: 'YetAnotherSSHClient-MCP',
                        version: '2.6.0'
                    }
                }
            }

        case 'tools/list':
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    tools: [
                        {
                            name: 'list_connections',
                            description: 'Get list of saved SSH connections enabled for MCP access.',
                            inputSchema: {
                                type: 'object',
                                properties: {},
                                required: []
                            }
                        },
                        {
                            name: 'execute_command',
                            description: 'Execute a bash/shell command on an allowed SSH connection and return stdout, stderr, and exit code.',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    connection_id: {
                                        type: 'string',
                                        description: 'The SSH connection ID (optional if only one connection is allowed).'
                                    },
                                    command: {
                                        type: 'string',
                                        description: 'The shell command to execute on the SSH server.'
                                    }
                                },
                                required: ['command']
                            }
                        }
                    ]
                }
            }

        case 'tools/call':
            return handleToolCall(id, params as Record<string, unknown> | undefined)

        default:
            return {
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: `Method not found: ${method}` }
            }
    }
}

async function handleToolCall(id: unknown, params: Record<string, unknown> | undefined): Promise<unknown> {
    const toolName = params?.name
    const args = (params?.arguments as Record<string, unknown>) || {}

    if (toolName === 'list_connections') {
        const config = loadConfig()
        const allowedIds = new Set(config.mcpAllowedServerIds || [])
        const allowedFavorites = (config.favorites || []).filter(f => f.id && allowedIds.has(f.id))

        const connectionsList = allowedFavorites.map(f => ({
            id: f.id,
            name: f.name || f.host,
            host: f.host,
            user: f.user,
            port: f.port || 22,
            osPrettyName: f.osPrettyName
        }))

        return {
            jsonrpc: '2.0',
            id,
            result: {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ connections: connectionsList }, null, 2)
                    }
                ]
            }
        }
    }

    if (toolName === 'execute_command') {
        const command = String(args.command || '').trim()
        if (!command) {
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    isError: true,
                    content: [{ type: 'text', text: 'Command argument is required' }]
                }
            }
        }

        const config = loadConfig()
        const allowedIds = config.mcpAllowedServerIds || []
        if (allowedIds.length === 0) {
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    isError: true,
                    content: [{ type: 'text', text: 'No SSH connections are open for MCP access.' }]
                }
            }
        }

        let targetId = typeof args.connection_id === 'string' ? args.connection_id : undefined
        if (!targetId) {
            targetId = allowedIds[0]
        }

        if (!targetId || !allowedIds.includes(targetId)) {
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    isError: true,
                    content: [{ type: 'text', text: `Connection ID '${targetId}' is not open for MCP access.` }]
                }
            }
        }

        const sshServer = (config.favorites || []).find(f => f.id === targetId)
        if (!sshServer) {
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    isError: true,
                    content: [{ type: 'text', text: `SSH server with ID '${targetId}' not found.` }]
                }
            }
        }

        const serverName = sshServer.name || sshServer.host
        const logId = crypto.randomUUID()

        // Confirmation check
        if (config.mcpRequireConfirmation) {
            const CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
            const confirmPromise = new Promise<boolean>((resolve) => {
                const timer = setTimeout(() => {
                    handleMcpConfirmationResponse(logId, false, true)
                }, CONFIRMATION_TIMEOUT_MS)

                pendingConfirmations.set(logId, {
                    id: logId,
                    connectionId: targetId,
                    serverName,
                    command,
                    timer,
                    resolve
                })
            })

            const pendingEvent: McpLogItem = {
                id: logId,
                timestamp: Date.now(),
                connectionId: targetId,
                action: 'execute_command',
                command,
                status: 'pending'
            }
            broadcastMcpEvent('mcp-log', pendingEvent)
            broadcastMcpEvent('mcp-status-changed', getMcpStatus())
            broadcastMcpEvent('mcp-request-confirmation', {
                id: logId,
                connectionId: targetId,
                serverName,
                command
            })

            const approved = await confirmPromise
            broadcastMcpEvent('mcp-status-changed', getMcpStatus())
            if (!approved) {
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        isError: true,
                        content: [{ type: 'text', text: 'Command execution denied by user or timed out.' }]
                    }
                }
            }

            const approvedEvent: McpLogItem = {
                id: logId,
                timestamp: Date.now(),
                connectionId: targetId,
                action: 'execute_command',
                command,
                status: 'approved'
            }
            broadcastMcpEvent('mcp-log', approvedEvent)
        }

        // Start execution
        const runningEvent: McpLogItem = {
            id: logId,
            timestamp: Date.now(),
            connectionId: targetId,
            action: 'execute_command',
            command,
            status: 'running'
        }
        broadcastMcpEvent('mcp-log', runningEvent)

        try {
            const execResult = await executeIsolatedSshCommand(sshServer, command)
            const successEvent: McpLogItem = {
                id: logId,
                timestamp: Date.now(),
                connectionId: targetId,
                action: 'execute_command',
                command,
                stdout: execResult.stdout,
                stderr: execResult.stderr,
                exitCode: execResult.code,
                status: execResult.code === 0 ? 'success' : 'failed'
            }
            broadcastMcpEvent('mcp-log', successEvent)

            return {
                jsonrpc: '2.0',
                id,
                result: {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                stdout: execResult.stdout,
                                stderr: execResult.stderr,
                                exitCode: execResult.code
                            }, null, 2)
                        }
                    ]
                }
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err)
            const failEvent: McpLogItem = {
                id: logId,
                timestamp: Date.now(),
                connectionId: targetId,
                action: 'execute_command',
                command,
                error: errorMsg,
                status: 'failed'
            }
            broadcastMcpEvent('mcp-log', failEvent)

            return {
                jsonrpc: '2.0',
                id,
                result: {
                    isError: true,
                    content: [{ type: 'text', text: `SSH execution error: ${errorMsg}` }]
                }
            }
        }
    }

    return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Tool not found: ${toolName}` }
    }
}

async function executeIsolatedSshCommand(
    config: SSHConfig,
    command: string
): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
        const client = new Client()
        const MAX_BYTES = 5 * 1024 * 1024
        const TRUNCATED_NOTICE = '\n[Output truncated: exceeded 5 MB limit]'

        let stdout = ''
        let stderr = ''
        let stdoutBytes = 0
        let stderrBytes = 0
        let stdoutTruncated = false
        let stderrTruncated = false
        let isResolved = false

        let timeoutTimer: NodeJS.Timeout | null = setTimeout(() => {
            cleanup(new Error('SSH command execution timed out after 120 seconds'))
        }, 120000)

        const cleanup = (err?: Error) => {
            if (isResolved) return
            isResolved = true

            if (timeoutTimer) {
                clearTimeout(timeoutTimer)
                timeoutTimer = null
            }

            client.removeAllListeners()
            try { client.end() } catch { /* ignore */ }
            try { client.destroy() } catch { /* ignore */ }

            if (err) {
                reject(err)
            }
        }

        client.on('error', (err) => {
            cleanup(err)
        })

        client.on('ready', () => {
            client.exec(command, (err, stream) => {
                if (err) {
                    return cleanup(err)
                }

                stream.on('data', (data: Buffer) => {
                    if (stdoutTruncated) return
                    stdoutBytes += data.length
                    if (stdoutBytes > MAX_BYTES) {
                        const remaining = MAX_BYTES - (stdoutBytes - data.length)
                        if (remaining > 0) {
                            stdout += data.subarray(0, remaining).toString('utf-8')
                        }
                        stdout += TRUNCATED_NOTICE
                        stdoutTruncated = true
                    } else {
                        stdout += data.toString('utf-8')
                    }
                })

                stream.stderr.on('data', (data: Buffer) => {
                    if (stderrTruncated) return
                    stderrBytes += data.length
                    if (stderrBytes > MAX_BYTES) {
                        const remaining = MAX_BYTES - (stderrBytes - data.length)
                        if (remaining > 0) {
                            stderr += data.subarray(0, remaining).toString('utf-8')
                        }
                        stderr += TRUNCATED_NOTICE
                        stderrTruncated = true
                    } else {
                        stderr += data.toString('utf-8')
                    }
                })

                stream.on('close', (code: number) => {
                    if (isResolved) return
                    isResolved = true
                    if (timeoutTimer) {
                        clearTimeout(timeoutTimer)
                        timeoutTimer = null
                    }
                    client.removeAllListeners()
                    try { client.end() } catch { /* ignore */ }
                    try { client.destroy() } catch { /* ignore */ }
                    resolve({ stdout, stderr, code })
                })
            })
        })

        const connectConfig: ConnectConfig = {
            host: config.host,
            port: config.port || 22,
            username: config.user,
            readyTimeout: 15000,
        }

        if (config.authType === 'key' && config.privateKeyPath) {
            try {
                connectConfig.privateKey = fs.readFileSync(config.privateKeyPath)
            } catch (err) {
                return cleanup(err instanceof Error ? err : new Error(String(err)))
            }
        } else {
            const appConfig = loadConfig()
            initializeVaultAndMigrate(appConfig)
            const serverId = config.id
            if (serverId && appConfig.encryptedPasswords?.[serverId]) {
                try {
                    connectConfig.password = vault.decrypt(appConfig.encryptedPasswords[serverId])
                } catch {
                    return cleanup(new Error('Vault decryption failed'))
                }
            } else {
                connectConfig.password = config.password
            }
        }

        try {
            client.connect(connectConfig)
        } catch (err) {
            cleanup(err instanceof Error ? err : new Error(String(err)))
        }
    })
}
