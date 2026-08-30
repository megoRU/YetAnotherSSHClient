import { SseSession } from './mcp-types.js'

class SessionManager {
    private sessions = new Map<string, SseSession>()
    private onSessionDisconnectCallback: ((sessionId: string) => void) | null = null

    public setOnSessionDisconnect(cb: (sessionId: string) => void) {
        this.onSessionDisconnectCallback = cb
    }

    public addSession(sessionId: string, session: SseSession) {
        this.sessions.set(sessionId, session)
        session.req.on('close', () => {
            if (this.sessions.has(sessionId)) {
                this.sessions.delete(sessionId)
                if (this.onSessionDisconnectCallback) {
                    this.onSessionDisconnectCallback(sessionId)
                }
            }
        })
    }

    public getSession(sessionId: string): SseSession | undefined {
        return this.sessions.get(sessionId)
    }

    public hasSession(sessionId: string): boolean {
        return this.sessions.has(sessionId)
    }

    public removeSession(sessionId: string) {
        const session = this.sessions.get(sessionId)
        if (session) {
            try { session.res.end() } catch { /* ignore */ }
            this.sessions.delete(sessionId)
        }
    }

    public clearAllSessions() {
        for (const [, session] of this.sessions) {
            try { session.res.end() } catch { /* ignore */ }
        }
        this.sessions.clear()
    }

    public get connectedCount(): number {
        return this.sessions.size
    }

    public sendSseMessage(sessionId: string, data: unknown): boolean {
        const session = this.sessions.get(sessionId)
        if (!session || session.res.writableEnded) {
            return false
        }
        session.res.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`)
        return true
    }
}

export const sessionManager = new SessionManager()
