import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { McpToolCallLog } from '../../../../src/types.js'
import { loadConfig } from '../../config.js'
import { confirmationManager, broadcastMcpEvent } from '../confirmation-manager.js'
import { recheckAuthorizationBeforeExecution, executeIsolatedSshCommand } from '../ssh-executor.js'
import { mcpExecutionManager } from '../execution-manager.js'
import { timelineManager } from '../timeline-manager.js'
import { finishToolExecution, type ToolExecutionMeta } from './shared.js'

export function installExecuteCommandTool(
    server: McpServer,
    getMcpStatusFn?: () => unknown
): void {
    server.registerTool(
        'execute_command',
        {
            description: 'Execute a bash/shell command on an allowed SSH connection and return stdout, stderr, and exit code. If multiple connections are open, connection_id is strictly required.',
            inputSchema: {
                connection_id: z.string().optional().describe('The SSH connection ID (required if multiple connections are open for MCP access).'),
                command: z.string().min(1).describe('The shell command to execute on the SSH server.')
            }
        },
        async (args, extra) => {
            const sessionId = extra.sessionId || ''
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

            // Initial authorization check
            const initialAuth = recheckAuthorizationBeforeExecution(targetId, sessionId)
            if (!initialAuth.authorized) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: `Authorization denied: ${initialAuth.reason}` }]
                }
            }

            // Timeline: begin agent run (emits "request received" event) and register tool call
            const { runId, callId } = timelineManager.beginToolCall(sessionId, targetId, 'execute_command')
            const toolMeta: Partial<McpToolCallLog> = {
                runId,
                kind: 'tool_call',
                toolName: 'execute_command',
                args
            }

            // Confirmation check
            if (config.mcpRequireConfirmation) {
                const statusFn = getMcpStatusFn || (() => ({}))
                const approved = await confirmationManager.createConfirmation(
                    callId,
                    sessionId,
                    targetId,
                    serverName,
                    command,
                    statusFn,
                    toolMeta
                )

                if (!approved) {
                    timelineManager.finishToolCall(runId, callId, 'cancelled')
                    return {
                        isError: true,
                        content: [{ type: 'text', text: 'Command execution denied by user, timed out, or invalidated.' }]
                    }
                }
            }

            // RE-CHECK AUTHORIZATION IMMEDIATELY BEFORE RUNNING SSH COMMAND
            const finalAuth = recheckAuthorizationBeforeExecution(targetId, sessionId, config.mcpRequireConfirmation ? callId : undefined)
            if (!finalAuth.authorized || !finalAuth.server) {
                const errorMsg = `Execution blocked immediately before run: ${finalAuth.reason || 'Authorization revoked'}`
                broadcastMcpEvent('mcp-log', {
                    ...toolMeta,
                    id: callId,
                    timestamp: Date.now(),
                    connectionId: targetId,
                    command,
                    startedAt: Date.now(),
                    status: 'failed',
                    error: errorMsg
                })
                timelineManager.finishToolCall(runId, callId, 'failed')

                return {
                    isError: true,
                    content: [{ type: 'text', text: errorMsg }]
                }
            }

            // Execution start (realtime update of the existing tool-call row)
            const callStartedAt = Date.now()
            broadcastMcpEvent('mcp-log', {
                ...toolMeta,
                id: callId,
                timestamp: callStartedAt,
                connectionId: targetId,
                command,
                startedAt: callStartedAt,
                status: 'running'
            })

            const meta: ToolExecutionMeta = {
                runId,
                callId,
                sessionId,
                connectionId: targetId,
                toolName: 'execute_command',
                command,
                baseLog: toolMeta,
                startedAt: callStartedAt
            }

            let abortSignal: AbortSignal | undefined
            try {
                abortSignal = mcpExecutionManager.register(callId, sessionId, targetId)
                const execResult = await executeIsolatedSshCommand(finalAuth.server, command, abortSignal)
                const status: 'success' | 'failed' = execResult.code === 0 ? 'success' : 'failed'

                finishToolExecution(meta, {
                    status,
                    stdout: execResult.stdout,
                    stderr: execResult.stderr,
                    exitCode: execResult.code
                })

                const resultText = JSON.stringify({
                    stdout: execResult.stdout,
                    stderr: execResult.stderr,
                    exitCode: execResult.code
                }, null, 2)

                return {
                    content: [
                        {
                            type: 'text',
                            text: resultText
                        }
                    ]
                }
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err)
                const cancelled = abortSignal?.aborted
                const status: 'cancelled' | 'failed' = cancelled ? 'cancelled' : 'failed'

                finishToolExecution(meta, {
                    status,
                    error: errorMsg
                })

                return {
                    isError: true,
                    content: [{ type: 'text', text: `SSH execution error: ${errorMsg}` }]
                }
            } finally {
                mcpExecutionManager.unregister(callId)
            }
        }
    )
}