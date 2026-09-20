import type {
    McpAgent,
    McpConfirmationRequest,
    McpLogItem,
    McpStatus,
    McpServerState
} from '../../../src/types.js'

export type {
    McpAgent,
    McpConfirmationRequest,
    McpLogItem,
    McpStatus,
    McpServerState
}

/** Причина отклонения (не-approve) подтверждения. */
export type ConfirmationReason = 'user' | 'timeout' | 'revoked' | 'session_closed' | 'server_deleted'

/** Результат ожидания подтверждения: решение + причина для сообщения об ошибке. */
export interface ConfirmationDecision {
    approved: boolean
    reason: ConfirmationReason
}

export interface PendingConfirmation {
    id: string
    sessionId: string
    connectionId: string
    serverName: string
    command: string
    timer: NodeJS.Timeout
    resolve: (decision: ConfirmationDecision) => void
}
