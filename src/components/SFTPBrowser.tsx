import { useCallback, useEffect, useMemo, useRef, useState, type FC, type Dispatch, type SetStateAction, type DragEvent, type MouseEvent } from 'react';
import { Archive, Copy, Download, Edit, MousePointer2, RefreshCw, Shield, Trash2, UploadCloud, Folder, Plug, Loader2 } from 'lucide-react';
import { ContextMenu } from './layout/ContextMenu';
import { SftpToolbar } from './sftp/SftpToolbar';
import { SftpFileList } from './sftp/SftpFileList';
import { SftpTransferPanel } from './sftp/SftpTransferPanel';
import { SftpModals } from './sftp/SftpModals';
import type { AppConfig, PendingFileUpdate, PendingUploadContext, SftpFileEntry, SSHConfig, StartUploadOptions, Transfer, UploadCandidate } from '../types';
import { normalizeRemotePath, getOSIcon } from '../utils';
import { useI18n } from '../utils/i18n';
import { useSftpConnection } from '../hooks/sftp/useSftpConnection';
import { useSftpTransfers } from '../hooks/sftp/useSftpTransfers';
import { useSftpDirectory, type ActiveUploadPlaceholder } from '../hooks/sftp/useSftpDirectory';
import { useSftpSelection } from '../hooks/sftp/useSftpSelection';
import { useSftpEvents } from '../hooks/sftp/useSftpEvents';

const { ipcRenderer } = window;

interface Props {
    id: string;
    config: SSHConfig;
    visible?: boolean;
    onEditConfig?: (config: SSHConfig) => void;
    onClose?: () => void;
    appConfig?: AppConfig;
    onAppConfigUpdate?: (config: AppConfig) => void;
}

