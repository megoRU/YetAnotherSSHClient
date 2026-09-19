export interface SSHConfig {
    id?: string;
    name: string;
    user: string;
    host: string;
    port: number;
    password?: string;
    authType?: 'password' | 'key';
    privateKeyPath?: string;
    osPrettyName?: string;
    initialCommands?: string;
}

export interface EncryptionInfo {
    version: number;
    salt: string;
    check?: EncryptedSecret;
}

export interface EncryptedSecret {
    iv: string;
    tag: string;
    data: string;
}

export interface AppConfig {
    encryption?: EncryptionInfo;
    encryptedPasswords?: Record<string, EncryptedSecret>;
    cachedRecoveryKey?: string;
    hasAcknowledgedRecoveryKey?: boolean;
    terminalFontName: string;
    terminalFontSize: number;
    uiFontName: string;
    uiFontSize: number;
    theme: string;
    language: 'ru' | 'en';
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
    lastUpdateCheck?: number;
    enableTerminalContextMenu: boolean;
    terminalScrollSensitivity: number;
    keywordHighlighting: boolean;
    sftpSoundEnabled: boolean;
    sftpSoundVolume: number;
    sftpFlashIcon: boolean;
    activeTabColorEnabled: boolean;
    alwaysShowHoverOnInactiveTabs: boolean;
    serverCardSize: 'standard' | 'compact' | 'medium';
    isOnboardingCompleted: boolean;
    sidebarEnabled: boolean;
    sidebarPosition: 'left' | 'right';
    fileAssociations: Record<string, string>;
    mcpEnabled: boolean;
    mcpPort: number;
    mcpToken: string;
    mcpRequireConfirmation: boolean;
    mcpAllowedServerIds: string[];
    favorites: SSHConfig[];
    licenseKey?: string;
    licenseExpiresAt?: number;
}

export * from './types/sftp.js';

export interface UpdateInfo {
    version: string;
    url?: string;
    releaseNotes?: string;
}

export interface UpdateProgress {
    bytesPerSecond: number;
    percent: number;
    total: number;
    transferred: number;
}

export interface SshConnectPayload {
    id: string;
    config: SSHConfig;
    cols?: number;
    rows?: number;
}

export interface LocalTerminalStartPayload {
    id: string;
    cols?: number;
    rows?: number;
}

/** Результат handshake создания локального PTY (ipcMain.handle / ipcRenderer.invoke) */
export type LocalTerminalStartResult =
    | { ok: true; pid: number }
    | { ok: false; error: string };

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'installing' | 'error';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    isTyping?: boolean;
}

export interface Tab {
    id: string;
    type: 'home' | 'ssh' | 'settings' | 'connection' | 'sftp' | 'mcp' | 'local-terminal';
    subType?: string;
    title: string;
    config?: SSHConfig;
    aiOpen?: boolean;
    aiMessages?: ChatMessage[];
    aiFocusTrigger?: number;
}

export type NotificationType = 'success' | 'error' | 'info' | 'warning';


export interface NotificationAction {
    label: string;
    onClick: () => void;
    cancelLabel?: string;
}

export type McpServerState = 'disabled' | 'starting' | 'running' | 'stopping' | 'failed';

export interface McpConfirmationRequest {
    id: string;
    connectionId: string;
    serverName: string;
    command: string;
    sessionId?: string;
}

export interface McpAgent {
    id: string;
    name: string;
    version?: string;
    lastSeen: number;
}

export interface McpStatus {
    enabled: boolean;
    running: boolean;
    state?: McpServerState;
    port: number;
    connectedAgents: number;
    agents?: McpAgent[];
    requireConfirmation: boolean;
    allowedServerIds: string[];
    pendingConfirmations?: McpConfirmationRequest[];
    error?: string;
}

export type McpLogKind = 'start' | 'tool_call' | 'tool_result' | 'end' | 'analysis' | 'info';

export type McpLogStatus = 'pending' | 'approved' | 'rejected' | 'running' | 'success' | 'failed' | 'cancelled';

export interface McpLogItem {
    id: string;
    timestamp: number;
    connectionId: string;
    action: string;
    kind?: McpLogKind;
    runId?: string;
    toolName?: string;
    args?: unknown;
    result?: string;
    startedAt?: number;
    durationMs?: number;
    command?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    error?: string;
    status: McpLogStatus;
}

export const VERSION = '3.0.2';
