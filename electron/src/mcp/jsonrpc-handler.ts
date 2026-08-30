import { loadConfig } from '../config.js'
import { McpLogItem } from '../types.js'
import { confirmationManager, broadcastMcpEvent } from './confirmation-manager.js'
import { recheckAuthorizationBeforeExecution, executeIsolatedSshCommand } from './ssh-executor.js'
import * as crypto from 'node:crypto'

function isPlainObject(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

export async function handleMcpJsonRpc(
    request: unknown,
    sessionId?: string,
    getMcpStatusFn?: () => unknown
): Promise<unknown> {
    if (Array.isArray(request)) {
        // MCP specification: handle batch requests if array is passed
        if (request.length === 0) {
            return {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32600, message: 'Invalid Request: batch array is empty' }
            }
        }
        const responses = await Promise.all(request.map(r => handleMcpJsonRpcSingle(r, sessionId, getMcpStatusFn)))
        // Filter out notifications (responses that returned null)
        const nonNullResponses = responses.filter(r => r !== null)
        return nonNullResponses.length > 0 ? nonNullResponses : null
    }
    return handleMcpJsonRpcSingle(request, sessionId, getMcpStatusFn)
}

async function handleMcpJsonRpcSingle(
    req: unknown,
    sessionId?: string,
    getMcpStatusFn?: () => unknown
): Promise<unknown> {
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
            id: obj.id !== undefined ? obj.id : null,
            error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' }
        }
    }

    if (typeof obj.method !== 'string' || !obj.method) {
        return {
            jsonrpc: '2.0',
            id: obj.id !== undefined ? obj.id : null,
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
    if (params !== undefined && params !== null && !isPlainObject(params)) {
        return {
            jsonrpc: '2.0',
            id: id ?? null,
            error: { code: -32602, message: 'Invalid params: params must be an object' }
        }
    }

    const method = obj.method

    // Notifications (no id response needed)
    if (id === undefined) {
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
                            description: 'Execute a bash/shell command on an allowed SSH connection and return stdout, stderr, and exit code. If multiple connections are open, connection_id is strictly required.',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    connection_id: {
                                        type: 'string',
                                        description: 'The SSH connection ID (required if multiple connections are open for MCP access).'
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
            return handleToolCall(id, params as Record<string, unknown> | undefined, sessionId, getMcpStatusFn)

        default:
            return {
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: `Method not found: ${method}` }
            }
    }
}

async function handleToolCall(
    id: unknown,
    params: Record<string, unknown> | undefined,
    sessionId?: string,
    getMcpStatusFn?: () => unknown
): Promise<unknown> {
    if (!params || !isPlainObject(params)) {
        return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Invalid params: params object is required for tools/call' }
        }
    }

    if (typeof params.name !== 'string' || !params.name.trim()) {
        return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Invalid params: params.name must be a non-empty string' }
        }
    }

    if (params.arguments !== undefined && params.arguments !== null && !isPlainObject(params.arguments)) {
        return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Invalid params: params.arguments must be an object' }
        }
    }

    const toolName = params.name
    const args = (params.arguments as Record<string, unknown>) || {}

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
            if (allowedIds.length === 1) {
                targetId = allowedIds[0]
            } else {
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        isError: true,
                        content: [{ type: 'text', text: `Multiple SSH connections are open for MCP access. Please specify 'connection_id'. Available IDs: ${allowedIds.join(', ')}` }]
                    }
                }
            }
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
        const activeSessionId = sessionId || 'direct-session'

        // Pre-execution authorization check
        const initialAuth = recheckAuthorizationBeforeExecution(targetId, sessionId)
        if (!initialAuth.authorized) {
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    isError: true,
                    content: [{ type: 'text', text: `Authorization denied: ${initialAuth.reason}` }]
                }
            }
        }

        // Confirmation check
        if (config.mcpRequireConfirmation) {
            const statusFn = getMcpStatusFn || (() => ({}))
            const approved = await confirmationManager.createConfirmation(
                logId,
                activeSessionId,
                targetId,
                serverName,
                command,
                statusFn
            )

            if (!approved) {
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        isError: true,
                        content: [{ type: 'text', text: 'Command execution denied by user, timed out, or invalidated.' }]
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

        // RE-CHECK AUTHORIZATION IMMEDIATELY BEFORE EXECUTION
        const finalAuth = recheckAuthorizationBeforeExecution(targetId, sessionId)
        if (!finalAuth.authorized || !finalAuth.server) {
            const errorMsg = `Execution blocked immediately before run: ${finalAuth.reason || 'Authorization revoked'}`
            const blockedEvent: McpLogItem = {
                id: logId,
                timestamp: Date.now(),
                connectionId: targetId,
                action: 'execute_command',
                command,
                status: 'rejected',
                error: errorMsg
            }
            broadcastMcpEvent('mcp-log', blockedEvent)

            return {
                jsonrpc: '2.0',
                id,
                result: {
                    isError: true,
                    content: [{ type: 'text', text: errorMsg }]
                }
            }
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
            const execResult = await executeIsolatedSshCommand(finalAuth.server, command)
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
