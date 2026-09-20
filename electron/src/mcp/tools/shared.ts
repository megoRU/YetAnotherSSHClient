import * as crypto from 'node:crypto'
import type { McpToolCallLog } from '../../../../src/types.js'
import { broadcastMcpEvent } from '../confirmation-manager.js'
import { timelineManager } from '../timeline-manager.js'

export type ToolFinalStatus = 'success' | 'failed' | 'cancelled'

/** Метаданные выполняемого tool-вызова (общая «шапка» логов). */
export interface ToolExecutionMeta {
    runId: string
    callId: string
    sessionId: string
    connectionId: string
    toolName: string
    command: string
    baseLog: Partial<McpToolCallLog>
    /** Фактическое начало выполнения (SSH-команды). undefined — команда не выполнялась. */
    startedAt?: number
}

export interface ToolExecutionResult {
    status: ToolFinalStatus
    error?: string
    stdout?: string
    stderr?: string
    exitCode?: number | null
    durationMs?: number
}

/** Единая точка завершения tool-вызова: состояние вызова + tool_result + timeline. */
export function finishToolExecution(meta: ToolExecutionMeta, result: ToolExecutionResult): void {
    const { runId, callId, connectionId, toolName, command, baseLog, startedAt } = meta
    const now = Date.now()
    const durationMs = result.durationMs ?? (startedAt !== undefined ? now - startedAt : undefined)

    broadcastMcpEvent('mcp-log', {
        ...baseLog,
        id: callId,
        timestamp: now,
        connectionId,
        command,
        startedAt,
        durationMs,
        status: result.status,
        error: result.error
    })

    broadcastMcpEvent('mcp-log', {
        id: crypto.randomUUID(),
        timestamp: now,
        connectionId,
        action: toolName,
        kind: 'tool_result',
        runId,
        toolName,
        command,
        startedAt,
        durationMs,
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        error: result.error
    })

    timelineManager.finishToolCall(runId, callId, result.status)
}
