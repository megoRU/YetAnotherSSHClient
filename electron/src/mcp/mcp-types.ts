import type {
    McpAgent,
    McpConfirmationRequest,
    McpStatus,
    McpServerState
} from '../../../src/types.js'

export type {
    McpAgent,
    McpConfirmationRequest,
    McpStatus,
    McpServerState
}

export interface PendingConfirmation {
    id: string
    sessionId: string
    connectionId: string
    serverName: string
    command: string
    timer: NodeJS.Timeout
    resolve: (approved: boolean) => void
    rejectedReason?: string
}
