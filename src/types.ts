export interface SSHConfig {
    id?: string;
    name: string;
    user: string;
    host: string;
    port: number;
    password?: string;
    authType?: 'password' | 'key';
    privateKey?: EncryptedSecret;
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
    clientId: string;
    favorites: SSHConfig[];
    licenseKey?: string;
    licenseExpiresAt?: number;
}

export interface SftpFileEntry {
    filename: string;
    longname: string;
    attrs: {
        mode: number;
        uid: number;
        gid: number;
        size: number;
        atime: number;
        mtime: number;
    };
    targetAttrs?: SftpFileEntry['attrs'];
}

export interface SftpProgress {
    id: string;
    remotePath: string;
    progress: number;
    transferred?: number;
    total?: number;
    type: 'upload' | 'download';
}

export interface SftpConnectPayload {
    id: string;
    config: SSHConfig;
}

export interface SftpDownloadResult {
    remotePath: string;
    localPath?: string;
    isDir?: boolean;
    size?: number;
}

export interface SftpUploadResult {
    remotePath: string;
    isDir?: boolean;
    items?: SftpUploadResult[];
    cancelled?: boolean;
    size?: number;
}

export type SftpTransferStatus = 'active' | 'success' | 'error' | 'cancelled';

export interface Transfer {
    id: string;
    filename: string;
    remotePath: string;
    progress: number;
    size?: number;
    type: 'upload' | 'download';
    status: SftpTransferStatus;
    error?: string;
    isDir?: boolean;
}

export interface PendingFileUpdate {
    localPath: string;
    remotePath: string;
    filename: string;
    selected: boolean;
    isDir?: boolean;
}

/** Кандидат на загрузку (файл или папка) с заранее сгенерированным transferId. */
export interface UploadCandidate {
    localPath: string;
    filename: string;
    remotePath: string;
    transferId: string;
    size: number;
    isDir?: boolean;
}

/** Опции выполнения загрузки, сохраняющие поведение конкретного источника (кнопка / drag&drop). */
export interface StartUploadOptions {
    pendingDeletesOnError?: boolean;
    showErrorModal?: boolean;
}

/** Контекст загрузки, ожидающей подтверждения перезаписи (окно overwriteConfirm). */
export interface PendingUploadContext {
    items: UploadCandidate[];
    options: StartUploadOptions;
}

/** Структурированные статусы SFTP-соединения (без привязки к локали). */
export type SftpStatusKind = 'ready' | 'connection-ended' | 'connection-closed';

/** Структурированные коды ошибок SFTP-соединения (без привязки к локали). */
export type SftpErrorKind = 'auth-failure' | 'tcp-timeout' | 'socket-error' | 'ssh-error' | 'config-error';

/** Событие статуса SFTP-соединения от main-процесса. */
export interface SftpStatusEvent {
    kind: SftpStatusKind;
    message?: string;
}

/** Событие ошибки SFTP-соединения от main-процесса. */
export interface SftpErrorEvent {
    kind: SftpErrorKind;
    message?: string;
}

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

export interface Tab {
    id: string;
    type: 'home' | 'ssh' | 'settings' | 'connection' | 'sftp' | 'mcp' | 'local-terminal';
    subType?: string;
    title: string;
    config?: SSHConfig;
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

export type McpLogStatus = 'pending' | 'approved' | 'rejected' | 'running' | 'success' | 'failed' | 'cancelled';

/**
 * Базовые поля, присутствующие в любом событии MCP-таймлайна.
 * Дискриминант `kind` определяет, какие поля доступны дальше.
 */
export interface McpLogItemBase {
    id: string;
    timestamp: number;
    connectionId: string;
    action: string;
    runId?: string;
    status: McpLogStatus;
}

/** Начало агентского запуска (run). */
export interface McpRunStartLog extends McpLogItemBase {
    kind: 'start';
    toolName?: string;
    startedAt: number;
}

/** Вызов инструмента: ожидание подтверждения или выполнение. */
export interface McpToolCallLog extends McpLogItemBase {
    kind: 'tool_call';
    toolName?: string;
    command?: string;
    args?: unknown;
    startedAt?: number;
    error?: string;
}

/** Итоговый результат выполнения инструмента. */
export interface McpToolResultLog extends McpLogItemBase {
    kind: 'tool_result';
    toolName?: string;
    command?: string;
    startedAt?: number;
    durationMs?: number;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    error?: string;
}

/** Завершение агентского запуска (run). */
export interface McpRunEndLog extends McpLogItemBase {
    kind: 'end';
    startedAt: number;
    durationMs: number;
}

export type McpLogItem = McpRunStartLog | McpToolCallLog | McpToolResultLog | McpRunEndLog;

export const VERSION = '3.1.3';