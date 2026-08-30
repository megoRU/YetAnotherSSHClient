import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

class SessionManager {
    private transports = new Map<string, StreamableHTTPServerTransport>()
    private onSessionDisconnectCallback: ((sessionId: string) => void) | null = null

    public setOnSessionDisconnect(cb: (sessionId: string) => void) {
        this.onSessionDisconnectCallback = cb
    }

    public addTransport(sessionId: string, transport: StreamableHTTPServerTransport) {
        this.transports.set(sessionId, transport)
        transport.onclose = () => {
            if (this.transports.has(sessionId)) {
                this.transports.delete(sessionId)
                if (this.onSessionDisconnectCallback) {
                    this.onSessionDisconnectCallback(sessionId)
                }
            }
        }
    }

    public getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
        return this.transports.get(sessionId)
    }

    public hasTransport(sessionId: string): boolean {
        return this.transports.has(sessionId)
    }

    public removeTransport(sessionId: string) {
        const transport = this.transports.get(sessionId)
        if (transport) {
            try { void transport.close() } catch { /* ignore */ }
            this.transports.delete(sessionId)
        }
    }

    public async clearAll() {
        for (const [sessionId, transport] of this.transports) {
            try { await transport.close() } catch { /* ignore */ }
            if (this.onSessionDisconnectCallback) {
                this.onSessionDisconnectCallback(sessionId)
            }
        }
        this.transports.clear()
    }

    public get connectedCount(): number {
        return this.transports.size
    }
}

export const sessionManager = new SessionManager()
