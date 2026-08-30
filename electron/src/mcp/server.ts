import * as http from 'node:http'
import * as crypto from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { loadConfig } from '../config.js'
import { McpStatus, McpServerState } from './mcp-types.js'
import { confirmationManager, broadcastMcpEvent } from './confirmation-manager.js'
import { sessionManager } from './session-manager.js'
import { createMcpServerInstance } from './jsonrpc-handler.js'
import { mcpExecutionManager } from './execution-manager.js'

let httpServer: http.Server | null = null
let currentPort: number | null = null
let serverState: McpServerState = 'disabled'
let serverErrorMessage: string | undefined = undefined
let lifecycleQueue: Promise<unknown> = Promise.resolve()

export function getMcpStatus(): McpStatus {
    const config = loadConfig()
    const isRunning = httpServer !== null && httpServer.listening && serverState === 'running'
    return {
        enabled: config.mcpEnabled,
        running: isRunning,
        state: isRunning ? 'running' : (config.mcpEnabled ? serverState : 'disabled'),
        port: currentPort || config.mcpPort,
        connectedAgents: sessionManager.connectedCount,
        requireConfirmation: config.mcpRequireConfirmation,
        allowedServerIds: config.mcpAllowedServerIds || [],
        pendingConfirmations: confirmationManager.getPendingList(),
        error: serverErrorMessage
    }
}

export function getMcpToken(): string {
    const config = loadConfig()
    return config.mcpToken || ''
}

export function handleMcpConfirmationResponse(id: string, approved: boolean, expectedSessionId?: string) {
    confirmationManager.handleResponse(id, approved, 'user', expectedSessionId, getMcpStatus)
}

export async function startMcpServer(): Promise<boolean> {
    const result = lifecycleQueue.then(startMcpServerInternal, startMcpServerInternal)
    lifecycleQueue = result.catch(() => undefined)
    return result
}

async function startMcpServerInternal(): Promise<boolean> {
    const config = loadConfig()
    if (!config.mcpEnabled) {
        serverState = 'disabled'
        return false
    }

    if (httpServer && httpServer.listening) {
        if (currentPort === config.mcpPort) {
            serverState = 'running'
            return true
        }
        await stopMcpServerInternal()
    }

    serverState = 'starting'
    serverErrorMessage = undefined
    broadcastMcpEvent('mcp-status-changed', getMcpStatus())

    const port = config.mcpPort
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        serverState = 'failed'
        serverErrorMessage = 'MCP port must be an integer between 1 and 65535'
        broadcastMcpEvent('mcp-status-changed', getMcpStatus())
        return false
    }
    sessionManager.setOnSessionDisconnect((sessionId) => {
        confirmationManager.revokeBySessionId(sessionId, getMcpStatus)
        broadcastMcpEvent('mcp-status-changed', getMcpStatus())
    })

    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            handleHttpRequest(req, res).catch((err) => {
                console.error('[MCP] Unhandled HTTP request error:', err)
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ error: 'Internal Server Error' }))
                }
            })
        })

        server.on('error', (err: Error & { code?: string }) => {
            console.error('[MCP] Server error:', err)
            httpServer = null
            currentPort = null
            serverState = 'failed'
            serverErrorMessage = err.code === 'EADDRINUSE'
                ? `Port ${port} is already in use`
                : err.message
            broadcastMcpEvent('mcp-status-changed', getMcpStatus())
            resolve(false)
        })

        server.listen(port, '127.0.0.1', () => {
            console.log(`[MCP] Server listening on http://127.0.0.1:${port}`)
            httpServer = server
            currentPort = port
            serverState = 'running'
            serverErrorMessage = undefined

            broadcastMcpEvent('mcp-status-changed', getMcpStatus())
            resolve(true)
        })
    })
}

export async function stopMcpServer(): Promise<void> {
    const result = lifecycleQueue.then(stopMcpServerInternal, stopMcpServerInternal)
    lifecycleQueue = result.catch(() => undefined)
    await result
}

