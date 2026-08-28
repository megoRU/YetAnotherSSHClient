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

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'installing' | 'error';

export type SftpTransferStatus = 'active' | 'success' | 'error' | 'cancelled';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    isTyping?: boolean;
}

export interface Tab {
    id: string;
    type: 'home' | 'ssh' | 'settings' | 'connection' | 'sftp' | 'mcp';
    subType?: string;
    title: string;
    config?: SSHConfig;
    aiOpen?: boolean;
    aiMessages?: ChatMessage[];
    aiFocusTrigger?: number;
}

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

export type NotificationType = 'success' | 'error' | 'info';


export interface NotificationAction {
    label: string;
    onClick: () => void;
    cancelLabel?: string;
}

export const VERSION = '2.5.7';
