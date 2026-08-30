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

export type McpServerState = 'disabled' | 'starting' | 'running' | 'stopping' | 'failed'

export interface McpStatus {
    enabled: boolean
    running: boolean
    state: McpServerState
    port: number
    connectedAgents: number
    requireConfirmation: boolean
    allowedServerIds: string[]
    pendingConfirmations: McpConfirmationRequest[]
    error?: string
}

export interface McpConfirmationRequest {
    id: string;
    connectionId: string;
    serverName: string;
    command: string;
    sessionId?: string;
}
