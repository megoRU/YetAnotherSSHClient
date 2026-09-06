import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as crypto from 'node:crypto'
import { loadConfig } from '../config.js'
import { McpLogItem, VERSION } from '../../../src/types.js'
import { confirmationManager, broadcastMcpEvent } from './confirmation-manager.js'
import { recheckAuthorizationBeforeExecution, executeIsolatedSshCommand } from './ssh-executor.js'
import { mcpExecutionManager } from './execution-manager.js'

export function createMcpServerInstance(getMcpStatusFn?: () => unknown) {
    const server = new McpServer({
        name: 'YetAnotherSSHClient-MCP',
        version: VERSION
    })

    // Tool: list_connections
    server.tool(
        'list_connections',
        'Get list of saved SSH connections enabled for MCP access.',
        {},
        async () => {
            const config = loadConfig()
            if (!config.mcpEnabled) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'MCP server is disabled.' }]
                }
            }

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
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ connections: connectionsList }, null, 2)
                    }
                ]
            }
        }
    )

    // Tool: execute_command
    server.tool(
        'execute_command',
        'Execute a bash/shell command on an allowed SSH connection and return stdout, stderr, and exit code. If multiple connections are open, connection_id is strictly required.',
        {
            connection_id: z.string().optional().describe('The SSH connection ID (required if multiple connections are open for MCP access).'),
            command: z.string().min(1).describe('The shell command to execute on the SSH server.')
        },
        async (args, extra) => {
            const command = args.command.trim()
            if (!command) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'Command argument is required' }]
                }
            }

            const config = loadConfig()
            if (!config.mcpEnabled) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'MCP server is disabled.' }]
                }
            }

            const allowedIds = config.mcpAllowedServerIds || []
            if (allowedIds.length === 0) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'No SSH connections are open for MCP access.' }]
                }
            }

            let targetId = args.connection_id
            if (!targetId) {
                if (allowedIds.length === 1) {
                    targetId = allowedIds[0]
                } else {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: `Multiple SSH connections are open for MCP access. Please specify 'connection_id'. Available IDs: ${allowedIds.join(', ')}` }]
                    }
                }
            }

            if (!targetId || !allowedIds.includes(targetId)) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: `Connection ID '${targetId}' is not open for MCP access.` }]
                }
            }

            const sshServer = (config.favorites || []).find(f => f.id === targetId)
            if (!sshServer) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: `SSH server with ID '${targetId}' not found.` }]
                }
            }

            const serverName = sshServer.name || sshServer.host
            const logId = crypto.randomUUID()
            const sessionId = extra.sessionId || ''

            // Initial authorization check
            const initialAuth = recheckAuthorizationBeforeExecution(targetId, sessionId)
            if (!initialAuth.authorized) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: `Authorization denied: ${initialAuth.reason}` }]
                }
            }

            // Confirmation check
            if (config.mcpRequireConfirmation) {
                const statusFn = getMcpStatusFn || (() => ({}))
                const approved = await confirmationManager.createConfirmation(
                    logId,
                    sessionId,
                    targetId,
                    serverName,
                    command,
                    statusFn
                )

                if (!approved) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: 'Command execution denied by user, timed out, or invalidated.' }]
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

            // RE-CHECK AUTHORIZATION IMMEDIATELY BEFORE RUNNING SSH COMMAND
            const finalAuth = recheckAuthorizationBeforeExecution(targetId, sessionId, config.mcpRequireConfirmation ? logId : undefined)
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
                    isError: true,
                    content: [{ type: 'text', text: errorMsg }]
                }
            }

            // Execution start
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
                const abortSignal = mcpExecutionManager.register(logId, sessionId, targetId)
                const execResult = await executeIsolatedSshCommand(finalAuth.server, command, abortSignal)
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
                    isError: true,
                    content: [{ type: 'text', text: `SSH execution error: ${errorMsg}` }]
                }
            } finally {
                mcpExecutionManager.unregister(logId)
            }
        }
    )

    return server
}
