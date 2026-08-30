import { PendingConfirmation, McpConfirmationRequest } from './mcp-types.js'
import { loadConfig } from '../config.js'
import { BrowserWindow } from 'electron'
import { McpLogItem } from '../types.js'

let getMainWindowRef: (() => BrowserWindow | null) | null = null

export function setConfirmationMainWindowGetter(getter: () => BrowserWindow | null) {
    getMainWindowRef = getter
}

export function broadcastMcpEvent(event: string, payload: unknown) {
    if (!getMainWindowRef) return
    const win = getMainWindowRef()
    if (win && !win.isDestroyed()) {
        win.webContents.send(event, payload)
    }
}

class ConfirmationManager {
    private pendingConfirmations = new Map<string, PendingConfirmation>()
    private approvedConfirmations = new Map<string, { sessionId: string; connectionId: string }>()

    public createConfirmation(
        id: string,
        sessionId: string,
        connectionId: string,
        serverName: string,
        command: string,
        getMcpStatusFn: () => unknown
    ): Promise<boolean> {
        const CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

        return new Promise<boolean>((resolve) => {
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

            const pendingEvent: McpLogItem = {
                id,
                timestamp: Date.now(),
                connectionId,
                action: 'execute_command',
                command,
                status: 'pending'
            }
            broadcastMcpEvent('mcp-log', pendingEvent)
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

    public handleResponse(
        id: string,
        approved: boolean,
        reason: 'user' | 'timeout' | 'revoked' | 'session_closed' | 'server_deleted' = 'user',
        expectedSessionId?: string,
        getMcpStatusFn?: () => unknown
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
        if (approved) {
            this.approvedConfirmations.set(id, {
                sessionId: pending.sessionId,
                connectionId: pending.connectionId
            })
        }
        pending.resolve(approved)

        if (getMcpStatusFn) {
            broadcastMcpEvent('mcp-status-changed', getMcpStatusFn())
        }

        if (!approved) {
            const config = loadConfig()
            let errorMsg = ''
            if (reason === 'timeout') {
                errorMsg = config.language === 'ru' ? 'Превышено время ожидания подтверждения (5 минут)' : 'Command approval timed out (5 minutes)'
            } else if (reason === 'revoked') {
                errorMsg = config.language === 'ru' ? 'Доступ к серверу был отозван' : 'Server access was revoked'
            } else if (reason === 'session_closed') {
                errorMsg = config.language === 'ru' ? 'MCP сессия была закрыта' : 'MCP session was closed'
            } else if (reason === 'server_deleted') {
                errorMsg = config.language === 'ru' ? 'Сервер был удален' : 'Server was deleted'
            } else {
                errorMsg = config.language === 'ru' ? 'Выполнение отменено пользователем' : 'Execution cancelled by user'
            }

            const rejectEvent: McpLogItem = {
                id,
                timestamp: Date.now(),
                connectionId: pending.connectionId,
                action: 'execute_command',
                command: pending.command,
                status: 'rejected',
                error: errorMsg
            }
            broadcastMcpEvent('mcp-log', rejectEvent)
        }

        return true
    }

    public consumeApproved(id: string, expectedSessionId?: string, expectedConnectionId?: string): boolean {
        const approved = this.approvedConfirmations.get(id)
        if (!approved) return false
        if (expectedSessionId && approved.sessionId !== expectedSessionId) return false
        if (expectedConnectionId && approved.connectionId !== expectedConnectionId) return false
        this.approvedConfirmations.delete(id)
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

    public revokeByServerId(serverId: string, getMcpStatusFn?: () => unknown) {
        for (const [id, approved] of this.approvedConfirmations) {
            if (approved.connectionId === serverId) this.approvedConfirmations.delete(id)
        }
        for (const [id, pending] of Array.from(this.pendingConfirmations.entries())) {
            if (pending.connectionId === serverId) {
                this.handleResponse(id, false, 'revoked', undefined, getMcpStatusFn)
            }
        }
    }

    public revokeBySessionId(sessionId: string, getMcpStatusFn?: () => unknown) {
        for (const [id, approved] of this.approvedConfirmations) {
            if (approved.sessionId === sessionId) this.approvedConfirmations.delete(id)
        }
        for (const [id, pending] of Array.from(this.pendingConfirmations.entries())) {
            if (pending.sessionId === sessionId) {
                this.handleResponse(id, false, 'session_closed', undefined, getMcpStatusFn)
            }
        }
    }

    public revokeAll(reason: 'revoked' | 'session_closed' = 'revoked', getMcpStatusFn?: () => unknown) {
        this.approvedConfirmations.clear()
        for (const [id] of Array.from(this.pendingConfirmations.entries())) {
            this.handleResponse(id, false, reason, undefined, getMcpStatusFn)
        }
    }
}

export const confirmationManager = new ConfirmationManager()
