import { useCallback, useEffect, useMemo, useRef, useState, type FC, type Dispatch, type SetStateAction, type DragEvent, type MouseEvent } from 'react';
import { startDrag } from '@crabnebula/tauri-plugin-drag';
import { Archive, Copy, Download, Edit, MousePointer2, RefreshCw, Shield, Trash2, UploadCloud, Folder, Plug, Loader2 } from 'lucide-react';
import { ContextMenu } from './layout/ContextMenu';
import { SftpToolbar } from './sftp/SftpToolbar';
import { SftpFileList } from './sftp/SftpFileList';
import { SftpTransferPanel } from './sftp/SftpTransferPanel';
import { SftpModals } from './sftp/SftpModals';
import type { AppConfig, PendingFileUpdate, PendingUploadContext, SftpFileEntry, SSHConfig, StartUploadOptions, Transfer, UploadCandidate } from '../types';
import { normalizeRemotePath, getOSIcon } from '../utils';
import { copyToClipboard } from '../utils/clipboard';
import { useI18n } from '../utils/i18n';
import { useSftpConnection } from '../hooks/sftp/useSftpConnection';
import { useSftpTransfers } from '../hooks/sftp/useSftpTransfers';
import { useFingerprintPrompt } from '../hooks/useFingerprintPrompt';
import { SshFingerprintModal } from './modals/SshFingerprintModal';
import { useSftpDirectory, type ActiveUploadPlaceholder } from '../hooks/sftp/useSftpDirectory';
import { useSftpSelection } from '../hooks/sftp/useSftpSelection';
import { useSftpEvents } from '../hooks/sftp/useSftpEvents';

const { ipcRenderer } = window;

interface SftpDragPreviewItem {
    filename: string;
    isDirectory: boolean;
    iconData: string | null;
}

async function createSftpDragIcon(items: SftpDragPreviewItem[]): Promise<string> {
    const loadedIcons = await Promise.all(items.map(async item => {
        if (!item.iconData) return null;
        const icon = new Image();
        icon.src = item.iconData;
        await new Promise<void>(resolve => {
            icon.onload = () => resolve();
            icon.onerror = () => resolve();
        });
        return icon.naturalWidth > 0 ? icon : null;
    }));

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create drag preview');
    context.font = '14px "Segoe UI", sans-serif';
    if (items.length === 1) {
        const item = items[0];
        if (!item) throw new Error('Missing drag item');
        const name = item.filename.length > 120 ? `${item.filename.slice(0, 117)}…` : item.filename;
        const nameWidth = Math.ceil(context.measureText(name).width);
        canvas.width = Math.min(360, nameWidth + 52);
        canvas.height = 44;
        const row = canvas.getContext('2d');
        if (!row) throw new Error('Could not create drag preview');
        row.font = '14px "Segoe UI", sans-serif';
        row.shadowColor = 'rgba(0,0,0,0.28)';
        row.shadowBlur = 8;
        row.shadowOffsetY = 2;
        row.fillStyle = 'rgba(250,250,250,0.96)';
        row.strokeStyle = 'rgba(0,0,0,0.18)';
        row.lineWidth = 1;
        row.beginPath();
        row.roundRect(1, 1, canvas.width - 2, canvas.height - 2, 5);
        row.fill();
        row.shadowColor = 'transparent';
        row.stroke();
        const icon = loadedIcons[0];
        if (icon) row.drawImage(icon, 6, 6, 32, 32);
        else {
            row.fillStyle = item.isDirectory ? '#e6ad32' : '#f5f5f5';
            row.strokeStyle = item.isDirectory ? '#bd861a' : '#8b929a';
            row.lineWidth = 1.5;
            row.beginPath();
            row.roundRect(8, 7, 25, 30, 2);
            row.fill();
            row.stroke();
        }
        row.fillStyle = '#202020';
        row.textBaseline = 'middle';
        row.fillText(name, 44, 22, canvas.width - 50);
        return canvas.toDataURL('image/png');
    }

    const visibleItems = items.slice(0, 12);
    const hasMoreItems = items.length > visibleItems.length;
    const rowHeight = 34;
    canvas.width = 340;
    canvas.height = 10 + (visibleItems.length + Number(hasMoreItems)) * rowHeight;
    const list = canvas.getContext('2d');
    if (!list) throw new Error('Could not create drag preview');
    list.font = '14px "Segoe UI", sans-serif';
    list.fillStyle = 'rgba(17,24,39,0.97)';
    list.strokeStyle = 'rgba(112,112,255,0.95)';
    list.lineWidth = 1;
    list.beginPath();
    list.roundRect(1, 1, canvas.width - 2, canvas.height - 2, 8);
    list.fill();
    list.stroke();

    visibleItems.forEach((item, index) => {
        const y = 6 + index * rowHeight;
        const icon = loadedIcons[index];
        if (icon) list.drawImage(icon, 8, y + 4, 24, 24);
        else {
            list.fillStyle = item.isDirectory ? '#d79921' : '#f5f5f5';
            list.strokeStyle = item.isDirectory ? '#bd861a' : '#8b929a';
            list.lineWidth = 1.5;
            list.beginPath();
            list.roundRect(11, y + 4, 18, 24, 2);
            list.fill();
            list.stroke();
            list.strokeStyle = 'rgba(112,112,255,0.35)';
        }
        list.fillStyle = '#e5e7eb';
        list.textBaseline = 'middle';
        list.fillText(item.filename, 40, y + 16, canvas.width - 52);
        if (index < visibleItems.length - 1 || hasMoreItems) {
            list.strokeStyle = 'rgba(148,163,184,0.16)';
            list.beginPath();
            list.moveTo(8, y + rowHeight);
            list.lineTo(canvas.width - 8, y + rowHeight);
            list.stroke();
            list.strokeStyle = 'rgba(112,112,255,0.35)';
        }
    });
    if (hasMoreItems) {
        list.fillStyle = '#9ca3af';
        list.textBaseline = 'middle';
        list.fillText(`+ ${items.length - visibleItems.length}`, 40, 6 + visibleItems.length * rowHeight + 16);
    }
    return canvas.toDataURL('image/png');
}

interface Props {
    id: string;
    config: SSHConfig;
    visible?: boolean;
    onEditConfig?: (config: SSHConfig) => void;
    onClose?: () => void;
    appConfig?: AppConfig;
    onAppConfigUpdate?: (config: AppConfig) => void;
    onSftpDefaultDirectoryChange?: (path: string | null) => void;
}

