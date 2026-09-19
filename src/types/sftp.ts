import type { SSHConfig } from '../types.js';

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
}
