import { BrowserWindow, IpcMainEvent } from 'electron'
import { SftpConnectionService } from './SftpConnection.js'
import { SftpFileService } from './SftpFileService.js'
import { SftpUploadService } from './SftpUploadService.js'
import { SftpDownloadService } from './SftpDownloadService.js'
import { SftpTransferManagerService } from './SftpTransferManager.js'
import { SftpArchiveService } from './SftpArchiveService.js'
import type { SftpConnectPayload, SftpDownloadResult, SftpFileEntry, SftpUploadResult } from '../../../src/types.js'

export class SftpManager {
    private connectionService = new SftpConnectionService()
    private fileService = new SftpFileService()
    private uploadService = new SftpUploadService()
    private downloadService = new SftpDownloadService()
    private transferManagerService = new SftpTransferManagerService()
    private archiveService = new SftpArchiveService()

    public connect(event: IpcMainEvent, payload: SftpConnectPayload): void {
        this.connectionService.connect(event, payload)
    }

    public async realpath(payload: { id: string; path: string }): Promise<string> {
        return this.fileService.realpath(payload)
    }

    public async readdir(payload: { id: string; path: string }): Promise<SftpFileEntry[] | null> {
        return this.fileService.readdir(payload)
    }

    public async mkdir(payload: { id: string; path: string }): Promise<boolean | null> {
        return this.fileService.mkdir(payload)
    }

    public async chmod(payload: { id: string; path: string; mode: number | string }): Promise<boolean | null> {
        return this.fileService.chmod(payload)
    }

    public async rename(payload: { id: string; oldPath: string; newPath: string }): Promise<boolean | null> {
        return this.fileService.rename(payload)
    }

    public async rm(payload: { id: string; path: string; isDir: boolean }): Promise<boolean | null> {
        return this.fileService.rm(payload)
    }

    public async statLocal(filePath: string): Promise<{ isDir: boolean; size: number } | null> {
        return this.fileService.statLocal(filePath)
    }

    public async selectFiles(mode: 'file' | 'folder' = 'file') {
        return this.uploadService.selectFiles(mode)
    }

    public async uploadFilesFromPaths(
        getMainWindow: () => BrowserWindow | null,
        payload: { id: string; remoteDir: string; transfers: { localPath: string; transferId: string }[] }
    ): Promise<SftpUploadResult[] | null> {
        return this.uploadService.uploadFilesFromPaths(getMainWindow, payload)
    }

    public async uploadDirect(
        getMainWindow: () => BrowserWindow | null,
        payload: { id: string; localPath: string; remotePath: string; transferId?: string }
    ): Promise<boolean> {
        return this.uploadService.uploadDirect(getMainWindow, payload)
    }

    public async downloadFile(
        getMainWindow: () => BrowserWindow | null,
        payload: { id: string; remotePath: string; filename: string; transferId: string }
    ): Promise<SftpDownloadResult | undefined | null> {
        return this.downloadService.downloadFile(getMainWindow, payload)
    }

    public async downloadMultipleFiles(
        getMainWindow: () => BrowserWindow | null,
        payload: { id: string; files: { remotePath: string; filename: string; transferId: string; isDir?: boolean }[] }
    ): Promise<(SftpDownloadResult | undefined)[] | null> {
        return this.downloadService.downloadMultipleFiles(getMainWindow, payload)
    }

    public async openInEditor(
        getMainWindow: () => BrowserWindow | null,
        payload: { id: string; remotePath: string; filename: string; transferId?: string }
    ): Promise<boolean | null> {
        return this.downloadService.openInEditor(getMainWindow, payload)
    }

    public async openWith(
        getMainWindow: () => BrowserWindow | null,
        payload: { id: string; remotePath: string; filename: string; transferId?: string; applicationPath?: string; rememberAssociation?: boolean }
    ): Promise<boolean | null> {
        return this.downloadService.openWith(getMainWindow, payload)
    }

    public cancelUpload(payload: { id: string; remotePath?: string; transferId?: string }): boolean {
        return this.transferManagerService.cancelUpload(payload)
    }

    public async extract(payload: { id: string; remotePath: string }): Promise<boolean> {
        return this.archiveService.extract(payload)
    }
}

export const sftpManager = new SftpManager()