export const SFTPBrowser: FC<Props> = ({ id, config, visible, onEditConfig, onClose, appConfig, onAppConfigUpdate }) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    const contentRef = useRef<HTMLDivElement>(null);

    const [isProcessing, setIsProcessing] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const dragCounter = useRef(0);

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

    const directory = useSftpDirectory(
        id,
        connection.rawStatusRef,
        connection.tRef,
        activeUploads,
        setSelectedFilenamesProxy,
        setLastSelectedIndexProxy
    );

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

    const startUpload = useCallback(async (items: UploadCandidate[], options: StartUploadOptions = {}) => {
        if (items.length === 0) return;

        const newTransfers: Transfer[] = items.map(c => {
            transfers.clearTransferCancellation(c.transferId);
            return {
                id: c.transferId,
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
                remoteDir: directory.path,
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
    }, [id, directory, transfers]);

    const requestUpload = useCallback(async (items: UploadCandidate[], options: StartUploadOptions = {}) => {
        const existingNames = new Set(directory.files.map(f => f.filename));
        const existingItems = items.filter(i => existingNames.has(i.filename));

        if (existingItems.length === 0) {
            await startUpload(items, options);
            return;
        }

        pendingUploadContextRef.current = { items, options };
        setModal({
            type: 'overwriteConfirm',
            fileUpdates: existingItems.map(i => ({
                localPath: i.localPath,
                remotePath: i.remotePath,
                filename: i.filename,
                selected: true,
                isDir: i.isDir
            }))
        });
    }, [directory.files, startUpload]);

    const handleSkipOverwrite = useCallback(() => {
        const context = pendingUploadContextRef.current;
        pendingUploadContextRef.current = null;
        const existingRemotePaths = new Set((modal?.fileUpdates || []).map(u => u.remotePath));
        const freshItems = (context?.items || []).filter(i => !existingRemotePaths.has(i.remotePath));
        setModal(null);
        void startUpload(freshItems, context?.options);
    }, [modal?.fileUpdates, startUpload]);

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
        void startUpload(context.items, context.options);
    }, [startUpload]);

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
        setIsDragging(false);
        dragCounter.current = 0;
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length === 0) return;

        const droppedFilesWithPaths = await Promise.all(droppedFiles.map(async f => {
            const localPath = ipcRenderer?.getPathForFile?.(f);
            if (!localPath) return null;
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
            remotePath: normalizeRemotePath(`${directory.path}/${f.name}`),
            transferId: crypto.randomUUID(),
            size: f.size,
            isDir: f.isDir
        }));

        await requestUpload(candidates, { pendingDeletesOnError: true, showErrorModal: false });
    }, [directory.path, requestUpload]);

    const handleGoHome = useCallback(() => {
        void directory.loadDirectory('/');
    }, [directory]);
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

    return (
        <div
            className={`sftp-container ${isDragging ? 'dragging' : ''}`}
            onDragEnter={(e) => {
                e.preventDefault();
                dragCounter.current++;
                if (e.dataTransfer.items.length > 0) {
                    e.dataTransfer.dropEffect = 'copy';
                    setIsDragging(true);
                }
            }}
            onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            }}
            onDragLeave={(e) => {
                e.preventDefault();
                dragCounter.current--;
                if (dragCounter.current === 0) setIsDragging(false);
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
                        top: '10px',
                        left: '10px',
                        right: '10px',
                        bottom: '10px',
                        background: 'rgba(0,0,0,0.1)',
                        border: `3px dashed var(--primary-color)`,
                        borderRadius: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '20px',
                        zIndex: 1000,
                        pointerEvents: 'none',
                        backdropFilter: 'blur(2px)'
                    }}>
                        <div style={{
                            background: 'var(--bg-color)',
                            padding: '40px',
                            borderRadius: '20px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '15px',
                            boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
                            color: primaryRed
                        }}>
                            <UploadCloud size={64} strokeWidth={1.5} />
                            <div style={{ fontWeight: 'bold', fontSize: '1.2em' }}>{t('sftp.uploading')}</div>
                        </div>
                    </div>
                )}
                <SftpToolbar path={directory.path} loading={directory.loading} refreshing={directory.isRefreshing} showHidden={directory.showHidden} hasHiddenFiles={directory.hasHiddenFiles} onGoHome={handleGoHome} onToggleHidden={handleToggleHidden} onRefresh={handleRefresh} onUpload={handleUpload} onNavigate={directory.loadDirectory} appConfig={appConfig} />

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
                                            <div className="server-name" style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)' }}>{config.name || config.host}</div>
                                            <div className="server-address" style={{ fontSize: '14px', opacity: 0.7, color: 'var(--text-secondary)' }}>SFTP {config.host}:{config.port}</div>
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

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--accent)', fontWeight: 600, fontSize: '16px', marginTop: '10px' }}>
                                            <Loader2 size={20} className="spin" />
                                            {connection.displayStatus}
                                        </div>

                                        <div className="connection-actions" style={{ width: '100%', display: 'flex', justifyContent: 'flex-start', marginTop: '10px' }}>
                                            {onClose && (
                                                <button onClick={onClose} className="btn-secondary" style={{ padding: '12px 32px', fontSize: '15px', background: 'rgba(255,255,255,0.05)', fontWeight: 600 }}>
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
                                            <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                                                {connection.displayStatus}
                                            </div>
                                            {connection.countdown !== null && !connection.isAuthFailed && (
                                                <div style={{ fontSize: '14px', opacity: 0.7, fontWeight: 500 }}>
                                                    {t('terminal.reconnectIn', { n: connection.countdown.toString() })}
                                                </div>
                                            )}
                                        </div>

                                        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', width: '100%' }}>
                                            {onClose && (
                                                <button onClick={onClose} className="btn-secondary" style={{ padding: '12px 28px', fontSize: '14px' }}>
                                                    {t('common.close')}
                                                </button>
                                            )}
                                            {onEditConfig && (
                                                <button
                                                    onClick={() => onEditConfig(config)}
                                                    className="btn-secondary"
                                                    style={{ padding: '12px 28px', fontSize: '14px' }}
                                                >
                                                    {t('common.edit')}
                                                </button>
                                            )}
                                            <button
                                                onClick={connection.connect}
                                                className="btn-primary"
                                                style={{ padding: '12px 28px', fontSize: '14px' }}
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
                        selectedFilenames={selection.selectedFilenames}
                        onFileClick={selection.handleFileClick}
                        onFileDoubleClick={handleFileDoubleClick}
                        onFileContextMenu={handleFileContextMenu}
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
                                    void navigator.clipboard.writeText(fullPath);
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
                            void navigator.clipboard.writeText(directory.path);
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
                        void startUpload(confirmedItems, context.options);
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
                                        transferId
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
