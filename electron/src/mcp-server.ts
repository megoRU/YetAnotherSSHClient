import * as http from 'node:http'
import { Client, type ConnectConfig } from 'ssh2'
import * as fs from 'node:fs'
import { loadConfig, initializeVaultAndMigrate, saveConfigAsync } from './config.js'
import { vault } from './vault.js'
import { SSHConfig } from './types.js'
import { BrowserWindow } from 'electron'
import * as crypto from 'node:crypto'

interface PendingConfirmation {
    id: string
    connectionId: string
    serverName: string
    command: string
    resolve: (approved: boolean) => void
}

let server: http.Server | null = null
let currentPort: number | null = null
let connectedAgents = 0
const pendingConfirmations = new Map<string, PendingConfirmation>()

export interface McpLogEvent {
    id: string
    timestamp: number
    connectionId: string
    action: string
    command?: string
    stdout?: string
    stderr?: string
    exitCode?: number | null
    error?: string
    status: 'pending' | 'approved' | 'rejected' | 'running' | 'success' | 'failed'
}

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

export function getMcpStatus() {
    const config = loadConfig()
    return {
        enabled: config.mcpEnabled,
        running: server !== null && server.listening,
        port: currentPort || config.mcpPort,
        connectedAgents,
        token: config.mcpToken,
        requireConfirmation: config.mcpRequireConfirmation,
        allowedServerIds: config.mcpAllowedServerIds || []
    }
}

export function handleMcpConfirmationResponse(id: string, approved: boolean) {
    const pending = pendingConfirmations.get(id)
    if (pending) {
        pendingConfirmations.delete(id)
        pending.resolve(approved)
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
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
    }

    const config = loadConfig()
    const authHeader = req.headers['authorization']
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : ''

    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const queryToken = urlObj.searchParams.get('token')

    if (token !== config.mcpToken && queryToken !== config.mcpToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid MCP token' }))
        return
    }

    if (req.method === 'GET' && urlObj.pathname === '/sse') {
        // SSE transport support for MCP
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        })
        connectedAgents++
        broadcastMcpEvent('mcp-status-changed', getMcpStatus())

        req.on('close', () => {
            connectedAgents = Math.max(0, connectedAgents - 1)
            broadcastMcpEvent('mcp-status-changed', getMcpStatus())
        })
        return
    }

    if (req.method === 'POST') {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', async () => {
            try {
                const json = JSON.parse(body)
                const response = await handleMcpJsonRpc(json)
                if (response !== null) {
                    res.writeHead(200, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify(response))
                } else {
                    res.writeHead(202)
                    res.end()
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

async function handleMcpJsonRpc(request: any): Promise<any> {
    if (Array.isArray(request)) {
        return Promise.all(request.map(r => handleMcpJsonRpcSingle(r)))
    }
    return handleMcpJsonRpcSingle(request)
}

async function handleMcpJsonRpcSingle(req: any): Promise<any> {
    if (!req || typeof req !== 'object') {
        return { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null }
    }

    const { id, method, params } = req

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
                        version: '2.5.7'
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
            return handleToolCall(id, params)

        default:
            return {
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: `Method not found: ${method}` }
            }
    }
}

async function handleToolCall(id: any, params: any): Promise<any> {
    const toolName = params?.name
    const args = params?.arguments || {}

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

        let targetId = args.connection_id
        if (!targetId) {
            targetId = allowedIds[0]
        }

        if (!allowedIds.includes(targetId)) {
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
            const confirmPromise = new Promise<boolean>((resolve) => {
                pendingConfirmations.set(logId, {
                    id: logId,
                    connectionId: targetId,
                    serverName,
                    command,
                    resolve
                })
            })

            const logEvent: McpLogEvent = {
                id: logId,
                timestamp: Date.now(),
                connectionId: targetId,
                action: 'execute_command',
                command,
                status: 'pending'
            }
            broadcastMcpEvent('mcp-log', logEvent)
            broadcastMcpEvent('mcp-request-confirmation', {
                id: logId,
                connectionId: targetId,
                serverName,
                command
            })

            const approved = await confirmPromise
            if (!approved) {
                const rejectEvent: McpLogEvent = {
                    id: logId,
                    timestamp: Date.now(),
                    connectionId: targetId,
                    action: 'execute_command',
                    command,
                    status: 'rejected',
                    error: 'Execution cancelled by user'
                }
                broadcastMcpEvent('mcp-log', rejectEvent)
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        isError: true,
                        content: [{ type: 'text', text: 'Command execution denied by user.' }]
                    }
                }
            }
        }

        // Start execution
        const runningEvent: McpLogEvent = {
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
            const successEvent: McpLogEvent = {
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
            const failEvent: McpLogEvent = {
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

        client.on('error', (err) => {
            reject(err)
        })

        client.on('ready', () => {
            client.exec(command, (err, stream) => {
                if (err) {
                    client.end()
                    return reject(err)
                }

                let stdout = ''
                let stderr = ''

                stream.on('data', (data: Buffer) => {
                    stdout += data.toString()
                })

                stream.stderr.on('data', (data: Buffer) => {
                    stderr += data.toString()
                })

                stream.on('close', (code: number) => {
                    client.end()
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
                return reject(err)
            }
        } else {
            const appConfig = loadConfig()
            initializeVaultAndMigrate(appConfig)
            const serverId = config.id
            if (serverId && appConfig.encryptedPasswords?.[serverId]) {
                try {
                    connectConfig.password = vault.decrypt(appConfig.encryptedPasswords[serverId])
                } catch {
                    return reject(new Error('Vault decryption failed'))
                }
            } else {
                connectConfig.password = config.password
            }
        }

        client.connect(connectConfig)
    })
}
