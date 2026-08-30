import * as http from 'node:http'

export interface SseSession {
    id: string
    res: http.ServerResponse
    req: http.IncomingMessage
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

export interface JsonRpcRequest {
    jsonrpc?: string
    id?: string | number | null
    method?: string
    params?: Record<string, unknown>
}

export interface JsonRpcResponse {
    jsonrpc: '2.0'
    id: string | number | null
    result?: unknown
    error?: {
        code: number
        message: string
        data?: unknown
    }
}
