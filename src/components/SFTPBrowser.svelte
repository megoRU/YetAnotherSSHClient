<script module lang="ts">
    import { startDrag } from '@crabnebula/tauri-plugin-drag';

    import {
        Archive,
        Copy,
        Download,
        SquarePen,
        MousePointer2,
        RefreshCw,
        Shield,
        Trash2,
        CloudUpload,
        Folder,
        Plug,
        LoaderCircle,
    } from '@lucide/svelte';

    import ContextMenu from './layout/ContextMenu.svelte';

    import SftpToolbar from './sftp/SftpToolbar.svelte';

    import SftpFileList from './sftp/SftpFileList.svelte';

    import SftpTransferPanel from './sftp/SftpTransferPanel.svelte';

    import SftpModals from './sftp/SftpModals.svelte';

    import type {
        AppConfig,
        PendingFileUpdate,
        PendingUploadContext,
        SftpFileEntry,
        SSHConfig,
        StartUploadOptions,
        Transfer,
        UploadCandidate,
    } from '../types';

    import { normalizeRemotePath, getOSIcon } from '../utils';

    import { copyToClipboard } from '../utils/clipboard';

    import { createI18n } from '../utils/i18n';

    import { useSftpConnection } from '../hooks/sftp/useSftpConnection.svelte';

    import { useSftpTransfers } from '../hooks/sftp/useSftpTransfers.svelte';

    import { useFingerprintPrompt } from '../hooks/useFingerprintPrompt.svelte';

    import SshFingerprintModal from './modals/SshFingerprintModal.svelte';

    import { useSftpDirectory, type ActiveUploadPlaceholder } from '../hooks/sftp/useSftpDirectory.svelte';

    import { useSftpSelection } from '../hooks/sftp/useSftpSelection.svelte';

    import { useSftpEvents } from '../hooks/sftp/useSftpEvents.svelte';

    import { untrack } from 'svelte';

    import { type Dispatch, type RefObject, type SetStateAction, inlineStyle } from '../utils/dom';

    const { ipcRenderer } = window;

    interface SftpDragPreviewItem {
        filename: string;
        isDirectory: boolean;
        iconData: string | null;
    }

    async function createSftpDragIcon(items: SftpDragPreviewItem[]): Promise<string> {
        const loadedIcons = await Promise.all(
            items.map(async (item) => {
                if (!item.iconData) return null;
                const icon = new Image();
                icon.src = item.iconData;
                await new Promise<void>((resolve) => {
                    icon.onload = () => resolve();
                    icon.onerror = () => resolve();
                });
                return icon.naturalWidth > 0 ? icon : null;
            }),
        );

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
</script>

<script lang="ts">
    let {
        id,
        config,
        visible,
        onEditConfig,
        onClose,
        appConfig,
        onAppConfigUpdate,
        onSftpDefaultDirectoryChange,
    }: Props = $props();

    const { t } = $derived(createI18n(appConfig?.language || 'ru'));

    const contentRef: RefObject<HTMLDivElement | null> = $state({ current: null });

    let isProcessing = $state.raw(false);

    let isDragging = $state.raw(false);
    function setIsDragging(next: SetStateAction<typeof isDragging>) {
        isDragging = typeof next === 'function' ? next(isDragging) : next;
    }

    let draggingFilenames = $state.raw<string[]>([]);

    let dropTargetPath = $state.raw<string | null>(null);

    const dragCounter = { current: 0 };

    const outboundDragTempDirectoriesRef = { current: new Set<string>() };

    const outboundDragActiveRef = { current: false };

    const isOutboundDragPath = (path: string) => {
        const normalizePath = (value: string) =>
            value
                .replace(/^\\\\\?\\/, '')
                .replace(/[\\/]+$/, '')
                .toLowerCase();
        const normalizedPath = normalizePath(path);
        return [...outboundDragTempDirectoriesRef.current].some((directory) => {
            const normalizedDirectory = normalizePath(directory);
            return (
                normalizedPath === normalizedDirectory ||
                normalizedPath.startsWith(`${normalizedDirectory}\\`) ||
                normalizedPath.startsWith(`${normalizedDirectory}/`)
            );
        });
    };

    const pendingUploadContextRef: RefObject<PendingUploadContext | null> = { current: null };

    let contextMenu = $state.raw<{ x: number; y: number; file?: SftpFileEntry } | null>(null);

    let modal = $state.raw<{
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
    function setModal(
        next: SetStateAction<{
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
        } | null>,
    ) {
        modal = typeof next === 'function' ? next(modal) : next;
    }

    let modalInput = $state.raw('');
    function setModalInput(next: SetStateAction<typeof modalInput>) {
        modalInput = typeof next === 'function' ? next(modalInput) : next;
    }

    const connection = useSftpConnection(
        () => id,
        () => config,
        () => appConfig?.language || 'ru',
    );

    const transfers = useSftpTransfers(
        () => id,
        () => appConfig,
    );

    const fingerprint = useFingerprintPrompt(() => id);

    const selectionRef: RefObject<{
        setSelectedFilenames: Dispatch<SetStateAction<string[]>>;
        setLastSelectedIndex: Dispatch<SetStateAction<number>>;
    }> = {
        current: {
            setSelectedFilenames: () => {},
            setLastSelectedIndex: () => {},
        },
    };

    const setSelectedFilenamesProxy: Dispatch<SetStateAction<string[]>> = (val) => {
        selectionRef.current.setSelectedFilenames(val);
    };

    const setLastSelectedIndexProxy: Dispatch<SetStateAction<number>> = (val) => {
        selectionRef.current.setLastSelectedIndex(val);
    };

    const activeUploads: ActiveUploadPlaceholder[] = $derived.by(() => {
        return transfers.activeTransfers
            .filter((t) => t.type === 'upload' && (t.status === 'active' || t.status === 'success'))
            .map((t) => ({
                filename: t.filename,
                remotePath: t.remotePath,
                isDir: t.isDir,
                size: t.size,
            }));
    });

    const directory = useSftpDirectory(
        () => id,
        connection.rawStatusRef,
        connection.tRef,
        () => activeUploads,
        setSelectedFilenamesProxy,
        setLastSelectedIndexProxy,
    );

    const resolveDropDirectory = (clientX: number, clientY: number): string => {
        const target = document
            .elementFromPoint(clientX, clientY)
            ?.closest<HTMLElement>('[data-sftp-drop-directory]');
        const filename = target?.dataset.sftpDropDirectory;
        if (!filename || !target || !contentRef.current?.contains(target)) return directory.path;
        return normalizeRemotePath(`${directory.path}/${filename}`);
    };

    const setDropTargetAtPoint = (clientX: number, clientY: number) => {
        const destination = resolveDropDirectory(clientX, clientY);
        dropTargetPath = destination === directory.path ? null : destination;
    };

    const handleEditRef: RefObject<(filename: string, openWith?: boolean) => Promise<void>> = {
        current: () => Promise.resolve(),
    };

    const { path: currentPath, loadDirectory } = $derived(directory);

    const handleFileDoubleClick = (f: SftpFileEntry) => {
        if (f.filename === '..') {
            const parts = currentPath.split('/').filter(Boolean);
            parts.pop();
            void loadDirectory('/' + parts.join('/'));
            return;
        }
        const isDir = (f.attrs.mode & 0o170000) === 0o040000;
        const isLink = (f.attrs.mode & 0o170000) === 0o120000;
        if (isDir || isLink) {
            const isTargetDir = isLink && f.targetAttrs ? (f.targetAttrs.mode & 0o170000) === 0o040000 : isDir;
            if (isTargetDir) {
                void loadDirectory(
                    currentPath === '/' ? `/${f.filename}` : `${currentPath}/${f.filename}`.replace(/\/+/g, '/'),
                );
            } else {
                void handleEditRef.current(f.filename);
            }
        } else void handleEditRef.current(f.filename);
    };

    const selection = useSftpSelection(() => directory.displayFileList, contentRef, handleFileDoubleClick);

    const handleFileDragStart = async (event: DragEvent, file: SftpFileEntry) => {
        event.preventDefault();
        if (file.filename === '..' || !ipcRenderer?.sftpDownloadForDrag || !ipcRenderer?.sftpCleanupDragFiles)
            return;

        const selectedFiles = selection.selectedFilenames.includes(file.filename)
            ? directory.displayFileList.filter((entry) => selection.selectedFilenames.includes(entry.filename))
            : [file];
        const groupId = selectedFiles.length > 1 ? `sftp-drag-${crypto.randomUUID()}` : undefined;
        draggingFilenames = selectedFiles.map((entry) => entry.filename);
        let tempDirectory: string | null = null;
        let previewStarted = false;
        const deferDownloadUntilDrop =
            ipcRenderer.platform === 'win32' &&
            typeof ipcRenderer.sftpPrepareDrag === 'function' &&
            typeof ipcRenderer.sftpStartDrag === 'function';
        try {
            const dragPayload = {
                id,
                files: selectedFiles.map((entry) => ({
                    remotePath: normalizeRemotePath(`${directory.path}/${entry.filename}`),
                    filename: entry.filename,
                    transferId: crypto.randomUUID(),
                    isDir: (entry.attrs.mode & 0o170000) === 0o040000,
                })),
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
                iconData: staged.icons[index] ?? null,
            }));
            window.dispatchEvent(new CustomEvent('yash-sftp-outbound-drag-state', { detail: true }));
            previewStarted = true;
            const dragIcon = await createSftpDragIcon(dragPreviewItems);
            if (deferDownloadUntilDrop) {
                await ipcRenderer.sftpStartDrag({
                    ...dragPayload,
                    groupId,
                    icon: dragIcon,
                });
            } else {
                await startDrag({ item: staged.paths, icon: dragIcon, mode: 'copy' }, () => undefined);
            }
        } catch (error) {
            setModal({ type: 'error', errorMessage: error instanceof Error ? error.message : String(error) });
        } finally {
            if (previewStarted)
                window.dispatchEvent(new CustomEvent('yash-sftp-outbound-drag-state', { detail: false }));
            draggingFilenames = [];
            if (tempDirectory) {
                const directoryToForget = tempDirectory;
                window.setTimeout(() => outboundDragTempDirectoriesRef.current.delete(directoryToForget), 5000);
                await ipcRenderer.sftpCleanupDragFiles(tempDirectory);
            }
        }
    };

    $effect(() => {
        void [selection.setSelectedFilenames, selection.setLastSelectedIndex];
        return untrack(() => {
            selectionRef.current.setSelectedFilenames = selection.setSelectedFilenames;
            selectionRef.current.setLastSelectedIndex = selection.setLastSelectedIndex;
        });
    });

    useSftpEvents({
        get id() {
            return id;
        },
        get config() {
            return config;
        },
        get connect() {
            return connection.connect;
        },
        get rawStatusRef() {
            return connection.rawStatusRef;
        },
        get setStatus() {
            return connection.setStatus;
        },
        get wasConnectedRef() {
            return connection.wasConnectedRef;
        },
        get isConnectingRef() {
            return connection.isConnectingRef;
        },
        get pendingDeletesRef() {
            return transfers.pendingDeletesRef;
        },
        get loadDirectory() {
            return directory.loadDirectory;
        },
        get setError() {
            return connection.setError;
        },
        get setLoading() {
            return directory.setLoading;
        },
        get setStatusKind() {
            return connection.setStatusKind;
        },
        get setErrorKind() {
            return connection.setErrorKind;
        },
        get cancelledTransferIdsRef() {
            return transfers.cancelledTransferIdsRef;
        },
        get setActiveTransfers() {
            return transfers.setActiveTransfers;
        },
        get setModal() {
            return setModal;
        },
        get enqueueProgressUpdate() {
            return transfers.enqueueProgressUpdate;
        },
        get notifyTransferSuccess() {
            return transfers.notifyTransferSuccess;
        },
        get throttleTimerRef() {
            return transfers.throttleTimerRef;
        },
        get tRef() {
            return connection.tRef;
        },
    });

    const handleDownload = async (filenames: string[]) => {
        if (filenames.length === 0) return;
        const transfersToPrepare = filenames.map((filename) => {
            const file = directory.files.find((f) => f.filename === filename);
            const remotePath = normalizeRemotePath(`${directory.path}/${filename}`);
            const transferId = crypto.randomUUID();
            transfers.clearTransferCancellation(transferId);
            const isDir = file ? (file.attrs.mode & 0o170000) === 0o040000 : false;

            return {
                id: transferId,
                filename,
                remotePath,
                size: file?.attrs.size,
                isDir,
            };
        });

        try {
            let res: unknown = null;
            if (filenames.length === 1) {
                res = await ipcRenderer?.sftpDownloadFile?.(
                    {
                        id,
                        remotePath: `${directory.path}/${filenames[0]}`.replace(/\/+/g, '/'),
                        filename: filenames[0],
                        transferId: transfersToPrepare[0].id,
                    },
                    t('sftp.download'),
                );
            } else {
                res = await ipcRenderer?.sftpDownloadMultiple?.({
                    id,
                    files: transfersToPrepare.map((t) => ({
                        filename: t.filename,
                        remotePath: t.remotePath,
                        transferId: t.id,
                        isDir: t.isDir,
                    })),
                });
            }

            if (res === null) {
                return;
            }

            transfers.notifyTransferSuccess();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (
                message.includes('No response from server') ||
                message.includes('closed') ||
                message.includes('destroyed')
            ) {
                transfers.setActiveTransfers((prev) =>
                    prev.map((t) =>
                        transfersToPrepare.find((nt) => nt.id === t.id)
                            ? {
                                  ...t,
                                  status: 'cancelled',
                              }
                            : t,
                    ),
                );
            } else {
                transfers.setActiveTransfers((prev) =>
                    prev.map((t) =>
                        transfersToPrepare.find((nt) => nt.id === t.id)
                            ? {
                                  ...t,
                                  status: 'error',
                                  error: message,
                              }
                            : t,
                    ),
                );
            }
        }
    };

    const startUpload = async (
        items: UploadCandidate[],
        options: StartUploadOptions = {},
        remoteDir = directory.path,
    ) => {
        if (items.length === 0) return;
        const groupId = items.length > 1 ? crypto.randomUUID() : undefined;

        const newTransfers: Transfer[] = items.map((c) => {
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
                isDir: c.isDir,
            };
        });

        transfers.setActiveTransfers((prev) => [...newTransfers, ...prev]);

        try {
            await ipcRenderer?.sftpUploadFilesFromPaths?.({
                id,
                remoteDir,
                groupId,
                deleteRemotePartialOnCancel: appConfig?.sftpDeletePartialOnCancel ?? false,
                transfers: newTransfers.map((t, idx) => ({
                    localPath: items[idx].localPath,
                    transferId: t.id,
                })),
            });
            transfers.notifyTransferSuccess();
            void directory.loadDirectory(directory.pathRef.current);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (
                message.includes('No response from server') ||
                message.includes('closed') ||
                message.includes('destroyed')
            ) {
                transfers.setActiveTransfers((prev) =>
                    prev.map((t) =>
                        newTransfers.find((nt) => nt.id === t.id)
                            ? {
                                  ...t,
                                  status: 'cancelled',
                              }
                            : t,
                    ),
                );
                return;
            }
            if (options.pendingDeletesOnError) {
                transfers.addPendingDeletes(newTransfers.map((u) => u.remotePath));
            }
            transfers.setActiveTransfers((prev) =>
                prev.map((t) =>
                    newTransfers.find((nt) => nt.id === t.id)
                        ? {
                              ...t,
                              status: 'error',
                              error: message,
                          }
                        : t,
                ),
            );
            if (options.showErrorModal !== false) {
                setModal({ type: 'error', errorMessage: message });
            }
        }
    };

    const requestUpload = async (
        items: UploadCandidate[],
        options: StartUploadOptions = {},
        remoteDir = directory.path,
    ) => {
        let targetFiles: SftpFileEntry[] | null | undefined;
        try {
            targetFiles =
                remoteDir === directory.path
                    ? directory.files
                    : await ipcRenderer?.sftpReaddir?.({ id, path: remoteDir });
        } catch (err: unknown) {
            setModal({
                type: 'error',
                errorMessage: err instanceof Error ? err.message : String(err),
            });
            return;
        }
        if (!targetFiles) {
            setModal({ type: 'error', errorMessage: t('errors.readdirError', { message: '' }) });
            return;
        }
        const existingNames = new Set(targetFiles.map((file) => file.filename));
        const existingItems = items.filter((i) => existingNames.has(i.filename));

        if (existingItems.length === 0) {
            await startUpload(items, options, remoteDir);
            return;
        }

        pendingUploadContextRef.current = { items, options, remoteDir };
        const freshItems = items.filter((i) => !existingNames.has(i.filename));
        if (freshItems.length > 0) void startUpload(freshItems, options, remoteDir);
        setModal({
            type: 'overwriteConfirm',
            fileUpdates: existingItems.map((i) => ({
                localPath: i.localPath,
                remotePath: i.remotePath,
                filename: i.filename,
                // При единственном конфликтующем файле выбор однозначен.
                // Для нескольких файлов оставляем ручной выбор.
                selected: existingItems.length === 1,
                isDir: i.isDir,
            })),
        });
    };

    const handleSkipOverwrite = () => {
        pendingUploadContextRef.current = null;
        setModal(null);
    };

    const handleModalClose = () => {
        if (modal?.type === 'overwriteConfirm') {
            pendingUploadContextRef.current = null;
        }
        setModal(null);
    };

    const handleReplaceAllOverwrite = () => {
        const context = pendingUploadContextRef.current;
        pendingUploadContextRef.current = null;
        setModal(null);
        if (!context) return;
        const existingRemotePaths = new Set((modal?.fileUpdates || []).map((u) => u.remotePath));
        const existingItems = context.items.filter((item) => existingRemotePaths.has(item.remotePath));
        void startUpload(existingItems, context.options, context.remoteDir);
    };

    const handleUpload = async (mode: 'file' | 'folder') => {
        try {
            const selectedFiles = (await ipcRenderer?.sftpSelectFiles?.(mode)) as
                { path: string; name: string; size: number; isDir?: boolean }[] | null;
            if (!selectedFiles || selectedFiles.length === 0) return;

            const candidates: UploadCandidate[] = selectedFiles.map((f) => ({
                localPath: f.path,
                filename: f.name,
                remotePath: normalizeRemotePath(`${directory.path}/${f.name}`),
                transferId: crypto.randomUUID(),
                size: f.size,
                isDir: f.isDir,
            }));

            await requestUpload(candidates, { showErrorModal: true });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({ type: 'error', errorMessage: message });
        }
    };

    const handleCreateDirectory = async () => {
        if (!modalInput) return;
        const nameExists = directory.files.some((f) => f.filename.toLowerCase() === modalInput.toLowerCase());
        if (nameExists) {
            setModal({ type: 'error', errorMessage: t('errors.folderAlreadyExists', { name: modalInput }) });
            return;
        }
        try {
            await ipcRenderer?.sftpMkdir?.({
                id,
                path: `${directory.path}/${modalInput}`.replace(/\/+/g, '/'),
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
    };

    const getApplicationName = (applicationPath: string): string => {
        const normalizedApplicationPath = applicationPath.replace(/\\/g, '/');
        const applicationPathParts = normalizedApplicationPath.split('/');
        const applicationFileName =
            applicationPathParts.length > 0
                ? applicationPathParts[applicationPathParts.length - 1]
                : applicationPath;
        if (applicationFileName.toLowerCase().endsWith('.exe')) {
            return applicationFileName.substring(0, applicationFileName.length - 4);
        }
        return applicationFileName;
    };

    const handleEdit = async (filename: string, openWith = false) => {
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
                applicationName: getApplicationName(applicationPath),
            });
            return;
        }
        const file = directory.files.find((f) => f.filename === filename);
        const transferId = crypto.randomUUID();
        transfers.clearTransferCancellation(transferId);
        const newTransfer: Transfer = {
            id: transferId,
            filename,
            remotePath,
            progress: 0,
            size: file?.attrs.size,
            type: 'download',
            status: 'active' as const,
        };
        transfers.setActiveTransfers((prev) => [newTransfer, ...prev]);

        try {
            const extension = filename.includes('.')
                ? filename.slice(filename.lastIndexOf('.')).toLowerCase()
                : '';
            const applicationPath = appConfig?.fileAssociations?.[extension] ?? '';
            const result = await ipcRenderer?.sftpOpenInEditor?.({
                id,
                remotePath,
                filename,
                transferId,
                missingApplicationTitle: connection.tRef.current('sftp.fileAssociationUnavailableTitle'),
                missingApplicationMessage: connection.tRef.current('sftp.fileAssociationUnavailableMessage', {
                    extension,
                    applicationPath,
                }),
            });

            if (result === null) {
                transfers.setActiveTransfers((prev) => prev.filter((t) => t.id !== transferId));
            } else if (!result) {
                const message = connection.tRef.current('errors.selectedAppNotFound');
                transfers.setActiveTransfers((prev) =>
                    prev.map((t) => (t.id === newTransfer.id ? { ...t, status: 'error', error: message } : t)),
                );
                setModal({ type: 'error', errorMessage: message });
                return;
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (
                message.includes('No response from server') ||
                message.includes('destroyed') ||
                message.includes('closed')
            ) {
                transfers.setActiveTransfers((prev) =>
                    prev.map((t) => (t.id === newTransfer.id ? { ...t, status: 'cancelled' } : t)),
                );
            } else {
                setModal({ type: 'error', errorMessage: message });
                transfers.setActiveTransfers((prev) =>
                    prev.map((t) => (t.id === newTransfer.id ? { ...t, status: 'error', error: message } : t)),
                );
            }
        }
    };

    $effect(() => {
        void [handleEdit];
        return untrack(() => {
            handleEditRef.current = handleEdit;
        });
    });

    const requestDelete = (fallback?: SftpFileEntry) => {
        const selectedItems = directory.files.filter(
            (file) =>
                selection.selectedFilenames.includes(file.filename) &&
                (directory.showHidden || !file.filename.startsWith('.')),
        );
        const candidates = selectedItems.length > 0 ? selectedItems : fallback ? [fallback] : [];
        const items = candidates.filter((file) => file.filename !== '.' && file.filename !== '..');
        if (items.length > 0) {
            setModal({ type: 'delete', selectedFiles: items });
        }
    };

    const handleDelete = async () => {
        const items = modal?.selectedFiles || (modal?.file ? [modal.file] : []);
        isProcessing = true;
        try {
            const removedPaths: string[] = [];
            for (const file of items) {
                const fullPath = `${directory.path}/${file.filename}`.replace(/\/+/g, '/');
                await ipcRenderer?.sftpRm?.({
                    id,
                    path: fullPath,
                    isDir: (file.attrs.mode & 0o040000) !== 0,
                });
                removedPaths.push(normalizeRemotePath(fullPath));
            }

            transfers.setActiveTransfers((prev) =>
                prev.filter((t) => !removedPaths.includes(normalizeRemotePath(t.remotePath))),
            );

            setModal(null);
            void directory.loadDirectory(directory.path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({ type: 'error', errorMessage: message });
        } finally {
            isProcessing = false;
        }
    };

    const handleRename = async () => {
        if (!modal?.file || !modalInput) return;
        try {
            const oldPath = `${directory.path}/${modal.file.filename}`.replace(/\/+/g, '/');
            await ipcRenderer?.sftpRename?.({
                id,
                oldPath,
                newPath: `${directory.path}/${modalInput}`.replace(/\/+/g, '/'),
            });

            const normalizedOldPath = normalizeRemotePath(oldPath);
            transfers.setActiveTransfers((prev) =>
                prev.filter((t) => normalizeRemotePath(t.remotePath) !== normalizedOldPath),
            );

            setModal(null);
            void directory.loadDirectory(directory.path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({ type: 'error', errorMessage: message });
        }
    };

    const handlePermissions = async () => {
        const items = modal?.selectedFiles || (modal?.file ? [modal.file] : []);
        if (items.length === 0 || !modalInput) return;
        isProcessing = true;
        try {
            const mode = parseInt(modalInput, 8);
            for (const file of items) {
                await ipcRenderer?.sftpChmod?.({
                    id,
                    path: `${directory.path}/${file.filename}`.replace(/\/+/g, '/'),
                    mode,
                });
            }
            setModal(null);
            void directory.loadDirectory(directory.path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({ type: 'error', errorMessage: message });
        } finally {
            isProcessing = false;
        }
    };

    const handleDrop = async (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Своя передача, перетаскиваемая наружу: у виртуальных файлов нет локального
        // пути, приём их обратно не выполняется. Штатно такой drop отменяет источник
        // перетаскивания (см. `QueryContinueDrag` в `vendor/dragout`); проверка
        // оставлена на случай гонки состояния.
        if (outboundDragActiveRef.current) return;
        const remoteDir = resolveDropDirectory(e.clientX, e.clientY);
        setIsDragging(false);
        dropTargetPath = null;
        dragCounter.current = 0;
        const droppedFiles = Array.from(e.dataTransfer?.files ?? []);
        if (droppedFiles.length === 0) return;

        const droppedFilesWithPaths = await Promise.all(
            droppedFiles.map(async (f) => {
                const localPath = ipcRenderer?.getPathForFile?.(f);
                if (!localPath || isOutboundDragPath(localPath)) return null;
                const stats = (await ipcRenderer?.fsStat?.(localPath)) as { size: number; isDir: boolean } | null;
                return {
                    name: f.name,
                    size: stats?.size || 0,
                    path: localPath,
                    isDir: stats?.isDir || false,
                };
            }),
        );

        const validDroppedFiles = droppedFilesWithPaths.filter((f): f is NonNullable<typeof f> => f !== null);
        if (validDroppedFiles.length === 0) return;

        const candidates: UploadCandidate[] = validDroppedFiles.map((f) => ({
            localPath: f.path,
            filename: f.name,
            remotePath: normalizeRemotePath(`${remoteDir}/${f.name}`),
            transferId: crypto.randomUUID(),
            size: f.size,
            isDir: f.isDir,
        }));

        await requestUpload(candidates, { pendingDeletesOnError: true, showErrorModal: false }, remoteDir);
    };

    const handleNativeFilesDropped = async (paths: string[], clientX: number, clientY: number) => {
        const remoteDir = resolveDropDirectory(clientX, clientY);
        setIsDragging(false);
        dropTargetPath = null;
        dragCounter.current = 0;
        const incomingPaths = paths.filter((path) => !isOutboundDragPath(path));
        if (!visible || incomingPaths.length === 0) return;

        try {
            const candidates = await Promise.all(
                incomingPaths.map(async (localPath): Promise<UploadCandidate | null> => {
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
                        isDir: stats.isDir,
                    };
                }),
            );
            const validCandidates = candidates.filter(
                (candidate): candidate is UploadCandidate => candidate !== null,
            );
            if (validCandidates.length > 0) {
                await requestUpload(
                    validCandidates,
                    { pendingDeletesOnError: true, showErrorModal: false },
                    remoteDir,
                );
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({ type: 'error', errorMessage: message });
        }
    };

    $effect(() => {
        void [handleNativeFilesDropped, setDropTargetAtPoint, visible];
        return untrack(() => {
            const handleOutboundDragState = (event: Event) => {
                const isActive = (event as CustomEvent<boolean>).detail;
                outboundDragActiveRef.current = isActive;
                if (!isActive) {
                    setIsDragging(false);
                    dragCounter.current = 0;
                    dropTargetPath = null;
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
                    dropTargetPath = null;
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
        });
    });

    const handleGoHome = () => {
        void directory.loadDirectory('/');
    };

    const handleSetDefaultDirectory = () => {
        const defaultDirectory = normalizeRemotePath(directory.path);
        const nextDefaultDirectory = config.sftpDefaultDirectory === defaultDirectory ? null : defaultDirectory;
        if (onSftpDefaultDirectoryChange) {
            onSftpDefaultDirectoryChange(nextDefaultDirectory);
            return;
        }
        if (!appConfig || !onAppConfigUpdate || !config.id) return;
        onAppConfigUpdate({
            ...appConfig,
            favorites: appConfig.favorites.map((favorite) => {
                if (favorite.id !== config.id) return favorite;
                const updated = { ...favorite };
                if (nextDefaultDirectory) updated.sftpDefaultDirectory = nextDefaultDirectory;
                else delete updated.sftpDefaultDirectory;
                return updated;
            }),
        });
    };

    const handleRefresh = async () => {
        directory.setIsRefreshing(true);
        const minSpinPromise = new Promise((resolve) => setTimeout(resolve, 500));
        try {
            await directory.loadDirectory(directory.path, true);
        } finally {
            await minSpinPromise;
            directory.setIsRefreshing(false);
        }
    };

    const { selectedFilenames, setSelectedFilenames, setLastSelectedIndex } = $derived(selection);

    const { files, sortField, setSortField, setSortDirection } = $derived(directory);

    const handleFileContextMenu = (e: MouseEvent, f: SftpFileEntry) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedFilenames.includes(f.filename)) {
            setSelectedFilenames([f.filename]);
            setLastSelectedIndex(files.findIndex((x) => x.filename === f.filename));
        }

        contextMenu = {
            x: e.clientX,
            y: e.clientY,
            file: f,
        };
    };

    const handleSort = (field: 'name' | 'size' | 'mtime' | 'type') => {
        if (sortField === field) {
            setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortField(field);
            setSortDirection(field === 'mtime' ? 'desc' : 'asc');
        }
    };

    const handleToggleHidden = () => {
        directory.setShowHidden((prev) => !prev);
    };

    const handleOpenWithRemember = async (): Promise<void> => {
        const request = modal;
        const rememberAssociation = modalInput === 'true';
        if (!request || !request.filename || !request.remotePath || !request.applicationPath) {
            setModal(null);
            return;
        }
        const transferId = crypto.randomUUID();
        const file = directory.files.find((currentFile) => currentFile.filename === request.filename);
        const newTransfer: Transfer = {
            id: transferId,
            filename: request.filename,
            remotePath: request.remotePath,
            progress: 0,
            size: file?.attrs.size,
            type: 'download',
            status: 'active' as const,
        };
        transfers.setActiveTransfers((previousTransfers) => [newTransfer, ...previousTransfers]);
        try {
            const result = await ipcRenderer?.sftpOpenWith?.({
                id,
                remotePath: request.remotePath,
                filename: request.filename,
                transferId,
                applicationPath: request.applicationPath,
                rememberAssociation: rememberAssociation,
            });
            if (result === null) {
                transfers.setActiveTransfers((previousTransfers) =>
                    previousTransfers.filter((transfer) => transfer.id !== transferId),
                );
            }
            if (rememberAssociation) {
                const updatedConfig = (await ipcRenderer?.getConfig?.()) as AppConfig | undefined;
                if (updatedConfig && onAppConfigUpdate) {
                    onAppConfigUpdate(updatedConfig);
                }
            }
            setModal(null);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({ type: 'error', errorMessage: message });
            transfers.setActiveTransfers((previousTransfers) =>
                previousTransfers.map((transfer) => {
                    if (transfer.id === transferId) {
                        return { ...transfer, status: 'error', error: message };
                    }
                    return transfer;
                }),
            );
        }
    };

    const primaryRed = 'var(--primary-color)';
</script>

{#if fingerprint.challenge}<div
        style={inlineStyle({
            position: 'relative',
            width: '100%',
            height: '100%',
            display: visible ? 'block' : 'none',
            // Фон совпадает с фоном вкладки: показывается только окно, и
            // под ним не должно просвечивать содержимое браузера файлов.
            background: 'var(--bg-color)',
        })}
    >
        {#key fingerprint.challenge.fingerprint}<SshFingerprintModal
                challenge={fingerprint.challenge}
                server={config}
                {appConfig}
                onAccept={fingerprint.accept}
                onReject={() => {
                    fingerprint.reject();
                    onClose?.();
                }}
            />{/key}
    </div>{:else}<div
        role="presentation"
        class={`sftp-container ${isDragging ? 'dragging' : ''}`}
        ondragenter={(e) => {
            e.preventDefault();
            if (!e.dataTransfer) return;
            // Своя же передача наружу: над окном приложения она копируется дальше,
            // поэтому цель остаётся принимающей («copy») — иначе Windows показал бы
            // запрещающий курсор, — но приём файлов из неё не предлагается.
            if (outboundDragActiveRef.current) {
                e.dataTransfer.dropEffect = 'copy';
                return;
            }
            dragCounter.current++;
            if (e.dataTransfer.items.length > 0) {
                e.dataTransfer.dropEffect = 'copy';
                setIsDragging(true);
                setDropTargetAtPoint(e.clientX, e.clientY);
            }
        }}
        ondragover={(e) => {
            e.preventDefault();
            if (!e.dataTransfer) return;
            e.dataTransfer.dropEffect = 'copy';
            if (outboundDragActiveRef.current) return;
            setDropTargetAtPoint(e.clientX, e.clientY);
        }}
        ondragleave={(e) => {
            e.preventDefault();
            if (outboundDragActiveRef.current) return;
            dragCounter.current--;
            if (dragCounter.current <= 0) {
                dragCounter.current = 0;
                setIsDragging(false);
                dropTargetPath = null;
            }
        }}
        ondrop={handleDrop}
        onclick={() => {
            selection.setSelectedFilenames([]);
            selection.setLastSelectedIndex(-1);
        }}
        style={inlineStyle({
            display: visible ? 'flex' : 'none',
            flexDirection: 'row',
            height: '100%',
            width: '100%',
            background: 'var(--bg-color)',
            color: 'var(--text-color)',
            userSelect: 'none',
            position: 'relative',
        })}
    >
        <div style="flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative">
            {#if isDragging}<div
                    style={inlineStyle({
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
                    })}
                >
                    <CloudUpload size={20} strokeWidth={1.8} />
                    <div
                        style="min-width: 0; font-weight: 600; font-size: var(--font-size-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
                    >
                        {t('sftp.dropToUpload')}
                    </div>
                </div>{/if}
            <SftpToolbar
                path={directory.path}
                loading={directory.loading}
                refreshing={directory.isRefreshing}
                showHidden={directory.showHidden}
                hasHiddenFiles={directory.hasHiddenFiles}
                onGoHome={handleGoHome}
                onToggleHidden={handleToggleHidden}
                onRefresh={handleRefresh}
                onUpload={handleUpload}
                onNavigate={directory.loadDirectory}
                defaultDirectory={config.sftpDefaultDirectory}
                onSetDefaultDirectory={handleSetDefaultDirectory}
                {appConfig}
            />

            <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Фокусируемая область списка обрабатывает навигацию, выбор и удаление файлов с клавиатуры.) -->
            <div
                role="region"
                aria-label={t('settings.sftp')}
                class="sftp-content"
                bind:this={contentRef.current}
                tabindex={0}
                onkeydown={(event) => {
                    if (event.key !== 'Delete') {
                        selection.handleKeyDown(event);
                        return;
                    }
                    if (
                        event.target !== event.currentTarget ||
                        event.repeat ||
                        event.defaultPrevented ||
                        !visible ||
                        !connection.isConnected ||
                        directory.loading ||
                        modal ||
                        contextMenu ||
                        isProcessing
                    )
                        return;

                    event.preventDefault();
                    requestDelete();
                }}
                onclick={() => {
                    if (
                        document.activeElement?.tagName !== 'INPUT' &&
                        document.activeElement?.tagName !== 'TEXTAREA'
                    ) {
                        contentRef.current?.focus();
                    }
                }}
                oncontextmenu={(e) => {
                    e.preventDefault();
                    contextMenu = {
                        x: e.clientX,
                        y: e.clientY,
                    };
                }}
                style="flex: 1; overflow-y: auto; position: relative; scrollbar-gutter: stable; outline: none"
            >
                {#if !connection.isConnected || connection.isFailed}<div
                        class={`connection-overlay ${!connection.isFailed ? 'loading' : 'failed'}`}
                        style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: var(--bg-color); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 10; padding: 40px; text-align: center; transition: opacity 0.3s ease, visibility 0.3s"
                    >
                        <div
                            class="connection-container"
                            style="gap: 40px; padding: 48px; max-width: 550px; width: 95%"
                        >
                            <div
                                style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 20px"
                            >
                                <!-- Иконка ОС слева, название и адрес справа (как в окне удаления сервера) -->
                                <div
                                    class="server-info-card"
                                    style="display: flex; align-items: center; gap: 16px; border: none; background: transparent; padding: 0; text-align: left"
                                >
                                    <div
                                        class="os-icon-wrapper"
                                        style="width: 48px; height: 48px; padding: 0; flex-shrink: 0; background: transparent"
                                    >
                                        <img
                                            src={getOSIcon(config.osPrettyName)}
                                            alt="OS"
                                            style="width: 100%; height: 100%; object-fit: contain"
                                            draggable="false"
                                        />
                                    </div>
                                    <div class="server-details" style="text-align: left">
                                        <div
                                            class="server-name"
                                            style="font-size: var(--font-size-xl); font-weight: 600; color: var(--text-primary)"
                                        >
                                            {config.name || config.host}
                                        </div>
                                        <div
                                            class="server-address"
                                            style="font-size: var(--font-size-sm); opacity: 0.7; color: var(--text-secondary)"
                                        >
                                            SFTP {config.host}:{config.port}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {#if !connection.isFailed}
                                <div
                                    class="connection-path"
                                    style="position: relative; width: 100%; padding: 0 20px; height: 60px; display: flex; align-items: center; justify-content: space-between"
                                >
                                    <div
                                        style="width: 44px; height: 44px; border-radius: 50%; background: var(--accent); display: flex; align-items: center; justify-content: center; color: #fff; z-index: 2; position: relative"
                                    >
                                        <div
                                            class="loader-ring"
                                            style={inlineStyle({
                                                position: 'absolute',
                                                top: '-6px',
                                                left: '-6px',
                                                right: '-6px',
                                                bottom: '-6px',
                                                border: '4px solid var(--accent)',
                                                borderRadius: '50%',
                                                borderTopColor: 'transparent',
                                                animation: 'spin 1.5s linear infinite',
                                                opacity: connection.isConnected ? 0 : 1,
                                                transition: 'opacity 0.3s ease',
                                            })}
                                        ></div>
                                        <Plug size={24} />
                                    </div>

                                    <div
                                        class="path-line"
                                        style={inlineStyle({
                                            flex: 1,
                                            height: '2px',
                                            background: connection.isConnected ? 'var(--accent)' : 'var(--border)',
                                            margin: '0 -2px',
                                            transition: 'background 0.5s ease',
                                        })}
                                    ></div>

                                    <div
                                        style={inlineStyle({
                                            width: '44px',
                                            height: '44px',
                                            borderRadius: '50%',
                                            background: connection.isConnected
                                                ? 'var(--accent)'
                                                : 'var(--hover-surface)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: connection.isConnected ? '#fff' : 'var(--text-secondary)',
                                            zIndex: 2,
                                            border: connection.isConnected ? 'none' : '1px solid var(--border)',
                                            transition: 'all 0.5s ease',
                                        })}
                                    >
                                        <Folder size={22} />
                                    </div>
                                </div>

                                <div
                                    style="display: flex; align-items: center; gap: 12px; color: var(--accent); font-weight: 600; font-size: calc(var(--font-size-base) + 2px); margin-top: 10px"
                                >
                                    <LoaderCircle size={20} class="spin" />
                                    {connection.displayStatus}
                                </div>

                                <div
                                    class="connection-actions"
                                    style="width: 100%; display: flex; justify-content: flex-start; margin-top: 10px"
                                >
                                    {#if onClose}<button
                                            onclick={onClose}
                                            class="btn-secondary"
                                            style="padding: 12px 32px; font-size: var(--font-size-base); background: rgba(255,255,255,0.05); font-weight: 600"
                                        >
                                            {t('common.close')}
                                        </button>{/if}
                                </div>
                            {:else}<div
                                    style="display: flex; flex-direction: column; align-items: center; gap: 24px; width: 100%"
                                >
                                    <div
                                        style={inlineStyle({
                                            width: '48px',
                                            height: '48px',
                                            borderRadius: '12px',
                                            background: connection.isAuthFailed
                                                ? 'rgba(239, 68, 68, 0.1)'
                                                : connection.isClosed
                                                  ? 'rgba(255, 255, 255, 0.05)'
                                                  : 'rgba(239, 68, 68, 0.1)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: connection.isAuthFailed
                                                ? '#ef4444'
                                                : connection.isClosed
                                                  ? 'var(--text-primary)'
                                                  : '#ef4444',
                                            fontSize: '24px',
                                        })}
                                    >
                                        {#if connection.isAuthFailed}🔒{:else if connection.isClosed}🔌{:else}⚠️{/if}
                                    </div>

                                    <div
                                        style="display: flex; flex-direction: column; gap: 8px; text-align: center"
                                    >
                                        <div
                                            style="font-size: calc(var(--ui-font-size-base) + 2px); font-weight: bold; color: var(--text-primary)"
                                        >
                                            {connection.displayStatus}
                                        </div>
                                        {#if connection.countdown !== null && !connection.isAuthFailed}<div
                                                style="font-size: calc(var(--ui-font-size-base) + 1px); opacity: 0.7; font-weight: 500"
                                            >
                                                {t('terminal.reconnectIn', { n: connection.countdown.toString() })}
                                            </div>{/if}
                                    </div>

                                    <div style="display: flex; justify-content: center; gap: 12px; width: 100%">
                                        {#if onClose}<button
                                                onclick={onClose}
                                                class="btn-secondary"
                                                style="padding: 12px 28px; font-size: var(--ui-font-size-base)"
                                            >
                                                {t('common.close')}
                                            </button>{/if}
                                        {#if onEditConfig}<button
                                                onclick={() => onEditConfig(config)}
                                                class="btn-secondary"
                                                style="padding: 12px 28px; font-size: var(--ui-font-size-base)"
                                            >
                                                {t('common.edit')}
                                            </button>{/if}
                                        <button
                                            onclick={connection.connect}
                                            class="btn-primary"
                                            style="padding: 12px 28px; font-size: var(--ui-font-size-base)"
                                        >
                                            {#if connection.isClosed}{t('terminal.reconnect')}{:else}{t(
                                                    'common.connect',
                                                )}{/if}
                                        </button>
                                    </div>
                                </div>{/if}
                        </div>
                    </div>{/if}
                <SftpFileList
                    files={directory.displayFileList}
                    dropTargetFilename={dropTargetPath?.split('/').filter(Boolean).pop() || null}
                    selectedFilenames={selection.selectedFilenames}
                    {draggingFilenames}
                    onFileClick={selection.handleFileClick}
                    onFileDoubleClick={handleFileDoubleClick}
                    onFileContextMenu={handleFileContextMenu}
                    onFileDragStart={handleFileDragStart}
                    loading={directory.loading}
                    language={appConfig?.language || 'ru'}
                    sortField={directory.sortField}
                    sortDirection={directory.sortDirection}
                    onSort={handleSort}
                />
            </div>
        </div>

        <SftpTransferPanel
            activeTransfers={transfers.activeTransfers}
            progressStore={transfers.progressStore}
            {primaryRed}
            onCancelTransfer={transfers.handleCancelTransfer}
            onRemoveTransfer={transfers.removeTransfer}
            onClearFinished={transfers.clearFinishedTransfers}
            {appConfig}
        />

        {#if contextMenu}{@const menu = contextMenu}<ContextMenu
                x={menu.x}
                y={menu.y}
                onClose={() => (contextMenu = null)}
                options={[
                    ...(menu.file
                        ? [
                              ...(selection.selectedFilenames.length <= 1
                                  ? [
                                        {
                                            label:
                                                (menu.file.attrs.mode & 0o040000) !== 0 ||
                                                (menu.file.targetAttrs &&
                                                    (menu.file.targetAttrs.mode & 0o040000) !== 0)
                                                    ? t('sftp.goto')
                                                    : t('sftp.open'),
                                            icon: { component: MousePointer2, size: 14 },
                                            onClick: () => {
                                                const isDir = (menu.file!.attrs.mode & 0o170000) === 0o040000;
                                                const isLink = (menu.file!.attrs.mode & 0o170000) === 0o120000;
                                                if (isDir || isLink) {
                                                    const isTargetDir =
                                                        isLink && menu.file!.targetAttrs
                                                            ? (menu.file!.targetAttrs.mode & 0o170000) === 0o040000
                                                            : isDir;
                                                    if (isTargetDir) {
                                                        void directory.loadDirectory(
                                                            directory.path === '/'
                                                                ? `/${menu.file!.filename}`
                                                                : `${directory.path}/${menu.file!.filename}`.replace(
                                                                      /\/+/g,
                                                                      '/',
                                                                  ),
                                                        );
                                                    } else {
                                                        void handleEdit(menu.file!.filename);
                                                    }
                                                } else void handleEdit(menu.file!.filename);
                                            },
                                        },
                                        ...(!((menu.file.attrs.mode & 0o040000) !== 0) &&
                                        !(menu.file.targetAttrs && (menu.file.targetAttrs.mode & 0o040000) !== 0)
                                            ? [
                                                  {
                                                      label: t('sftp.openWith'),
                                                      icon: { component: MousePointer2, size: 14 },
                                                      onClick: () => {
                                                          void handleEdit(menu.file!.filename, true);
                                                      },
                                                  },
                                              ]
                                            : []),
                                        {
                                            label: t('sftp.rename'),
                                            icon: { component: SquarePen, size: 14 },
                                            onClick: () => {
                                                setModal({ type: 'rename', file: menu.file });
                                                setModalInput(menu.file!.filename);
                                            },
                                        },
                                        {
                                            label: t('sftp.copyPath'),
                                            icon: { component: Copy, size: 14 },
                                            onClick: () => {
                                                const fullPath =
                                                    `${directory.path}/${menu.file!.filename}`.replace(
                                                        /\/+/g,
                                                        '/',
                                                    );
                                                copyToClipboard(fullPath);
                                            },
                                        },
                                    ]
                                  : []),
                              {
                                  label: t('sftp.rights'),
                                  icon: { component: Shield, size: 14 },
                                  onClick: () => {
                                      const selectedItems = directory.files.filter((f) =>
                                          selection.selectedFilenames.includes(f.filename),
                                      );
                                      setModal({
                                          type: 'permissions',
                                          file: menu.file,
                                          selectedFiles: selectedItems.length > 0 ? selectedItems : [menu.file!],
                                      });
                                      setModalInput((menu.file!.attrs.mode & 0o777).toString(8).padStart(3, '0'));
                                  },
                              },
                              {
                                  label: t('sftp.download'),
                                  icon: { component: Download, size: 14 },
                                  onClick: () => {
                                      void handleDownload(selection.selectedFilenames);
                                  },
                              },
                              ...(!((menu.file.attrs.mode & 0o040000) !== 0) &&
                              ['.zip', '.tar', '.gz', '.tgz', '.bz2'].some((ext) =>
                                  menu.file!.filename.toLowerCase().endsWith(ext),
                              )
                                  ? [
                                        {
                                            label: t('sftp.extract'),
                                            icon: { component: Archive, size: 14 },
                                            onClick: () => {
                                                void ipcRenderer
                                                    ?.sftpExtract?.({
                                                        id,
                                                        remotePath:
                                                            `${directory.path}/${menu.file!.filename}`.replace(
                                                                /\/+/g,
                                                                '/',
                                                            ),
                                                    })
                                                    .then(() => {
                                                        void directory.loadDirectory(directory.path);
                                                    });
                                            },
                                        },
                                    ]
                                  : []),
                          ]
                        : []),
                    {
                        label: t('sftp.newFolder'),
                        icon: { component: Archive, size: 14 },
                        onClick: () => {
                            setModal({ type: 'mkdir' });
                            setModalInput('');
                        },
                    },
                    {
                        label: t('sftp.refresh'),
                        icon: { component: RefreshCw, size: 14 },
                        onClick: () => {
                            void directory.loadDirectory(directory.path);
                        },
                    },
                    {
                        label: t('sftp.copyDirPath'),
                        icon: { component: Copy, size: 14 },
                        onClick: () => {
                            copyToClipboard(directory.path);
                        },
                    },
                    ...(menu.file
                        ? [
                              {
                                  label: t('common.delete'),
                                  icon: { component: Trash2, size: 14 },
                                  danger: true,
                                  onClick: () => requestDelete(menu.file),
                              },
                          ]
                        : []),
                ]}
            />{/if}

        <SftpModals
            {modal}
            {modalInput}
            {setModalInput}
            {isProcessing}
            {appConfig}
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
                    const selectedRemotePaths = new Set(
                        (modal.fileUpdates || [])
                            .filter((update) => update.selected)
                            .map((update) => update.remotePath),
                    );
                    const confirmedItems = context.items.filter((item) =>
                        selectedRemotePaths.has(item.remotePath),
                    );
                    void startUpload(confirmedItems, context.options, context.remoteDir);
                } else if (modal?.type === 'fileUpdate') {
                    void (async () => {
                        const selectedUpdates = (modal.fileUpdates || []).filter((update) => update.selected);
                        if (selectedUpdates.length === 0) {
                            setModal(null);
                            return;
                        }
                        try {
                            await Promise.all(
                                selectedUpdates.map(async (update) => {
                                    const transferId = crypto.randomUUID();
                                    const stats = (await ipcRenderer?.fsStat?.(update.localPath)) as {
                                        size: number;
                                        isDir: boolean;
                                    } | null;
                                    const newTransfer: Transfer = {
                                        id: transferId,
                                        filename: update.filename,
                                        remotePath: update.remotePath,
                                        progress: 0,
                                        size: stats?.size || 0,
                                        type: 'upload',
                                        status: 'active',
                                    };
                                    transfers.setActiveTransfers((prev) => [newTransfer, ...prev]);
                                    await ipcRenderer?.sftpUploadDirect?.({
                                        id,
                                        localPath: update.localPath,
                                        remotePath: update.remotePath,
                                        transferId,
                                        deleteRemotePartialOnCancel: appConfig?.sftpDeletePartialOnCancel ?? false,
                                    });
                                }),
                            );
                            transfers.notifyTransferSuccess();
                            setModal(null);
                            await directory.loadDirectory(directory.pathRef.current);
                        } catch (err: unknown) {
                            const message = err instanceof Error ? err.message : String(err);
                            setModal({ type: 'error', errorMessage: message });
                        }
                    })();
                }
            }}
        />
    </div>{/if}
