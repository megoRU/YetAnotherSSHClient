/**
 * Конфигурация SSH-сервера
 */
export interface SSHConfig {
    id?: string
    name: string
    user: string
    host: string
    port: number
    password?: string
    authType?: 'password' | 'key'
    privateKeyPath?: string
    osPrettyName?: string
    initialCommands?: string
}

/**
 * Данные шифрования
 */
export interface EncryptionInfo {
    version: number;
    salt: string;
}

/**
 * Зашифрованный секрет
 */
export interface EncryptedSecret {
    iv: string;
    tag: string;
    data: string;
}

/**
 * Основная конфигурация приложения
 */
export interface AppConfig {
    encryption?: EncryptionInfo;
    encryptedPasswords?: Record<string, EncryptedSecret>;
    cachedRecoveryKey?: string; // Локальный кэш зашифрованного ключа (через safeStorage)
    hasAcknowledgedRecoveryKey?: boolean;
    terminalFontName: string
    terminalFontSize: number
    uiFontName: string
    uiFontSize: number
    theme: string
    language: 'ru' | 'en'
    x: number
    y: number
    width: number
    height: number
    maximized: boolean
    lastUpdateCheck?: number
    enableTerminalContextMenu: boolean
    terminalScrollSensitivity: number
    keywordHighlighting: boolean
    sftpSoundEnabled: boolean
    sftpSoundVolume: number
    sftpFlashIcon: boolean
    activeTabColorEnabled: boolean
    alwaysShowHoverOnInactiveTabs: boolean
    serverCardSize: 'standard' | 'compact'
    isOnboardingCompleted: boolean
    sidebarEnabled: boolean
    sidebarPosition: 'left' | 'right'
    knownHosts?: Record<string, string>
    favorites: SSHConfig[]
}

/**
 * Данные для SSH-подключения, передаваемые через IPC
 */
export interface SshConnectPayload {
    id: string
    config: SSHConfig
    cols?: number
    rows?: number
}

/**
 * Данные для SFTP-подключения
 */
export interface SftpConnectPayload {
    id: string;
    config: SSHConfig;
}

/**
 * Описание файла или директории в SFTP
 */
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

/**
 * Данные о прогрессе передачи SFTP
 */
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
