import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

class SessionManager {
    private transports = new Map<string, StreamableHTTPServerTransport>()
    private onSessionDisconnectCallback: ((sessionId: string) => void) | null = null

    public setOnSessionDisconnect(cb: (sessionId: string) => void) {
        this.onSessionDisconnectCallback = cb
    }

    public addSession(sessionId: string, transport: StreamableHTTPServerTransport) {
        this.transports.set(sessionId, transport)
    }

    public getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
        return this.transports.get(sessionId)
    }

    public hasTransport(sessionId: string): boolean {
        return this.transports.has(sessionId)
    }

    public removeSession(sessionId: string) {
        const transport = this.transports.get(sessionId)
        this.transports.delete(sessionId)
        if (transport) {
            try { void transport.close() } catch { /* ignore */ }
        }
        if (this.onSessionDisconnectCallback) {
            this.onSessionDisconnectCallback(sessionId)
        }
    }

    public async clearAll() {
        const sessions = Array.from(this.transports.entries())
        this.transports.clear()
        for (const [sessionId, transport] of sessions) {
            try { await transport.close() } catch { /* ignore */ }
            if (this.onSessionDisconnectCallback) {
                this.onSessionDisconnectCallback(sessionId)
            }
        }
    }

    public get connectedCount(): number {
        return this.transports.size
    }
}

export const sessionManager = new SessionManager()