export const SFTPBrowser: FC<Props> = ({ id, config, visible, onEditConfig, onClose, appConfig, onAppConfigUpdate, onSftpDefaultDirectoryChange }) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    const contentRef = useRef<HTMLDivElement>(null);

    const [isProcessing, setIsProcessing] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [draggingFilenames, setDraggingFilenames] = useState<string[]>([]);
    const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
    const dragCounter = useRef(0);
    const outboundDragTempDirectoriesRef = useRef(new Set<string>());
    const outboundDragActiveRef = useRef(false);

    const isOutboundDragPath = useCallback((path: string) => {
        const normalizePath = (value: string) => value.replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '').toLowerCase();
        const normalizedPath = normalizePath(path);
        return [...outboundDragTempDirectoriesRef.current].some(directory => {
            const normalizedDirectory = normalizePath(directory);
            return normalizedPath === normalizedDirectory
                || normalizedPath.startsWith(`${normalizedDirectory}\\`)
                || normalizedPath.startsWith(`${normalizedDirectory}/`);
        });
    }, []);

    const pendingUploadContextRef = useRef<PendingUploadContext | null>(null);

    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file?: SftpFileEntry } | null>(null);
    const [modal, setModal] = useState<{
        type: string;
        file?: SftpFileEntry;
        selectedFiles?: SftpFileEntry[];
        errorMessage?: string;
        cancelPath?: string;
        localPath?: string;
        remotePath?: string;
        filename?: string;
        applicationPath?: string;
        applicationName?: string;
        fileUpdates?: PendingFileUpdate[];
    } | null>(null);
    const [modalInput, setModalInput] = useState('');

    const connection = useSftpConnection(id, config, appConfig?.language || 'ru');
    const transfers = useSftpTransfers(id, appConfig);
    const fingerprint = useFingerprintPrompt(id);

    const selectionRef = useRef<{ setSelectedFilenames: Dispatch<SetStateAction<string[]>>; setLastSelectedIndex: Dispatch<SetStateAction<number>> }>({
        setSelectedFilenames: () => {},
        setLastSelectedIndex: () => {}
    });

    const setSelectedFilenamesProxy: Dispatch<SetStateAction<string[]>> = useCallback((val) => {
        selectionRef.current.setSelectedFilenames(val);
    }, []);

    const setLastSelectedIndexProxy: Dispatch<SetStateAction<number>> = useCallback((val) => {
        selectionRef.current.setLastSelectedIndex(val);
    }, []);

    const activeUploads: ActiveUploadPlaceholder[] = useMemo(() => {
        return transfers.activeTransfers
            .filter(t => t.type === 'upload' && (t.status === 'active' || t.status === 'success'))
            .map(t => ({
                filename: t.filename,
                remotePath: t.remotePath,
                isDir: t.isDir,
                size: t.size
            }));
    }, [transfers.activeTransfers]);
    const isDownloading = draggingFilenames.length > 0 || transfers.activeTransfers.some(transfer =>
        transfer.type === 'download' && transfer.status === 'active'
    );

    const directory = useSftpDirectory(
        id,
        connection.rawStatusRef,
        connection.tRef,
        activeUploads,
        setSelectedFilenamesProxy,
        setLastSelectedIndexProxy
    );

    const resolveDropDirectory = useCallback((clientX: number, clientY: number): string => {
        const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-sftp-drop-directory]');
        const filename = target?.dataset.sftpDropDirectory;
        if (!filename || !target || !contentRef.current?.contains(target)) return directory.path;
        return normalizeRemotePath(`${directory.path}/${filename}`);
    }, [directory.path]);

    const setDropTargetAtPoint = useCallback((clientX: number, clientY: number) => {
        const destination = resolveDropDirectory(clientX, clientY);
        setDropTargetPath(destination === directory.path ? null : destination);
    }, [directory.path, resolveDropDirectory]);

    const handleEditRef = useRef<(filename: string, openWith?: boolean) => Promise<void>>(() => Promise.resolve());

    const handleFileDoubleClick = useCallback((f: SftpFileEntry) => {
        if (f.filename === '..') {
            const parts = directory.path.split('/').filter(Boolean);
            parts.pop();
            void directory.loadDirectory('/' + parts.join('/'));
            return;
        }
        const isDir = (f.attrs.mode & 0o170000) === 0o040000;
        const isLink = (f.attrs.mode & 0o170000) === 0o120000;
        if (isDir || isLink) {
            const isTargetDir = isLink && f.targetAttrs ? (f.targetAttrs.mode & 0o170000) === 0o040000 : isDir;
            if (isTargetDir) {
                void directory.loadDirectory(directory.path === '/' ? `/${f.filename}` : `${directory.path}/${f.filename}`.replace(/\/+/g, '/'));
            } else {
                void handleEditRef.current(f.filename);
            }
        } else void handleEditRef.current(f.filename);
    }, [directory]);

    const selection = useSftpSelection(
        directory.displayFileList,
        contentRef,
        handleFileDoubleClick
    );

    const handleFileDragStart = useCallback(async (event: DragEvent, file: SftpFileEntry) => {
        event.preventDefault();
        if (file.filename === '..' || !ipcRenderer?.sftpDownloadForDrag || !ipcRenderer?.sftpCleanupDragFiles) return;

        const selectedFiles = selection.selectedFilenames.includes(file.filename)
            ? directory.displayFileList.filter(entry => selection.selectedFilenames.includes(entry.filename))
            : [file];
        const groupId = selectedFiles.length > 1 ? `sftp-drag-${crypto.randomUUID()}` : undefined;
        setDraggingFilenames(selectedFiles.map(entry => entry.filename));
        let tempDirectory: string | null = null;
        let previewStarted = false;
        const deferDownloadUntilDrop = ipcRenderer.platform === 'win32'
            && Boolean(ipcRenderer.sftpPrepareDrag && ipcRenderer.sftpStartDrag);
        try {
            const dragPayload = {
                id,
                files: selectedFiles.map(entry => ({
                    remotePath: normalizeRemotePath(`${directory.path}/${entry.filename}`),
                    filename: entry.filename,
                    transferId: crypto.randomUUID(),
                    isDir: (entry.attrs.mode & 0o170000) === 0o040000
                }))
            };
            const staged = deferDownloadUntilDrop
                ? await ipcRenderer.sftpPrepareDrag(dragPayload)
                : await ipcRenderer.sftpDownloadForDrag(dragPayload);
            if (!staged || staged.paths.length === 0) return;
            tempDirectory = staged.tempDirectory;
            outboundDragTempDirectoriesRef.current.add(staged.tempDirectory);
            const dragPreviewItems = selectedFiles.map((entry, index) => ({
                filename: entry.filename,
                isDirectory: (entry.attrs.mode & 0o170000) === 0o040000,
                iconData: staged.icons[index] ?? null
            }));
            window.dispatchEvent(new CustomEvent('yash-sftp-outbound-drag-state', { detail: true }));
            previewStarted = true;
            const dragIcon = await createSftpDragIcon(dragPreviewItems);
            if (deferDownloadUntilDrop) {
                await ipcRenderer.sftpStartDrag({
                    ...dragPayload,
                    groupId,
                    icon: dragIcon
                });
            } else {
                await startDrag(
                    { item: staged.paths, icon: dragIcon, mode: 'copy' },
                    () => undefined
                );
            }
        } catch (error) {
            setModal({ type: 'error', errorMessage: error instanceof Error ? error.message : String(error) });
        } finally {
            if (previewStarted) window.dispatchEvent(new CustomEvent('yash-sftp-outbound-drag-state', { detail: false }));
            setDraggingFilenames([]);
            if (tempDirectory) {
                const directoryToForget = tempDirectory;
                window.setTimeout(() => outboundDragTempDirectoriesRef.current.delete(directoryToForget), 5000);
                await ipcRenderer.sftpCleanupDragFiles(tempDirectory);
            }
        }
    }, [directory.displayFileList, directory.path, id, selection.selectedFilenames]);

    useEffect(() => {
        selectionRef.current.setSelectedFilenames = selection.setSelectedFilenames;
        selectionRef.current.setLastSelectedIndex = selection.setLastSelectedIndex;
    }, [selection.setSelectedFilenames, selection.setLastSelectedIndex]);

    useSftpEvents({
        id,
        config,
        connect: connection.connect,
        rawStatusRef: connection.rawStatusRef,
        setStatus: connection.setStatus,
        wasConnectedRef: connection.wasConnectedRef,
        isConnectingRef: connection.isConnectingRef,
        pendingDeletesRef: transfers.pendingDeletesRef,
        loadDirectory: directory.loadDirectory,
        setError: connection.setError,
        setLoading: directory.setLoading,
        setStatusKind: connection.setStatusKind,
        setErrorKind: connection.setErrorKind,
        cancelledTransferIdsRef: transfers.cancelledTransferIdsRef,
        setActiveTransfers: transfers.setActiveTransfers,
        setModal,
        enqueueProgressUpdate: transfers.enqueueProgressUpdate,
        notifyTransferSuccess: transfers.notifyTransferSuccess,
        throttleTimerRef: transfers.throttleTimerRef,
        tRef: connection.tRef
    });

    const handleDownload = useCallback(async (filenames: string[]) => {
        if (filenames.length === 0) return;
        const transfersToPrepare = filenames.map(filename => {
            const file = directory.files.find(f => f.filename === filename);
            const remotePath = normalizeRemotePath(`${directory.path}/${filename}`);
            const transferId = crypto.randomUUID();
            transfers.clearTransferCancellation(transferId);
            const isDir = file ? (file.attrs.mode & 0o170000) === 0o040000 : false;

            return {
                id: transferId,
                filename,
                remotePath,
                size: file?.attrs.size,
                isDir
            };
        });

        try {
            let res: unknown = null;
            if (filenames.length === 1) {
                res = await ipcRenderer?.sftpDownloadFile?.({
                    id,
                    remotePath: `${directory.path}/${filenames[0]}`.replace(/\/+/g, '/'),
                    filename: filenames[0],
                    transferId: transfersToPrepare[0].id
                });
            } else {
                res = await ipcRenderer?.sftpDownloadMultiple?.({
                    id,
                    files: transfersToPrepare.map(t => ({ filename: t.filename, remotePath: t.remotePath, transferId: t.id, isDir: t.isDir }))
                });
            }

            if (res === null) {
                return;
            }

            transfers.notifyTransferSuccess();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('No response from server') || message.includes('closed') || message.includes('destroyed')) {
                transfers.setActiveTransfers(prev => prev.map(t => transfersToPrepare.find(nt => nt.id === t.id) ? {
                    ...t,
                    status: 'cancelled'
                } : t));
            } else {
                transfers.setActiveTransfers(prev => prev.map(t => transfersToPrepare.find(nt => nt.id === t.id) ? {
                    ...t,
                    status: 'error',
                    error: message
                } : t));
            }
        }
    }, [id, directory.files, directory.path, transfers]);

    const startUpload = useCallback(async (items: UploadCandidate[], options: StartUploadOptions = {}, remoteDir = directory.path) => {
        if (items.length === 0) return;
        const groupId = items.length > 1 ? crypto.randomUUID() : undefined;

        const newTransfers: Transfer[] = items.map(c => {
            transfers.clearTransferCancellation(c.transferId);
            return {
                id: c.transferId,
                groupId,
                filename: c.filename,
                remotePath: c.remotePath,
                progress: 0,
                size: c.size,
                type: 'upload' as const,
                status: 'active' as const,
                isDir: c.isDir
            };
        });

        transfers.setActiveTransfers(prev => [...newTransfers, ...prev]);

        try {
            await ipcRenderer?.sftpUploadFilesFromPaths?.({
                id,
                remoteDir,
                groupId,
                deleteRemotePartialOnCancel: appConfig?.sftpDeletePartialOnCancel ?? false,
                transfers: newTransfers.map((t, idx) => ({
                    localPath: items[idx].localPath,
                    transferId: t.id
                }))
            });
            transfers.notifyTransferSuccess();
            void directory.loadDirectory(directory.pathRef.current);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('No response from server') || message.includes('closed') || message.includes('destroyed')) {
                transfers.setActiveTransfers(prev => prev.map(t => newTransfers.find(nt => nt.id === t.id) ? {
                    ...t,
                    status: 'cancelled'
                } : t));
                return;
            }
            if (options.pendingDeletesOnError) {
                transfers.addPendingDeletes(newTransfers.map(u => u.remotePath));
            }
            transfers.setActiveTransfers(prev => prev.map(t => newTransfers.find(nt => nt.id === t.id) ? {
                ...t,
                status: 'error',
                error: message
            } : t));
            if (options.showErrorModal !== false) {
                setModal({ type: 'error', errorMessage: message });
            }
        }
    }, [id, directory, transfers, appConfig]);

    const requestUpload = useCallback(async (items: UploadCandidate[], options: StartUploadOptions = {}, remoteDir = directory.path) => {
        let targetFiles: SftpFileEntry[] | null | undefined;
        try {
            targetFiles = remoteDir === directory.path
                ? directory.files
                : await ipcRenderer?.sftpReaddir?.({ id, path: remoteDir });
        } catch (err: unknown) {
            setModal({
                type: 'error',
                errorMessage: err instanceof Error ? err.message : String(err)
            });
            return;
        }
        if (!targetFiles) {
            setModal({ type: 'error', errorMessage: t('errors.readdirError', { message: '' }) });
            return;
        }
        const existingNames = new Set(targetFiles.map(file => file.filename));
        const existingItems = items.filter(i => existingNames.has(i.filename));

        if (existingItems.length === 0) {
            await startUpload(items, options, remoteDir);
            return;
        }

        pendingUploadContextRef.current = { items, options, remoteDir };
        const freshItems = items.filter(i => !existingNames.has(i.filename));
        if (freshItems.length > 0) void startUpload(freshItems, options, remoteDir);
        setModal({
            type: 'overwriteConfirm',
            fileUpdates: existingItems.map(i => ({
                localPath: i.localPath,
                remotePath: i.remotePath,
                filename: i.filename,
                // При единственном конфликтующем файле выбор однозначен.
                // Для нескольких файлов оставляем ручной выбор.
                selected: existingItems.length === 1,
                isDir: i.isDir
            }))
        });
    }, [directory.files, directory.path, id, setModal, startUpload, t]);

    const handleSkipOverwrite = useCallback(() => {
        pendingUploadContextRef.current = null;
        setModal(null);
    }, []);

    const handleModalClose = useCallback(() => {
        if (modal?.type === 'overwriteConfirm') {
            pendingUploadContextRef.current = null;
        }
        setModal(null);
    }, [modal?.type]);

    const handleReplaceAllOverwrite = useCallback(() => {
        const context = pendingUploadContextRef.current;
        pendingUploadContextRef.current = null;
        setModal(null);
        if (!context) return;
        const existingRemotePaths = new Set((modal?.fileUpdates || []).map(u => u.remotePath));
        const existingItems = context.items.filter(item => existingRemotePaths.has(item.remotePath));
        void startUpload(existingItems, context.options, context.remoteDir);
    }, [modal?.fileUpdates, startUpload]);

    const handleUpload = useCallback(async (mode: 'file' | 'folder') => {
        try {
            const selectedFiles = await ipcRenderer?.sftpSelectFiles?.(mode) as { path: string; name: string; size: number; isDir?: boolean }[] | null;
            if (!selectedFiles || selectedFiles.length === 0) return;

            const candidates: UploadCandidate[] = selectedFiles.map(f => ({
                localPath: f.path,
                filename: f.name,
                remotePath: normalizeRemotePath(`${directory.path}/${f.name}`),
                transferId: crypto.randomUUID(),
                size: f.size,
                isDir: f.isDir
            }));

            await requestUpload(candidates, { showErrorModal: true });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({ type: 'error', errorMessage: message });
        }
    }, [directory.path, requestUpload]);

    const handleCreateDirectory = useCallback(async () => {
        if (!modalInput) return;
        const nameExists = directory.files.some(f => f.filename.toLowerCase() === modalInput.toLowerCase());
        if (nameExists) {
            setModal({ type: 'error', errorMessage: t('errors.folderAlreadyExists', { name: modalInput }) });
            return;
        }
        try {
            await ipcRenderer?.sftpMkdir?.({
                id,
                path: `${directory.path}/${modalInput}`.replace(/\/+/g, '/')
            });
            setModal(null);
            void directory.loadDirectory(directory.path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('Failure') || message.includes('already exists') || message.includes('EEXIST')) {
                setModal({ type: 'error', errorMessage: t('errors.folderAlreadyExists', { name: modalInput }) });
            } else {
                setModal({ type: 'error', errorMessage: message });
            }
        }
    }, [id, directory, modalInput, t]);

    const getApplicationName = useCallback((applicationPath: string): string => {
        const normalizedApplicationPath = applicationPath.replace(/\\/g, '/');
        const applicationPathParts = normalizedApplicationPath.split('/');
        const applicationFileName = applicationPathParts.length > 0 ? applicationPathParts[applicationPathParts.length - 1] : applicationPath;
        if (applicationFileName.toLowerCase().endsWith('.exe')) {
            return applicationFileName.substring(0, applicationFileName.length - 4);
        }
        return applicationFileName;
    }, []);

    const handleEdit = useCallback(async (filename: string, openWith = false) => {
        const remotePath = normalizeRemotePath(`${directory.path}/${filename}`);
        if (openWith) {
            const applicationPath = await ipcRenderer?.selectExecutableFile?.();
            if (!applicationPath) {
                return;
            }
            setModalInput('true');
            setModal({
                type: 'openWithRemember',
                filename,
                remotePath,
                applicationPath,
                applicationName: getApplicationName(applicationPath)
            });
            return;
        }
        const file = directory.files.find(f => f.filename === filename);
        const transferId = crypto.randomUUID();
        transfers.clearTransferCancellation(transferId);
        const newTransfer: Transfer = {
            id: transferId,
            filename,
            remotePath,
            progress: 0,
            size: file?.attrs.size,
            type: 'download',
            status: 'active' as const
        };
        transfers.setActiveTransfers(prev => [newTransfer, ...prev]);

        try {
            const result = await ipcRenderer?.sftpOpenInEditor?.({
                id,
                remotePath,
                filename,
                transferId
            });

            if (result === null) {
                transfers.setActiveTransfers(prev => prev.filter(t => t.id !== transferId));
            } else if (!result) {
                const message = connection.tRef.current('errors.selectedAppNotFound');
                transfers.setActiveTransfers(prev => prev.map(t => t.id === newTransfer.id ? { ...t, status: 'error', error: message } : t));
                setModal({ type: 'error', errorMessage: message });
                return;
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('No response from server') || message.includes('destroyed') || message.includes('closed')) {
                transfers.setActiveTransfers(prev => prev.map(t => t.id === newTransfer.id ? { ...t, status: 'cancelled' } : t));
            } else {
                setModal({ type: 'error', errorMessage: message });
                transfers.setActiveTransfers(prev => prev.map(t => t.id === newTransfer.id ? { ...t, status: 'error', error: message } : t));
            }
        }
    }, [id, directory.files, directory.path, transfers, getApplicationName, connection.tRef]);

    useEffect(() => {
        handleEditRef.current = handleEdit;
    }, [handleEdit]);

    const handleDelete = useCallback(async () => {
        const items = modal?.selectedFiles || (modal?.file ? [modal.file] : []);
        setIsProcessing(true);
        try {
            const removedPaths: string[] = [];
            for (const file of items) {
                const fullPath = `${directory.path}/${file.filename}`.replace(/\/+/g, '/');
                await ipcRenderer?.sftpRm?.({
                    id,
                    path: fullPath,
                    isDir: (file.attrs.mode & 0o040000) !== 0
                });
                removedPaths.push(normalizeRemotePath(fullPath));
            }

            transfers.setActiveTransfers(prev => prev.filter(t => !removedPaths.includes(normalizeRemotePath(t.remotePath))));

            setModal(null);
            void directory.loadDirectory(directory.path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({ type: 'error', errorMessage: message });
        } finally {
            setIsProcessing(false);
        }
    }, [id, directory, modal, transfers]);

    const handleRename = useCallback(async () => {
        if (!modal?.file || !modalInput) return;
        try {
            const oldPath = `${directory.path}/${modal.file.filename}`.replace(/\/+/g, '/');
            await ipcRenderer?.sftpRename?.({
                id,
                oldPath,
                newPath: `${directory.path}/${modalInput}`.replace(/\/+/g, '/')
            });

            const normalizedOldPath = normalizeRemotePath(oldPath);
            transfers.setActiveTransfers(prev => prev.filter(t => normalizeRemotePath(t.remotePath) !== normalizedOldPath));

            setModal(null);
            void directory.loadDirectory(directory.path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({ type: 'error', errorMessage: message });
        }
    }, [id, directory, modal, modalInput, transfers]);

    const handlePermissions = useCallback(async () => {
        const items = modal?.selectedFiles || (modal?.file ? [modal.file] : []);
        if (items.length === 0 || !modalInput) return;
        setIsProcessing(true);
        try {
            const mode = parseInt(modalInput, 8);
            for (const file of items) {
                await ipcRenderer?.sftpChmod?.({
                    id,
                    path: `${directory.path}/${file.filename}`.replace(/\/+/g, '/'),
                    mode
                });
            }
            setModal(null);
            void directory.loadDirectory(directory.path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({ type: 'error', errorMessage: message });
        } finally {
            setIsProcessing(false);
        }
    }, [id, directory, modal, modalInput]);

    const handleDrop = useCallback(async (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const remoteDir = resolveDropDirectory(e.clientX, e.clientY);
        setIsDragging(false);
        setDropTargetPath(null);
        dragCounter.current = 0;
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length === 0) return;

        const droppedFilesWithPaths = await Promise.all(droppedFiles.map(async f => {
            const localPath = ipcRenderer?.getPathForFile?.(f);
            if (!localPath || isOutboundDragPath(localPath)) return null;
            const stats = await ipcRenderer?.fsStat?.(localPath) as { size: number; isDir: boolean } | null;
            return {
                name: f.name,
                size: stats?.size || 0,
                path: localPath,
                isDir: stats?.isDir || false
            };
        }));

        const validDroppedFiles = droppedFilesWithPaths.filter((f): f is NonNullable<typeof f> => f !== null);
        if (validDroppedFiles.length === 0) return;

        const candidates: UploadCandidate[] = validDroppedFiles.map(f => ({
            localPath: f.path,
            filename: f.name,
            remotePath: normalizeRemotePath(`${remoteDir}/${f.name}`),
            transferId: crypto.randomUUID(),
            size: f.size,
            isDir: f.isDir
        }));

        await requestUpload(candidates, { pendingDeletesOnError: true, showErrorModal: false }, remoteDir);
    }, [isOutboundDragPath, requestUpload, resolveDropDirectory]);

    const handleNativeFilesDropped = useCallback(async (paths: string[], clientX: number, clientY: number) => {
        const remoteDir = resolveDropDirectory(clientX, clientY);
        setIsDragging(false);
        setDropTargetPath(null);
        dragCounter.current = 0;
        const incomingPaths = paths.filter(path => !isOutboundDragPath(path));
        if (!visible || incomingPaths.length === 0) return;

        try {
            const candidates = await Promise.all(incomingPaths.map(async (localPath): Promise<UploadCandidate | null> => {
                const filename = localPath.split(/[\\/]/).filter(Boolean).pop();
                if (!filename) return null;
                const stats = await ipcRenderer?.fsStat?.(localPath);
                if (!stats) return null;
                return {
                    localPath,
                    filename,
                    remotePath: normalizeRemotePath(`${remoteDir}/${filename}`),
                    transferId: crypto.randomUUID(),
                    size: stats.size,
                    isDir: stats.isDir
                };
            }));
            const validCandidates = candidates.filter((candidate): candidate is UploadCandidate => candidate !== null);
            if (validCandidates.length > 0) {
                await requestUpload(validCandidates, { pendingDeletesOnError: true, showErrorModal: false }, remoteDir);
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({ type: 'error', errorMessage: message });
        }
    }, [isOutboundDragPath, requestUpload, resolveDropDirectory, visible]);

    useEffect(() => {
        const handleOutboundDragState = (event: Event) => {
            const isActive = (event as CustomEvent<boolean>).detail;
            outboundDragActiveRef.current = isActive;
            if (!isActive) {
                setIsDragging(false);
                dragCounter.current = 0;
                setDropTargetPath(null);
            }
        };
        const handleDragState = (event: Event) => {
            const isActive = (event as CustomEvent<boolean>).detail;
            if (isActive && outboundDragActiveRef.current) return;
            if (!visible && isActive) return;
            setIsDragging(isActive);
            if (!isActive) {
                outboundDragActiveRef.current = false;
                dragCounter.current = 0;
                setDropTargetPath(null);
            }
        };
        const handleDragPosition = (event: Event) => {
            if (!visible) return;
            const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
            const scale = window.devicePixelRatio || 1;
            setDropTargetAtPoint(x / scale, y / scale);
        };
        const handleFilesDropped = (event: Event) => {
            const { paths, x, y } = (event as CustomEvent<{ paths: string[]; x: number; y: number }>).detail;
            const scale = window.devicePixelRatio || 1;
            void handleNativeFilesDropped(paths, x / scale, y / scale);
        };

        window.addEventListener('yash-sftp-outbound-drag-state', handleOutboundDragState);
        window.addEventListener('yash-files-drag-state', handleDragState);
        window.addEventListener('yash-files-drag-position', handleDragPosition);
        window.addEventListener('yash-files-dropped', handleFilesDropped);
        return () => {
            window.removeEventListener('yash-sftp-outbound-drag-state', handleOutboundDragState);
            window.removeEventListener('yash-files-drag-state', handleDragState);
            window.removeEventListener('yash-files-drag-position', handleDragPosition);
            window.removeEventListener('yash-files-dropped', handleFilesDropped);
        };
    }, [handleNativeFilesDropped, setDropTargetAtPoint, visible]);

    const handleGoHome = useCallback(() => {
        void directory.loadDirectory('/');
    }, [directory]);
    const handleSetDefaultDirectory = useCallback(() => {
        const defaultDirectory = normalizeRemotePath(directory.path);
        const nextDefaultDirectory = config.sftpDefaultDirectory === defaultDirectory ? null : defaultDirectory;
        if (onSftpDefaultDirectoryChange) {
            onSftpDefaultDirectoryChange(nextDefaultDirectory);
            return;
        }
        if (!appConfig || !onAppConfigUpdate || !config.id) return;
        onAppConfigUpdate({
            ...appConfig,
            favorites: appConfig.favorites.map(favorite => {
                if (favorite.id !== config.id) return favorite;
                const updated = { ...favorite };
                if (nextDefaultDirectory) updated.sftpDefaultDirectory = nextDefaultDirectory;
                else delete updated.sftpDefaultDirectory;
                return updated;
            })
        });
    }, [appConfig, config.id, config.sftpDefaultDirectory, directory.path, onAppConfigUpdate, onSftpDefaultDirectoryChange]);
    const handleRefresh = useCallback(async () => {
        directory.setIsRefreshing(true);
        const minSpinPromise = new Promise(resolve => setTimeout(resolve, 500));
        try {
            await directory.loadDirectory(directory.path, true);
        } finally {
            await minSpinPromise;
            directory.setIsRefreshing(false);
        }
    }, [directory]);

    const handleFileContextMenu = useCallback((e: MouseEvent, f: SftpFileEntry) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selection.selectedFilenames.includes(f.filename)) {
            selection.setSelectedFilenames([f.filename]);
            selection.setLastSelectedIndex(directory.files.findIndex(x => x.filename === f.filename));
        }

        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            file: f
        });
    }, [selection, directory.files]);

    const handleSort = useCallback((field: 'name' | 'size' | 'mtime' | 'type') => {
        if (directory.sortField === field) {
            directory.setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            directory.setSortField(field);
            directory.setSortDirection(field === 'mtime' ? 'desc' : 'asc');
        }
    }, [directory]);

    const handleToggleHidden = useCallback(() => {
        directory.setShowHidden(prev => !prev);
    }, [directory]);

    const handleOpenWithRemember = useCallback(async (): Promise<void> => {
        if (!modal || !modal.filename || !modal.remotePath || !modal.applicationPath) {
            setModal(null);
            return;
        }
        const transferId = crypto.randomUUID();
        const file = directory.files.find((currentFile) => currentFile.filename === modal.filename);
        const newTransfer: Transfer = {
            id: transferId,
            filename: modal.filename,
            remotePath: modal.remotePath,
            progress: 0,
            size: file?.attrs.size,
            type: 'download',
            status: 'active' as const
        };
        transfers.setActiveTransfers((previousTransfers) => [newTransfer, ...previousTransfers]);
        try {
            const result = await ipcRenderer?.sftpOpenWith?.({
                id,
                remotePath: modal.remotePath,
                filename: modal.filename,
                transferId,
                applicationPath: modal.applicationPath,
                rememberAssociation: modalInput === 'true'
            });
            if (result === null) {
                transfers.setActiveTransfers((previousTransfers) => previousTransfers.filter((transfer) => transfer.id !== transferId));
            }
            if (modalInput === 'true') {
                const updatedConfig = await ipcRenderer?.getConfig?.() as AppConfig | undefined;
                if (updatedConfig && onAppConfigUpdate) {
                    onAppConfigUpdate(updatedConfig);
                }
            }
            setModal(null);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({ type: 'error', errorMessage: message });
            transfers.setActiveTransfers((previousTransfers) => previousTransfers.map((transfer) => {
                if (transfer.id === transferId) {
                    return { ...transfer, status: 'error', error: message };
                }
                return transfer;
            }));
        }
    }, [directory.files, id, modal, modalInput, onAppConfigUpdate, transfers]);

    const primaryRed = 'var(--primary-color)';

    // Пока ключ хоста не подтверждён, показывается только окно подтверждения.
    //
    // Раньше модалка рисовалась поверх экрана подключения, и тот просвечивал
    // сквозь неё: пользователь видел сразу два окна —Spinner и «Закрыть» под
    // диалогом. Основной интерфейс появляется только после успешного
    // подключения, когда модалки уже нет.
    if (fingerprint.challenge) {
        return (
            // `visible` проверяется и здесь: вкладки в `App` держатся смонтированными
            // все сразу, и без этого окно фоновой вкладки показалось бы поверх
            // активной.
            <div style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                display: visible ? 'block' : 'none',
                // Фон совпадает с фоном вкладки: показывается только окно, и
                // под ним не должно просвечивать содержимое браузера файлов.
                background: 'var(--bg-color)'
            }}>
                <SshFingerprintModal
                    key={fingerprint.challenge.fingerprint}
                    challenge={fingerprint.challenge}
                    server={config}
                    appConfig={appConfig}
                    onAccept={fingerprint.accept}
                    onReject={() => {
                        fingerprint.reject();
                        onClose?.();
                    }}
                />
            </div>
        );
    }

    return (
        <div
            className={`sftp-container ${isDragging ? 'dragging' : ''}`}
            onDragEnter={(e) => {
                e.preventDefault();
                dragCounter.current++;
                if (e.dataTransfer.items.length > 0) {
                    e.dataTransfer.dropEffect = 'copy';
                    setIsDragging(true);
                    setDropTargetAtPoint(e.clientX, e.clientY);
                }
            }}
            onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setDropTargetAtPoint(e.clientX, e.clientY);
            }}
            onDragLeave={(e) => {
                e.preventDefault();
                dragCounter.current--;
                if (dragCounter.current <= 0) {
                    dragCounter.current = 0;
                    setIsDragging(false);
                    setDropTargetPath(null);
                }
            }}
            onDrop={handleDrop}
            onClick={() => {
                selection.setSelectedFilenames([]);
                selection.setLastSelectedIndex(-1);
            }}
            style={{
                display: visible ? 'flex' : 'none',
                flexDirection: 'row',
                height: '100%',
                width: '100%',
                background: 'var(--bg-color)',
                color: 'var(--text-color)',
                userSelect: 'none',
                position: 'relative'
            }}
        >
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
                {isDragging && (
                    <div style={{
                        position: 'absolute',
                        left: '12px',
                        right: '12px',
                        bottom: '12px',
                        margin: '0 auto',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '9px',
                        maxWidth: 'calc(100% - 24px)',
                        width: 'max-content',
                        padding: '9px 14px',
                        boxSizing: 'border-box',
                        border: '1px dashed var(--primary-color)',
                        borderRadius: '9px',
                        background: 'var(--bg-color)',
                        boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
                        color: primaryRed,
                        zIndex: 1100,
                        pointerEvents: 'none',
                    }}>
                        <UploadCloud size={20} strokeWidth={1.8} />
                        <div style={{ minWidth: 0, fontWeight: 600, fontSize: 'var(--font-size-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('sftp.dropToUpload')}</div>
                    </div>
                )}
                <SftpToolbar path={directory.path} loading={directory.loading} refreshing={directory.isRefreshing} showHidden={directory.showHidden} hasHiddenFiles={directory.hasHiddenFiles} onGoHome={handleGoHome} onToggleHidden={handleToggleHidden} onRefresh={handleRefresh} onUpload={handleUpload} onNavigate={directory.loadDirectory} defaultDirectory={config.sftpDefaultDirectory} onSetDefaultDirectory={handleSetDefaultDirectory} appConfig={appConfig} />

                <div className="sftp-content"
                    ref={contentRef}
                    tabIndex={0}
                    onKeyDown={selection.handleKeyDown}
                    onClick={() => {
                        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
                            contentRef.current?.focus();
                        }
                    }}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                            x: e.clientX,
                            y: e.clientY
                        });
                    }}
                    style={{
                        flex: 1,
                        overflowY: 'auto',
                        position: 'relative',
                        scrollbarGutter: 'stable',
                        outline: 'none'
                    }}>
                    {(!connection.isConnected || connection.isFailed) && (
                        <div className={`connection-overlay ${!connection.isFailed ? 'loading' : 'failed'}`} style={{
                            position: 'absolute',
                            top: 0, left: 0, right: 0, bottom: 0,
                            background: 'var(--bg-color)',
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            zIndex: 10, padding: '40px', textAlign: 'center',
                            transition: 'opacity 0.3s ease, visibility 0.3s'
                        }}>
                            <div className="connection-container" style={{ gap: '40px', padding: '48px', maxWidth: '550px', width: '95%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '20px' }}>
                                    {/* Иконка ОС слева, название и адрес справа (как в окне удаления сервера) */}
                                    <div className="server-info-card" style={{ display: 'flex', alignItems: 'center', gap: '16px', border: 'none', background: 'transparent', padding: 0, textAlign: 'left' }}>
                                        <div className="os-icon-wrapper" style={{ width: '48px', height: '48px', padding: '0', flexShrink: 0, background: 'transparent' }}>
                                            <img src={getOSIcon(config.osPrettyName)} alt="OS" style={{ width: '100%', height: '100%', objectFit: 'contain' }} draggable="false" />
                                        </div>
                                        <div className="server-details" style={{ textAlign: 'left' }}>
                                            <div className="server-name" style={{ fontSize: 'var(--font-size-xl)', fontWeight: 600, color: 'var(--text-primary)' }}>{config.name || config.host}</div>
                                            <div className="server-address" style={{ fontSize: 'var(--font-size-sm)', opacity: 0.7, color: 'var(--text-secondary)' }}>SFTP {config.host}:{config.port}</div>
                                        </div>
                                    </div>
                                </div>

                                {!connection.isFailed ? (
                                    <>
                                        <div className="connection-path" style={{ position: 'relative', width: '100%', padding: '0 20px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div style={{
                                                width: '44px',
                                                height: '44px',
                                                borderRadius: '50%',
                                                background: 'var(--accent)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: '#fff',
                                                zIndex: 2,
                                                position: 'relative'
                                            }}>
                                                <div className="loader-ring" style={{
                                                    position: 'absolute',
                                                    top: '-6px', left: '-6px', right: '-6px', bottom: '-6px',
                                                    border: '4px solid var(--accent)',
                                                    borderRadius: '50%',
                                                    borderTopColor: 'transparent',
                                                    animation: 'spin 1.5s linear infinite',
                                                    opacity: connection.isConnected ? 0 : 1,
                                                    transition: 'opacity 0.3s ease'
                                                }} />
                                                <Plug size={24} />
                                            </div>

                                            <div className="path-line" style={{ flex: 1, height: '2px', background: connection.isConnected ? 'var(--accent)' : 'var(--border)', margin: '0 -2px', transition: 'background 0.5s ease' }} />

                                            <div style={{
                                                width: '44px',
                                                height: '44px',
                                                borderRadius: '50%',
                                                background: connection.isConnected ? 'var(--accent)' : 'var(--hover-surface)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: connection.isConnected ? '#fff' : 'var(--text-secondary)',
                                                zIndex: 2,
                                                border: connection.isConnected ? 'none' : '1px solid var(--border)',
                                                transition: 'all 0.5s ease'
                                            }}>
                                                <Folder size={22} />
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--accent)', fontWeight: 600, fontSize: 'calc(var(--font-size-base) + 2px)', marginTop: '10px' }}>
                                            <Loader2 size={20} className="spin" />
                                            {connection.displayStatus}
                                        </div>

                                        <div className="connection-actions" style={{ width: '100%', display: 'flex', justifyContent: 'flex-start', marginTop: '10px' }}>
                                            {onClose && (
                                                <button onClick={onClose} className="btn-secondary" style={{ padding: '12px 32px', fontSize: 'var(--font-size-base)', background: 'rgba(255,255,255,0.05)', fontWeight: 600 }}>
                                                    {t('common.close')}
                                                </button>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '24px',
                                        width: '100%'
                                    }}>
                                        <div style={{
                                            width: '48px',
                                            height: '48px',
                                            borderRadius: '12px',
                                            background: connection.isAuthFailed ? 'rgba(239, 68, 68, 0.1)' : (connection.isClosed ? 'rgba(255, 255, 255, 0.05)' : 'rgba(239, 68, 68, 0.1)'),
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: connection.isAuthFailed ? '#ef4444' : (connection.isClosed ? 'var(--text-primary)' : '#ef4444'),
                                            fontSize: '24px'
                                        }}>{connection.isAuthFailed ? '🔒' : (connection.isClosed ? '🔌' : '⚠️')}</div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'center' }}>
                                            <div style={{ fontSize: 'calc(var(--ui-font-size-base) + 2px)', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                                                {connection.displayStatus}
                                            </div>
                                            {connection.countdown !== null && !connection.isAuthFailed && (
                                                <div style={{ fontSize: 'calc(var(--ui-font-size-base) + 1px)', opacity: 0.7, fontWeight: 500 }}>
                                                    {t('terminal.reconnectIn', { n: connection.countdown.toString() })}
                                                </div>
                                            )}
                                        </div>

                                        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', width: '100%' }}>
                                            {onClose && (
                                                <button onClick={onClose} className="btn-secondary" style={{ padding: '12px 28px', fontSize: 'var(--ui-font-size-base)' }}>
                                                    {t('common.close')}
                                                </button>
                                            )}
                                            {onEditConfig && (
                                                <button
                                                    onClick={() => onEditConfig(config)}
                                                    className="btn-secondary"
                                                    style={{ padding: '12px 28px', fontSize: 'var(--ui-font-size-base)' }}
                                                >
                                                    {t('common.edit')}
                                                </button>
                                            )}
                                            <button
                                                onClick={connection.connect}
                                                className="btn-primary"
                                                style={{ padding: '12px 28px', fontSize: 'var(--ui-font-size-base)' }}
                                            >
                                                {connection.isClosed ? t('terminal.reconnect') : t('common.connect')}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    <SftpFileList
                        files={directory.displayFileList}
                        dropTargetFilename={dropTargetPath?.split('/').filter(Boolean).pop() || null}
                        selectedFilenames={selection.selectedFilenames}
                        draggingFilenames={draggingFilenames}
                        isDownloading={isDownloading}
                        onFileClick={selection.handleFileClick}
                        onFileDoubleClick={handleFileDoubleClick}
                        onFileContextMenu={handleFileContextMenu}
                        onFileDragStart={handleFileDragStart}
                        loading={directory.loading}
                        appConfig={appConfig}
                        sortField={directory.sortField}
                        sortDirection={directory.sortDirection}
                        onSort={handleSort}
                    />
                </div>
            </div>

            <SftpTransferPanel
                activeTransfers={transfers.activeTransfers}
                progressStore={transfers.progressStore}
                primaryRed={primaryRed}
                onCancelTransfer={transfers.handleCancelTransfer}
                onRemoveTransfer={transfers.removeTransfer}
                onClearFinished={transfers.clearFinishedTransfers}
                appConfig={appConfig}
            />

            {contextMenu && (
                <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} options={[
                    ...(contextMenu.file ? [
                        ...(selection.selectedFilenames.length <= 1 ? [
                            {
                                label: ((contextMenu.file.attrs.mode & 0o040000) !== 0 || (contextMenu.file.targetAttrs && (contextMenu.file.targetAttrs.mode & 0o040000) !== 0)) ? t('sftp.goto') : t('sftp.open'),
                                icon: <MousePointer2 size={14} />,
                                onClick: () => {
                                    const isDir = (contextMenu.file!.attrs.mode & 0o170000) === 0o040000;
                                    const isLink = (contextMenu.file!.attrs.mode & 0o170000) === 0o120000;
                                    if (isDir || isLink) {
                                        const isTargetDir = isLink && contextMenu.file!.targetAttrs ? (contextMenu.file!.targetAttrs.mode & 0o170000) === 0o040000 : isDir;
                                        if (isTargetDir) {
                                            void directory.loadDirectory(directory.path === '/' ? `/${contextMenu.file!.filename}` : `${directory.path}/${contextMenu.file!.filename}`.replace(/\/+/g, '/'));
                                        } else {
                                            void handleEdit(contextMenu.file!.filename);
                                        }
                                    } else void handleEdit(contextMenu.file!.filename);
                                }
                            },
                            ...(!((contextMenu.file.attrs.mode & 0o040000) !== 0) && !(contextMenu.file.targetAttrs && (contextMenu.file.targetAttrs.mode & 0o040000) !== 0) ? [
                                {
                                    label: t('sftp.openWith'), icon: <MousePointer2 size={14} />, onClick: () => { void handleEdit(contextMenu.file!.filename, true); }
                                }
                            ] : []),
                            {
                                label: t('sftp.rename'), icon: <Edit size={14} />, onClick: () => {
                                    setModal({ type: 'rename', file: contextMenu.file });
                                    setModalInput(contextMenu.file!.filename);
                                }
                            },
                            {
                                label: t('sftp.copyPath'),
                                icon: <Copy size={14} />,
                                onClick: () => {
                                    const fullPath = `${directory.path}/${contextMenu.file!.filename}`.replace(/\/+/g, '/');
                                    copyToClipboard(fullPath);
                                }
                            }
                        ] : []),
                        {
                            label: t('sftp.rights'), icon: <Shield size={14} />, onClick: () => {
                                const selectedItems = directory.files.filter(f => selection.selectedFilenames.includes(f.filename));
                                setModal({
                                    type: 'permissions',
                                    file: contextMenu.file,
                                    selectedFiles: selectedItems.length > 0 ? selectedItems : [contextMenu.file!]
                                });
                                setModalInput((contextMenu.file!.attrs.mode & 0o777).toString(8).padStart(3, '0'));
                            }
                        },
                        { label: t('sftp.download'), icon: <Download size={14} />, onClick: () => { void handleDownload(selection.selectedFilenames); } },
                        ...(!((contextMenu.file.attrs.mode & 0o040000) !== 0) && ['.zip', '.tar', '.gz', '.tgz', '.bz2'].some(ext => contextMenu.file!.filename.toLowerCase().endsWith(ext)) ? [{
                            label: t('sftp.extract'),
                            icon: <Archive size={14} />,
                            onClick: () => {
                                void ipcRenderer?.sftpExtract?.({
                                    id,
                                    remotePath: `${directory.path}/${contextMenu.file!.filename}`.replace(/\/+/g, '/')
                                }).then(() => {
                                    void directory.loadDirectory(directory.path);
                                });
                            }
                        }] : [])
                    ] : []),
                    {
                        label: t('sftp.newFolder'),
                        icon: <Archive size={14} />,
                        onClick: () => {
                            setModal({ type: 'mkdir' });
                            setModalInput('');
                        }
                    },
                    {
                        label: t('sftp.refresh'),
                        icon: <RefreshCw size={14} />,
                        onClick: () => { void directory.loadDirectory(directory.path); }
                    },
                    {
                        label: t('sftp.copyDirPath'),
                        icon: <Copy size={14} />,
                        onClick: () => {
                            copyToClipboard(directory.path);
                        }
                    },
                    ...(contextMenu.file ? [{
                        label: t('common.delete'),
                        icon: <Trash2 size={14} />,
                        danger: true,
                        onClick: () => {
                            const selectedItems = directory.files.filter(f => selection.selectedFilenames.includes(f.filename));
                            setModal({
                                type: 'delete',
                                file: contextMenu.file,
                                selectedFiles: selectedItems.length > 0 ? selectedItems : [contextMenu.file!]
                            });
                        }
                    }] : [])
                ]} />
            )}

            <SftpModals modal={modal} modalInput={modalInput} setModalInput={setModalInput}
                isProcessing={isProcessing}
                appConfig={appConfig}
                onModalChange={setModal}
                onClose={handleModalClose}
                onSkip={handleSkipOverwrite}
                onReplaceAll={handleReplaceAllOverwrite}
                onConfirm={() => {
                    if (modal?.type === 'delete') {
                        void handleDelete();
                    } else if (modal?.type === 'rename') {
                        void handleRename();
                    } else if (modal?.type === 'mkdir') {
                        void handleCreateDirectory();
                    } else if (modal?.type === 'permissions') {
                        void handlePermissions();
                    } else if (modal?.type === 'error' || modal?.type === 'cancelUpload') {
                        setModal(null);
                    } else if (modal?.type === 'openWithRemember') {
                        void handleOpenWithRemember();
                    } else if (modal?.type === 'overwriteConfirm') {
                        const context = pendingUploadContextRef.current;
                        pendingUploadContextRef.current = null;
                        setModal(null);
                        if (!context) return;
                        const selectedRemotePaths = new Set((modal.fileUpdates || []).filter(update => update.selected).map(update => update.remotePath));
                        const confirmedItems = context.items.filter(item => selectedRemotePaths.has(item.remotePath));
                        void startUpload(confirmedItems, context.options, context.remoteDir);
                    } else if (modal?.type === 'fileUpdate') {
                        void (async () => {
                            const selectedUpdates = (modal.fileUpdates || []).filter(update => update.selected);
                            if (selectedUpdates.length === 0) {
                                setModal(null);
                                return;
                            }
                            try {
                                await Promise.all(selectedUpdates.map(async (update) => {
                                    const transferId = crypto.randomUUID();
                                    const stats = await ipcRenderer?.fsStat?.(update.localPath) as { size: number; isDir: boolean } | null;
                                    const newTransfer: Transfer = {
                                        id: transferId,
                                        filename: update.filename,
                                        remotePath: update.remotePath,
                                        progress: 0,
                                        size: stats?.size || 0,
                                        type: 'upload',
                                        status: 'active'
                                    };
                                    transfers.setActiveTransfers(prev => [newTransfer, ...prev]);
                                    await ipcRenderer?.sftpUploadDirect?.({
                                        id,
                                        localPath: update.localPath,
                                        remotePath: update.remotePath,
                                        transferId,
                                        deleteRemotePartialOnCancel: appConfig?.sftpDeletePartialOnCancel ?? false
                                    });
                                }));
                                transfers.notifyTransferSuccess();
                                setModal(null);
                                await directory.loadDirectory(directory.pathRef.current);
                            } catch (err: unknown) {
                                const message = err instanceof Error ? err.message : String(err);
                                setModal({ type: 'error', errorMessage: message });
                            }
                        })();
                    }
                }} />

        </div>
    );
};
