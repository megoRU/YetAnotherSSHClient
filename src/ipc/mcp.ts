import type { McpConfirmationRequest, McpLogItem, McpStatus } from '../types.js'

export type { McpConfirmationRequest, McpLogItem, McpStatus }

export interface McpConfirmCommandPayload {
    id: string;
    approved: boolean;
}

export interface McpTerminalReadRequest {
    requestId: string;
    terminalId: string;
    mode: 'screen' | 'history';
    maxLines: number;
}

export interface McpTerminalSnapshot {
    text: string;
    cols: number;
    rows: number;
    truncated: boolean;
}
