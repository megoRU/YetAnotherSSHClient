import type { McpConfirmationRequest, McpLogItem, McpStatus } from '../types.js'

export type { McpConfirmationRequest, McpLogItem, McpStatus }

export interface McpConfirmCommandPayload {
    id: string;
    approved: boolean;
}