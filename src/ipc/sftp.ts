import type {
    SftpConnectPayload,
    SftpDownloadResult,
    SftpFileEntry,
    SftpProgress,
    SftpUploadResult
} from '../types.js'

export type {
    SftpConnectPayload,
    SftpDownloadResult,
    SftpFileEntry,
    SftpProgress,
    SftpUploadResult
}

export interface SftpMkdirRequest {
    id: string;
    path: string;
}

export interface SftpRmRequest {
    id: string;
    path: string;
    isDir: boolean;
}

export interface SftpRenameRequest {
    id: string;
    oldPath: string;
    newPath: string;
}

export interface SftpChmodRequest {
    id: string;
    path: string;
    mode: number | string;
}

export interface SftpRealpathRequest {
    id: string;
    path: string;
}

export interface SftpExtractRequest {
    id: string;
    remotePath: string;
}

export interface SftpReaddirRequest {
    id: string;
    path: string;
}

export interface SftpDownloadFileRequest {
    id: string;
    remotePath: string;
    filename: string;
    transferId: string;
}

export interface SftpDownloadMultipleFile {
    remotePath: string;
    filename: string;
    transferId: string;
    isDir?: boolean;
}

export interface SftpDownloadMultipleRequest {
    id: string;
    files: SftpDownloadMultipleFile[];
}

export interface SftpUploadFromPath {
    localPath: string;
    transferId: string;
}

export interface SftpUploadFilesFromPathsRequest {
    id: string;
    remoteDir: string;
    transfers: SftpUploadFromPath[];
}

export interface SftpUploadDirectRequest {
    id: string;
    localPath: string;
    remotePath: string;
    transferId?: string;
}

export interface SftpCancelUploadRequest {
    id: string;
    remotePath?: string;
    transferId?: string;
}

export interface SftpOpenInEditorRequest {
    id: string;
    remotePath: string;
    filename: string;
    transferId?: string;
}

export interface SftpOpenWithRequest {
    id: string;
    remotePath: string;
    filename: string;
    transferId?: string;
    applicationPath?: string;
    rememberAssociation?: boolean;
}

/** Файл/папка, выбранные пользователем через диалог загрузки. */
export interface SftpSelectedFile {
    path: string;
    name: string;
    size: number;
    isDir?: boolean;
}

/** Событие начала SFTP-трансфера (sftp-transfer-start-*). */
export interface SftpTransferStartEvent {
    id: string;
    filename: string;
    remotePath: string;
    type: 'upload' | 'download';
    status: 'active';
    size?: number;
    isDir?: boolean;
}

/** Событие изменения удалённого файла (sftp-file-changed-*). */
export interface SftpFileChangedEvent {
    localPath: string;
    remotePath: string;
    filename: string;
}

export type SftpReaddirResult = SftpFileEntry[] | null;
export type SftpRealpathResult = string;
export type SftpMkdirResult = boolean | null;
export type SftpRmResult = boolean | null;
export type SftpRenameResult = boolean | null;
export type SftpChmodResult = boolean | null;
export type SftpExtractResult = boolean;
export type SftpDownloadFileResult = SftpDownloadResult | undefined | null;
export type SftpDownloadMultipleResult = (SftpDownloadResult | undefined)[] | null;
export type SftpUploadFilesFromPathsResult = SftpUploadResult[] | null;
export type SftpUploadDirectResult = boolean;
export type SftpCancelUploadResult = boolean;
export type SftpOpenInEditorResult = boolean | null;
export type SftpOpenWithResult = boolean | null;
export type SftpSelectFilesResult = SftpSelectedFile[] | null;