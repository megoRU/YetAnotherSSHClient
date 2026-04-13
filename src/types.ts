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

export interface AppConfig {
    terminalFontName: string;
    terminalFontSize: number;
    uiFontName: string;
    uiFontSize: number;
    theme: string;
    favorites: SSHConfig[];
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
    lastUpdateCheck?: number;
    allowLegacyAlgorithms?: boolean;
    enableTerminalContextMenu: boolean;
}

export interface SshConnectPayload {
    id: string;
    config: SSHConfig;
    cols?: number;
    rows?: number;
}

export interface SftpConnectPayload {
    id: string;
    config: SSHConfig;
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
}

export interface SftpProgress {
    remotePath: string;
    progress: number;
    transferred?: number;
    total?: number;
    type: 'upload' | 'download';
}

export type SftpTransferStatus = 'active' | 'success' | 'error' | 'cancelled';

export interface Tab {
    id: string;
    type: 'home' | 'ssh' | 'settings' | 'connection' | 'about' | 'sftp';
    title: string;
    config?: SSHConfig;
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
}
export const VERSION = '1.2.9';
