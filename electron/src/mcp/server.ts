import * as http from 'node:http'
import * as crypto from 'node:crypto'
import { loadConfig } from '../config.js'
import { McpStatus, McpServerState } from './mcp-types.js'
import { sessionManager } from './session-manager.js'
import { confirmationManager, broadcastMcpEvent } from './confirmation-manager.js'
import { handleMcpJsonRpc } from './jsonrpc-handler.js'

let server: http.Server | null = null
let currentPort: number | null = null
let serverState: McpServerState = 'disabled'
let serverErrorMessage: string | undefined = undefined

export function getMcpStatus(): McpStatus {
    const config = loadConfig()
    const isRunning = server !== null && server.listening && serverState === 'running'
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
    const config = loadConfig()
    if (!config.mcpEnabled) {
        serverState = 'disabled'
        return false
    }

    if (server && server.listening) {
        if (currentPort === config.mcpPort) {
            serverState = 'running'
            return true
        }
        await stopMcpServer()
    }

    serverState = 'starting'
    serverErrorMessage = undefined
    broadcastMcpEvent('mcp-status-changed', getMcpStatus())

    const port = config.mcpPort || 3000

    return new Promise((resolve) => {
        const httpServer = http.createServer((req, res) => {
            handleHttpRequest(req, res)
        })

        httpServer.on('error', (err: Error & { code?: string }) => {
            console.error('[MCP] Server error:', err)
            server = null
            currentPort = null
            serverState = 'failed'
            serverErrorMessage = err.code === 'EADDRINUSE'
                ? `Port ${port} is already in use`
                : err.message
            broadcastMcpEvent('mcp-status-changed', getMcpStatus())
            resolve(false)
        })

        httpServer.listen(port, '127.0.0.1', () => {
            console.log(`[MCP] Server listening on http://127.0.0.1:${port}`)
            server = httpServer
            currentPort = port
            serverState = 'running'
            serverErrorMessage = undefined

            sessionManager.setOnSessionDisconnect((sessionId) => {
                confirmationManager.revokeBySessionId(sessionId, getMcpStatus)
                broadcastMcpEvent('mcp-status-changed', getMcpStatus())
            })

            broadcastMcpEvent('mcp-status-changed', getMcpStatus())
            resolve(true)
        })
    })
}

export async function stopMcpServer(): Promise<void> {
    serverState = 'stopping'
    broadcastMcpEvent('mcp-status-changed', getMcpStatus())

    confirmationManager.revokeAll('session_closed')
    sessionManager.clearAllSessions()

    if (server) {
        return new Promise((resolve) => {
            server?.close(() => {
                console.log('[MCP] Server stopped')
                server = null
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

function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
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
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        })
        if (typeof res.flushHeaders === 'function') {
            res.flushHeaders()
        }

        res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`)

        sessionManager.addSession(sessionId, { id: sessionId, res, req })
        broadcastMcpEvent('mcp-status-changed', getMcpStatus())
        return
    }

    if (req.method === 'POST') {
        const sessionId = urlObj.searchParams.get('sessionId')
        const MAX_BODY_BYTES = 1 * 1024 * 1024 // 1 MB limit

        let body = ''
        let bodyBytes = 0
        let isAborted = false

        req.on('data', (chunk: Buffer) => {
            if (isAborted) return
            bodyBytes += chunk.length
            if (bodyBytes > MAX_BODY_BYTES) {
                isAborted = true
                req.destroy()
                res.writeHead(413, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32600, message: 'Payload Too Large: HTTP body exceeded 1 MB limit' }
                }))
                return
            }
            body += chunk.toString('utf-8')
        })

        req.on('end', async () => {
            if (isAborted) return
            try {
                let json: unknown
                try {
                    json = JSON.parse(body)
                } catch (parseErr) {
                    res.writeHead(400, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({
                        jsonrpc: '2.0',
                        id: null,
                        error: { code: -32700, message: 'Parse error', data: String(parseErr) }
                    }))
                    return
                }

                if (sessionId && sessionManager.hasSession(sessionId)) {
                    res.writeHead(202, { 'Content-Type': 'text/plain' })
                    res.end('Accepted')

                    const response = await handleMcpJsonRpc(json, sessionId, getMcpStatus)
                    if (response !== null) {
                        sessionManager.sendSseMessage(sessionId, response)
                    }
                } else if (sessionId) {
                    // Session ID provided but session invalid/disconnected
                    res.writeHead(404, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({
                        jsonrpc: '2.0',
                        id: null,
                        error: { code: -32600, message: `Session not found or disconnected: ${sessionId}` }
                    }))
                } else {
                    // Direct HTTP JSON-RPC POST (without SSE session)
                    const response = await handleMcpJsonRpc(json, undefined, getMcpStatus)
                    if (response !== null) {
                        res.writeHead(200, { 'Content-Type': 'application/json' })
                        res.end(JSON.stringify(response))
                    } else {
                        res.writeHead(202)
                        res.end()
                    }
                }
            } catch (err) {
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({
                        jsonrpc: '2.0',
                        id: null,
                        error: { code: -32603, message: 'Internal error', data: String(err) }
                    }))
                }
            }
        })
        return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
}