async function stopMcpServerInternal(): Promise<void> {
    serverState = 'stopping'
    broadcastMcpEvent('mcp-status-changed', getMcpStatus())

    confirmationManager.revokeAll('session_closed', getMcpStatus)
    mcpExecutionManager.cancelAll()
    await sessionManager.clearAll()

    if (httpServer) {
        return new Promise((resolve) => {
            httpServer?.close(() => {
                console.log('[MCP] Server stopped')
                httpServer = null
                currentPort = null
                serverState = 'disabled'
                serverErrorMessage = undefined
                broadcastMcpEvent('mcp-status-changed', getMcpStatus())
                resolve()
            })
        })
    } else {
        serverState = 'disabled'
        serverErrorMessage = undefined
        broadcastMcpEvent('mcp-status-changed', getMcpStatus())
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

function isValidBearerToken(authHeader: string | undefined, expectedToken: string): boolean {
    if (!authHeader || !expectedToken) return false
    if (!authHeader.startsWith('Bearer ')) return false

    const tokenStr = authHeader.substring(7).trim()
    const tokenBuf = Buffer.from(tokenStr, 'utf-8')
    const expectedBuf = Buffer.from(expectedToken, 'utf-8')

    if (tokenBuf.length !== expectedBuf.length) return false
    return crypto.timingSafeEqual(tokenBuf, expectedBuf)
}

async function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const config = loadConfig()
    const authHeader = req.headers['authorization']

    if (!isValidBearerToken(authHeader, config.mcpToken || '')) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid MCP token' }))
        return
    }

    const urlObj = new URL(req.url || '/', 'http://127.0.0.1')

    // 1 MB Body limit check for POST requests
    if (req.method === 'POST') {
        const MAX_BODY_BYTES = 1 * 1024 * 1024 // 1 MB limit
        const contentLength = Number(req.headers['content-length'])
        if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
            res.writeHead(413, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Payload Too Large: HTTP body exceeded 1 MB limit' }))
            req.resume()
            return
        }
        let bytesReceived = 0
        let isAborted = false

        const onData = (chunk: Buffer) => {
            if (isAborted) return
            bytesReceived += chunk.length
            if (bytesReceived > MAX_BODY_BYTES) {
                isAborted = true
                req.removeListener('data', onData)
                req.destroy()
                if (!res.headersSent) {
                    res.writeHead(413, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ error: 'Payload Too Large: HTTP body exceeded 1 MB limit' }))
                }
            }
        }

        req.on('data', onData)
    }

    // Streamable HTTP endpoint: strictly /mcp
    if (urlObj.pathname === '/mcp') {
        const sessionIdHeader = req.headers['mcp-session-id'] as string | undefined
        let transport: StreamableHTTPServerTransport
        let server = null

        if (sessionIdHeader && sessionManager.hasTransport(sessionIdHeader)) {
            transport = sessionManager.getTransport(sessionIdHeader)!
        } else {
            server = createMcpServerInstance(getMcpStatus)
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => crypto.randomUUID(),
                onsessioninitialized: (sessionId) => {
                    sessionManager.addSession(sessionId, transport, server!)
                    broadcastMcpEvent('mcp-status-changed', getMcpStatus())
                },
                onsessionclosed: (sessionId) => {
                    sessionManager.removeSession(sessionId)
                }
            })

            try {
                await server.connect(transport)
            } catch (err) {
                console.error('[MCP] Server connect transport error:', err)
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ error: 'Failed to connect MCP transport' }))
                }
                return
            }
        }

        try {
            await transport.handleRequest(req, res)
            if (server && !transport.sessionId) {
                await server.close()
            }
            broadcastMcpEvent('mcp-status-changed', getMcpStatus())
        } catch (err) {
            console.error('[MCP] Transport handleRequest error:', err)
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'Internal Server Error' }))
            }
        }
        return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
}
