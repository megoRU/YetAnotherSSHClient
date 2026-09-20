import type { McpStatus, McpToolCallLog } from '../../../src/types.js'
import { loadConfig } from '../config.js'
import { t } from '../i18n-main.js'
import { broadcastMcpEvent, confirmationManager } from './confirmation-manager.js'
import type { ConfirmationReason } from './mcp-types.js'
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

/** Терминальные состояния tool-вызова. Все проходят через `finishToolExecution`. */
type ToolCompletion =
    | { kind: 'executed'; status: 'success' | 'failed'; stdout?: string; stderr?: string; exitCode?: number | null }
    | { kind: 'execution-error'; status: 'failed' | 'cancelled'; error: string }
    | { kind: 'blocked'; error: string }
    | { kind: 'denied'; reason: ConfirmationReason }

const DENIED_MESSAGES: Record<ConfirmationReason, string> = {
    user: t('mcp.executionCancelled'),
    timeout: t('mcp.timeoutError'),
    revoked: t('mcp.revokedError'),
    session_closed: t('mcp.sessionClosedError'),
    server_deleted: t('mcp.serverDeletedError')
}

/**
 * Единая схема lifecycle:
 *   beginToolCall → confirmation (pending) → authorization recheck → running → execution → final result.
 * Все терминальные состояния tool-вызова (success/failed/cancelled/denied/blocked) завершаются
 * через `completeToolCall` → `finishToolExecution`: одна точка broadcast + закрытия timeline.
 * confirmation-manager здесь только принимает решение (approved/denied), лог-события он не шлёт.
 */
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

    // startedAt заполняется только перед фактическим запуском SSH-команды:
    // время ожидания confirmation в durationMs не попадает.
    const meta: ToolExecutionMeta = {
        runId,
        callId,
        sessionId: req.sessionId,
        connectionId: targetId,
        toolName: EXECUTE_COMMAND_TOOL_NAME,
        command: req.command,
        baseLog: toolMeta
    }

    // Confirmation gate: manager только ждёт/принимает решение, логи гейта шлёт service.
    if (config.mcpRequireConfirmation) {
        broadcastMcpEvent('mcp-log', {
            ...toolMeta,
            id: callId,
            timestamp: Date.now(),
            connectionId: targetId,
            action: EXECUTE_COMMAND_TOOL_NAME,
            command: req.command,
            status: 'pending'
        })

        const decision = await confirmationManager.createConfirmation(
            callId,
            req.sessionId,
            targetId,
            serverName,
            req.command,
            getMcpStatusFn
        )

        if (!decision.approved) {
            completeToolCall(meta, { kind: 'denied', reason: decision.reason })
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

/** Единственный терминальный шаг: broadcast tool_call + tool_result + закрытие timeline. */
function completeToolCall(meta: ToolExecutionMeta, completion: ToolCompletion): void {
    switch (completion.kind) {
        case 'executed':
            finishToolExecution(meta, {
                status: completion.status,
                stdout: completion.stdout,
                stderr: completion.stderr,
                exitCode: completion.exitCode
            })
            break
        case 'execution-error':
            finishToolExecution(meta, {
                status: completion.status,
                error: completion.error
            })
            break
        case 'blocked':
            finishToolExecution(meta, {
                status: 'failed',
                error: completion.error
            })
            break
        case 'denied':
            finishToolExecution(meta, {
                status: 'cancelled',
                error: DENIED_MESSAGES[completion.reason]
            })
            break
    }
}

function fail(text: string): ExecuteCommandResponse {
    return { isError: true, text }
}