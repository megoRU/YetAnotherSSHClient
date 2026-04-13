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
 * Основная конфигурация приложения
 */
export interface AppConfig {
    terminalFontName: string
    terminalFontSize: number
    uiFontName: string
    uiFontSize: number
    theme: string
    favorites: SSHConfig[]
    x: number
    y: number
    width: number
    height: number
    maximized: boolean
    lastUpdateCheck?: number
    allowLegacyAlgorithms?: boolean
    enableTerminalContextMenu: boolean
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
}

/**
 * Данные о прогрессе передачи SFTP
 */
export interface SftpProgress {
    remotePath: string;
    progress: number;
    transferred?: number;
    total?: number;
    type: 'upload' | 'download';
}

/**
 * Состояние передачи SFTP
 */
export type SftpTransferStatus = 'active' | 'success' | 'error' | 'cancelled';

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
