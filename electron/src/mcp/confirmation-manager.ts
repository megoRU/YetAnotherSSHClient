import { PendingConfirmation, McpConfirmationRequest, ConfirmationDecision, ConfirmationReason } from './mcp-types.js'
import { BrowserWindow } from 'electron'
import { McpStatus } from '../../../src/types.js'

let getMainWindowRef: (() => BrowserWindow | null) | null = null

export function setConfirmationMainWindowGetter(getter: () => BrowserWindow | null) {
    getMainWindowRef = getter
}

export function broadcastMcpEvent(event: string, payload: unknown) {
    if (!getMainWindowRef) return
    const win = getMainWindowRef()
    if (win && !win.isDestroyed()) {
        try {
            win.webContents.send(event, payload)
        } catch (err) {
            console.error(`[MCP] Failed to broadcast '${event}':`, err)
        }
    }
}

/**
 * Менеджер подтверждений — строго «ворота»: ожидание решения и его передача.
 * Он НЕ эмитит события mcp-log для lifecycle tool-вызова (pending/cancelled/final).
 * Финализация состояния tool-вызова — ответственность orchestration-слоя
 * (execute-command-service), который единственный закрывает timeline и
 * публикует терминальные логи. Здесь живёт только ожидание и decision.
 */
class ConfirmationManager {
    private pendingConfirmations = new Map<string, PendingConfirmation>()

    public createConfirmation(
        id: string,
        sessionId: string,
        connectionId: string,
        serverName: string,
        command: string,
        getMcpStatusFn: () => McpStatus
    ): Promise<ConfirmationDecision> {
        const CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

        return new Promise<ConfirmationDecision>((resolve) => {
            const timer = setTimeout(() => {
                this.handleResponse(id, false, 'timeout', undefined, getMcpStatusFn)
            }, CONFIRMATION_TIMEOUT_MS)

            this.pendingConfirmations.set(id, {
                id,
                sessionId,
                connectionId,
                serverName,
                command,
                timer,
                resolve
            })

            broadcastMcpEvent('mcp-status-changed', getMcpStatusFn())
            broadcastMcpEvent('mcp-request-confirmation', {
                id,
                connectionId,
                serverName,
                command,
                sessionId
            })
        })
    }

    public cancelById(id: string): void {
        if (this.pendingConfirmations.has(id)) {
            this.handleResponse(id, false, 'user')
        }
    }

    public handleResponse(
        id: string,
        approved: boolean,
        reason: ConfirmationReason = 'user',
        expectedSessionId?: string,
        getMcpStatusFn?: () => McpStatus
    ): boolean {
        const pending = this.pendingConfirmations.get(id)
        if (!pending) return false

        // Security check: If expectedSessionId is provided, confirm session matches
        if (expectedSessionId && pending.sessionId !== expectedSessionId) {
            console.warn(`[MCP] Session '${expectedSessionId}' attempted to approve confirmation '${id}' belonging to session '${pending.sessionId}'`)
            return false
        }

        clearTimeout(pending.timer)
        this.pendingConfirmations.delete(id)
        pending.resolve({ approved, reason })

        if (getMcpStatusFn) {
            broadcastMcpEvent('mcp-status-changed', getMcpStatusFn())
        }

        return true
    }

    public getPendingList(): McpConfirmationRequest[] {
        return Array.from(this.pendingConfirmations.values()).map(p => ({
            id: p.id,
            connectionId: p.connectionId,
            serverName: p.serverName,
            command: p.command,
            sessionId: p.sessionId
        }))
    }

    public revokeByServerId(serverId: string, getMcpStatusFn?: () => McpStatus) {
        for (const [id, pending] of Array.from(this.pendingConfirmations.entries())) {
            if (pending.connectionId === serverId) {
                this.handleResponse(id, false, 'revoked', undefined, getMcpStatusFn)
            }
        }
    }

    public revokeBySessionId(sessionId: string, getMcpStatusFn?: () => McpStatus) {
        for (const [id, pending] of Array.from(this.pendingConfirmations.entries())) {
            if (pending.sessionId === sessionId) {
                this.handleResponse(id, false, 'session_closed', undefined, getMcpStatusFn)
            }
        }
    }

    public revokeAll(reason: 'revoked' | 'session_closed' = 'revoked', getMcpStatusFn?: () => McpStatus) {
        for (const [id] of Array.from(this.pendingConfirmations.entries())) {
            this.handleResponse(id, false, reason, undefined, getMcpStatusFn)
        }
    }
}

export const confirmationManager = new ConfirmationManager()
