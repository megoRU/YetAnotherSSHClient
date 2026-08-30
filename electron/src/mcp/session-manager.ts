import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mcpExecutionManager } from './execution-manager.js'

class SessionManager {
    private sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>()
    private onSessionDisconnectCallback: ((sessionId: string) => void) | null = null

    public setOnSessionDisconnect(cb: (sessionId: string) => void) {
        this.onSessionDisconnectCallback = cb
    }

    public addSession(sessionId: string, transport: StreamableHTTPServerTransport, server: McpServer): void {
        this.sessions.set(sessionId, { transport, server })
    }

    public getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
        return this.sessions.get(sessionId)?.transport
    }

    public hasTransport(sessionId: string): boolean {
        return this.sessions.has(sessionId)
    }

    public removeSession(sessionId: string) {
        const session = this.sessions.get(sessionId)
        this.sessions.delete(sessionId)
        mcpExecutionManager.cancelBySessionId(sessionId)
        if (session) {
            try { void session.server.close() } catch { /* close is best-effort during transport cleanup */ }
        }
        if (this.onSessionDisconnectCallback) {
            this.onSessionDisconnectCallback(sessionId)
        }
    }

    public async clearAll() {
        const sessions = Array.from(this.sessions.entries())
        this.sessions.clear()
        for (const [sessionId, session] of sessions) {
            mcpExecutionManager.cancelBySessionId(sessionId)
            try { await session.server.close() } catch { /* close is best-effort during shutdown */ }
            if (this.onSessionDisconnectCallback) {
                this.onSessionDisconnectCallback(sessionId)
            }
        }
    }

    public get connectedCount(): number {
        return this.sessions.size
    }
}

export const sessionManager = new SessionManager()
