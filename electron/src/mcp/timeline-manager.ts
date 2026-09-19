import * as crypto from 'node:crypto'
import { broadcastMcpEvent, confirmationManager } from './confirmation-manager.js'
import { mcpExecutionManager } from './execution-manager.js'

type RunFinalStatus = 'success' | 'failed' | 'cancelled'

interface McpTimelineRun {
    id: string
    connectionId: string
    sessionId: string
    startedAt: number
    openCalls: number
    callIds: Set<string>
    sawError: boolean
    cancelRequested: boolean
    closed: boolean
}

class McpTimelineManager {
    private runs = new Map<string, McpTimelineRun>()

    public beginToolCall(
        sessionId: string,
        connectionId: string,
        toolName: string
    ): { runId: string; callId: string } {
        const now = Date.now()
        const runId = crypto.randomUUID()
        const run: McpTimelineRun = {
            id: runId,
            connectionId,
            sessionId,
            startedAt: now,
            openCalls: 0,
            callIds: new Set(),
            sawError: false,
            cancelRequested: false,
            closed: false
        }
        this.runs.set(runId, run)
        broadcastMcpEvent('mcp-log', {
            id: runId,
            timestamp: now,
            connectionId,
            action: 'run',
            kind: 'start',
            status: 'running',
            runId,
            toolName,
            startedAt: now
        })

        run.openCalls += 1
        const callId = crypto.randomUUID()
        run.callIds.add(callId)
        return { runId: run.id, callId }
    }

    public finishToolCall(runId: string, callId: string, status: RunFinalStatus): void {
        const run = this.runs.get(runId)
        if (!run || run.closed) return

        run.openCalls = Math.max(0, run.openCalls - 1)
        run.callIds.delete(callId)

        if (status === 'failed') run.sawError = true
        if (status === 'cancelled') run.cancelRequested = true

        if (run.openCalls === 0) {
            const finalStatus = run.cancelRequested ? 'cancelled' : run.sawError ? 'failed' : 'success'
            this.closeRun(run, finalStatus)
        }
    }

    public cancelRun(runId: string): boolean {
        const run = this.runs.get(runId)
        if (!run || run.closed) return false

        run.cancelRequested = true
        if (run.openCalls === 0) {
            this.closeRun(run, 'cancelled')
            return true
        }

        for (const callId of Array.from(run.callIds)) {
            confirmationManager.cancelById(callId)
            mcpExecutionManager.cancelById(callId)
        }
        return true
    }

    public cancelByConnectionId(connectionId: string): void {
        for (const runId of Array.from(this.runs.keys())) {
            const run = this.runs.get(runId)
            if (run && run.connectionId === connectionId) {
                this.cancelRun(runId)
            }
        }
    }

    public cancelBySessionId(sessionId: string): void {
        for (const runId of Array.from(this.runs.keys())) {
            const run = this.runs.get(runId)
            if (run && run.sessionId === sessionId) {
                this.cancelRun(runId)
            }
        }
    }

    public cancelAll(): void {
        for (const runId of Array.from(this.runs.keys())) {
            this.cancelRun(runId)
        }
    }

    private closeRun(run: McpTimelineRun, status: RunFinalStatus): void {
        if (run.closed) return
        run.closed = true
        this.runs.delete(run.id)

        const now = Date.now()
        broadcastMcpEvent('mcp-log', {
            id: crypto.randomUUID(),
            timestamp: now,
            connectionId: run.connectionId,
            action: 'run',
            kind: 'end',
            status,
            runId: run.id,
            startedAt: run.startedAt,
            durationMs: now - run.startedAt
        })
    }
}

export const timelineManager = new McpTimelineManager()
