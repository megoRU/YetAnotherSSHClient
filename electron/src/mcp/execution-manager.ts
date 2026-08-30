class McpExecutionManager {
    private executions = new Map<string, { sessionId: string; connectionId: string; controller: AbortController }>()

    public register(id: string, sessionId: string, connectionId: string): AbortSignal {
        const controller = new AbortController()
        this.executions.set(id, { sessionId, connectionId, controller })
        return controller.signal
    }

    public unregister(id: string): void {
        this.executions.delete(id)
    }

    public cancelBySessionId(sessionId: string): void {
        this.cancelWhere(execution => execution.sessionId === sessionId)
    }

    public cancelByConnectionId(connectionId: string): void {
        this.cancelWhere(execution => execution.connectionId === connectionId)
    }

    public cancelAll(): void {
        this.cancelWhere(() => true)
    }

    private cancelWhere(predicate: (execution: { sessionId: string; connectionId: string; controller: AbortController }) => boolean): void {
        for (const [id, execution] of this.executions) {
            if (predicate(execution)) {
                execution.controller.abort()
                this.executions.delete(id)
            }
        }
    }
}

export const mcpExecutionManager = new McpExecutionManager()
