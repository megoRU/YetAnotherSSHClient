import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mcpExecutionManager } from './execution-manager.js'
import { McpAgent } from './mcp-types.js'

const INACTIVITY_TIMEOUT_MS = 60 * 1000

class SessionManager {
    private sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer; lastSeen: number }>()
    private onSessionDisconnectCallback: ((sessionId: string) => void) | null = null
    private inactivityTimer: NodeJS.Timeout | null = null

    public setOnSessionDisconnect(cb: (sessionId: string) => void) {
        this.onSessionDisconnectCallback = cb
    }

    public addSession(sessionId: string, transport: StreamableHTTPServerTransport, server: McpServer): void {
        this.sessions.set(sessionId, { transport, server, lastSeen: Date.now() })
    }

    public updateActivity(sessionId: string | undefined): void {
        if (!sessionId) return
        const session = this.sessions.get(sessionId)
        if (session) {
            session.lastSeen = Date.now()
        }
    }

    public getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
        return this.sessions.get(sessionId)?.transport
    }

    public hasTransport(sessionId: string): boolean {
        return this.sessions.has(sessionId)
    }

    public removeSession(sessionId: string) {
        const session = this.sessions.get(sessionId)
        if (!session) return
        this.sessions.delete(sessionId)
        mcpExecutionManager.cancelBySessionId(sessionId)
        try { void session.server.close() } catch { /* close is best-effort during transport cleanup */ }
        if (this.onSessionDisconnectCallback) {
            this.onSessionDisconnectCallback(sessionId)
        }
    }

    public async clearAll() {
        this.stopInactivityTimer()
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

    public getConnectedAgents(): McpAgent[] {
        const agents: McpAgent[] = []
        for (const [sessionId, session] of this.sessions.entries()) {
            const clientVersion = session.server?.server?.getClientVersion?.()
            const rawName = clientVersion?.name?.trim() || 'MCP Agent'
            const name = rawName.replace(/\s*\(.*$/, '').trim() || 'MCP Agent'
            const version = clientVersion?.version?.trim() || undefined
            agents.push({
                id: sessionId,
                name,
                version,
                lastSeen: session.lastSeen
            })
        }
        return agents
    }

    private lastActiveAgentsHash = ''

    public checkInactivityStatus(onStatusChange: () => void) {
        const now = Date.now()

        for (const [sessionId, session] of Array.from(this.sessions.entries())) {
            if (now - session.lastSeen > INACTIVITY_TIMEOUT_MS) {
                this.removeSession(sessionId)
            }
        }

        const activeAgents = this.getConnectedAgents()
        const currentHash = activeAgents.map(a => `${a.id}:${a.name}:${a.version || ''}`).sort().join(',')
        if (currentHash !== this.lastActiveAgentsHash) {
            this.lastActiveAgentsHash = currentHash
            onStatusChange()
        }
    }

    public startInactivityTimer(onStatusChange: () => void) {
        this.stopInactivityTimer()
        this.lastActiveAgentsHash = ''
        this.inactivityTimer = setInterval(() => {
            this.checkInactivityStatus(onStatusChange)
        }, 5000)
    }

    public stopInactivityTimer() {
        if (this.inactivityTimer) {
            clearInterval(this.inactivityTimer)
            this.inactivityTimer = null
        }
        this.lastActiveAgentsHash = ''
    }
}

export const sessionManager = new SessionManager()
