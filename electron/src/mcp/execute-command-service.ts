import type { McpStatus, McpToolCallLog } from '../../../src/types.js'
import { loadConfig } from '../config.js'
import { broadcastMcpEvent, confirmationManager } from './confirmation-manager.js'
import { executeIsolatedSshCommand, recheckAuthorizationBeforeExecution } from './ssh-executor.js'
import { mcpExecutionManager } from './execution-manager.js'
import { timelineManager } from './timeline-manager.js'
import { finishToolExecution, type ToolExecutionMeta } from './tools/shared.js'

export const EXECUTE_COMMAND_TOOL_NAME = 'execute_command'

/** Входные аргументы tool-вызова (как их принимает MCP SDK). */
export interface ExecuteCommandArgs {
    connection_id?: string
    command: string
}

export interface ExecuteCommandRequest {
    /** Сырые аргументы вызова — попадают в timeline-лог без изменений. */
    args: ExecuteCommandArgs
    /** Команда после trim (то, что реально выполняется). */
    command: string
    sessionId: string
    getMcpStatusFn?: () => McpStatus
}

export interface ExecuteCommandResponse {
    isError: boolean
    text: string
}

/**
 * Терминальные состояния tool-вызова. `completeToolCall` — единственная точка
 * завершения: success / failed / cancelled / denied проходят через неё, поэтому
 * broadcast + timeline не дублируются.
 */
type ToolCompletion =
    | { kind: 'executed'; status: 'success' | 'failed'; stdout?: string; stderr?: string; exitCode?: number | null }
    | { kind: 'execution-error'; status: 'failed' | 'cancelled'; error: string }
    | { kind: 'blocked'; error: string }
    | { kind: 'denied' }

/** Полная последовательность orchestration: authorization → confirmation → final authorization → execution → completion. */
export async function executeCommandTool(req: ExecuteCommandRequest): Promise<ExecuteCommandResponse> {
    const config = loadConfig()

    if (!config.mcpEnabled) {
        return fail('MCP server is disabled.')
    }

    const allowedIds = config.mcpAllowedServerIds || []
    if (allowedIds.length === 0) {
        return fail('No SSH connections are open for MCP access.')
    }

    let targetId = req.args.connection_id
    if (!targetId) {
        if (allowedIds.length === 1) {
            targetId = allowedIds[0]
        } else {
            return fail(`Multiple SSH connections are open for MCP access. Please specify 'connection_id'. Available IDs: ${allowedIds.join(', ')}`)
        }
    }

    if (!targetId || !allowedIds.includes(targetId)) {
        return fail(`Connection ID '${targetId}' is not open for MCP access.`)
    }

    const sshServer = (config.favorites || []).find(f => f.id === targetId)
    if (!sshServer) {
        return fail(`SSH server with ID '${targetId}' not found.`)
    }

    // Initial authorization check
    const initialAuth = recheckAuthorizationBeforeExecution(targetId, req.sessionId)
    if (!initialAuth.authorized) {
        return fail(`Authorization denied: ${initialAuth.reason}`)
    }

    const serverName = sshServer.name || sshServer.host
    const getMcpStatusFn = req.getMcpStatusFn || (() => ({ enabled: false, running: false, port: 0, connectedAgents: 0, requireConfirmation: false, allowedServerIds: [] }))

    // Timeline: begin agent run (emits "request received" event) and register tool call
    const { runId, callId } = timelineManager.beginToolCall(req.sessionId, targetId, EXECUTE_COMMAND_TOOL_NAME)
    const toolMeta: Partial<McpToolCallLog> = {
        runId,
        kind: 'tool_call',
        toolName: EXECUTE_COMMAND_TOOL_NAME,
        args: req.args
    }

    const meta: ToolExecutionMeta = {
        runId,
        callId,
        sessionId: req.sessionId,
        connectionId: targetId,
        toolName: EXECUTE_COMMAND_TOOL_NAME,
        command: req.command,
        baseLog: toolMeta,
        startedAt: Date.now()
    }

    // Confirmation check
    if (config.mcpRequireConfirmation) {
        const approved = await confirmationManager.createConfirmation(
            callId,
            req.sessionId,
            targetId,
            serverName,
            req.command,
            getMcpStatusFn,
            toolMeta
        )

        if (!approved) {
            // Событие tool_call (cancelled) уже отправлено confirmationManager'ом.
            completeToolCall(meta, { kind: 'denied' })
            return fail('Command execution denied by user, timed out, or invalidated.')
        }
    }

    // RE-CHECK AUTHORIZATION IMMEDIATELY BEFORE RUNNING SSH COMMAND
    const finalAuth = recheckAuthorizationBeforeExecution(targetId, req.sessionId, config.mcpRequireConfirmation ? callId : undefined)
    if (!finalAuth.authorized || !finalAuth.server) {
        const errorMsg = `Execution blocked immediately before run: ${finalAuth.reason || 'Authorization revoked'}`
        completeToolCall(meta, { kind: 'blocked', error: errorMsg })
        return fail(errorMsg)
    }

    // Execution start (realtime update of the existing tool-call row)
    meta.startedAt = Date.now()
    broadcastMcpEvent('mcp-log', {
        ...toolMeta,
        id: callId,
        timestamp: meta.startedAt,
        connectionId: targetId,
        command: req.command,
        startedAt: meta.startedAt,
        status: 'running'
    })

    let abortSignal: AbortSignal | undefined
    try {
        abortSignal = mcpExecutionManager.register(callId, req.sessionId, targetId)
        const execResult = await executeIsolatedSshCommand(finalAuth.server, req.command, abortSignal)
        const status: 'success' | 'failed' = execResult.code === 0 ? 'success' : 'failed'

        completeToolCall(meta, {
            kind: 'executed',
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

        return { isError: false, text: resultText }
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        const cancelled = abortSignal?.aborted
        completeToolCall(meta, { kind: 'execution-error', status: cancelled ? 'cancelled' : 'failed', error: errorMsg })
        return fail(`SSH execution error: ${errorMsg}`)
    } finally {
        mcpExecutionManager.unregister(callId)
    }
}

/** Единый терминальный шаг: broadcast событий + закрытие timeline. Формат логов не меняется. */
function completeToolCall(meta: ToolExecutionMeta, completion: ToolCompletion): void {
    switch (completion.kind) {
        case 'executed':
        case 'execution-error':
            finishToolExecution(meta, {
                status: completion.status,
                error: completion.kind === 'execution-error' ? completion.error : undefined,
                stdout: completion.kind === 'executed' ? completion.stdout : undefined,
                stderr: completion.kind === 'executed' ? completion.stderr : undefined,
                exitCode: completion.kind === 'executed' ? completion.exitCode : undefined
            })
            break
        case 'blocked':
            broadcastMcpEvent('mcp-log', {
                ...meta.baseLog,
                id: meta.callId,
                timestamp: Date.now(),
                connectionId: meta.connectionId,
                command: meta.command,
                startedAt: Date.now(),
                status: 'failed',
                error: completion.error
            })
            timelineManager.finishToolCall(meta.runId, meta.callId, 'failed')
            break
        case 'denied':
            timelineManager.finishToolCall(meta.runId, meta.callId, 'cancelled')
            break
    }
}

function fail(text: string): ExecuteCommandResponse {
    return { isError: true, text }
}