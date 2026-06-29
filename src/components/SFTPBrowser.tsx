import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Archive, Copy, Download, Edit, MousePointer2, RefreshCw, Shield, Trash2, UploadCloud, Folder, Plug, Loader2} from 'lucide-react';
import {ContextMenu} from './layout/ContextMenu';
import {SftpToolbar} from './sftp/SftpToolbar';
import {SftpFileList} from './sftp/SftpFileList';
import {SftpTransferPanel} from './sftp/SftpTransferPanel';
import {SftpModals} from './sftp/SftpModals';
import type {AppConfig, SftpFileEntry, SftpProgress, SSHConfig, Transfer, ChangedFile} from '../types';
import {normalizeRemotePath, playSuccessSound, getOSIcon} from '../utils';
import {useI18n} from '../utils/i18n';

const {ipcRenderer} = window;

interface Props {
    id: string;
    config: SSHConfig;
    visible?: boolean;
    onEditConfig?: (config: SSHConfig) => void;
    onClose?: () => void;
    appConfig?: AppConfig;
    onAppConfigUpdate?: (config: AppConfig) => void;
}

export const SFTPBrowser: React.FC<Props> = ({id, config, visible, onEditConfig, onClose, appConfig, onAppConfigUpdate}) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    const tRef = useRef(t);
    useEffect(() => {
        tRef.current = t;
    }, [t]);

    const [path, setPath] = useState('');
    const [files, setFiles] = useState<SftpFileEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState(t('sftp.downloading'));

    const isAuthFailed = error?.startsWith('AUTH_FAILURE:');
    const isClosed = error === t('sftp.connectionEnded') || error === t('sftp.connectionClosed');
    const isConnected = status === t('sftp.ready');
    const isFailed = !!error;

    const getDisplayStatus = useCallback((s: string) => {
        if (isAuthFailed) return t('terminal.authFailed');
        if (isConnected) return t('sftp.ready');
        if (s === t('sftp.downloading') || s === t('terminal.connecting')) return t('terminal.connecting');
        if (s === t('sftp.connectionEnded')) return t('sftp.connectionEnded');
        if (s === t('sftp.connectionClosed')) return t('sftp.connectionClosed');
        if (s === t('common.tcpTimeout')) return t('common.tcpTimeout');
        if (s?.startsWith(t('common.socketError'))) {
            return s;
        }
        return s;
    }, [isAuthFailed, isConnected, t]);

    const displayStatus = getDisplayStatus(status);
    const [isProcessing, setIsProcessing] = useState(false);
    const [activeTransfers, setActiveTransfers] = useState<Transfer[]>([]);
    const pendingUpdatesRef = useRef<SftpProgress[]>([]);
    const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragCounter = useRef(0);
    const pendingDeletesRef = useRef<string[]>([]);
    const cancelledPathsRef = useRef<Set<string>>(new Set());
    const cancelledTransferIdsRef = useRef<Set<string>>(new Set());
    const [countdown, setCountdown] = useState<number | null>(null);

    const notifyTransferSuccess = useCallback(() => {
        if (appConfig?.sftpSoundEnabled) {
            playSuccessSound(appConfig.sftpSoundVolume);
        }
        if (appConfig?.sftpFlashIcon) {
            ipcRenderer?.flashFrame?.();
        }
    }, [appConfig]);

    const [selectedFilenames, setSelectedFilenames] = useState<string[]>([]);
    const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1);
    const [sortField, setSortField] = useState<'name' | 'size' | 'mtime' | 'type'>('name');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, file?: SftpFileEntry } | null>(null);
    const [modal, setModal] = useState<{
        type: string,
        file?: SftpFileEntry,
        selectedFiles?: SftpFileEntry[],
        errorMessage?: string,
        cancelPath?: string,
        localPath?: string,
        remotePath?: string,
        filename?: string,
        applicationPath?: string,
        applicationName?: string,
        changedFiles?: ChangedFile[]
    } | null>(null);
    const [modalInput, setModalInput] = useState('');

    const structuralTransfersFingerprint = activeTransfers.map(t => `${t.id}:${t.status}`).join(',');
    const structuralTransfers = useMemo(() => {
        return activeTransfers
            .filter(t => t.type === 'upload' && (t.status === 'active' || t.status === 'success'))
            .map(t => ({
                filename: t.filename,
                remotePath: t.remotePath,
                isDir: t.isDir,
                size: t.size
            }))
            .sort((a, b) => a.filename.localeCompare(b.filename));
        // We only want to recompute when the set of uploading files or their status changes,
        // ignoring progress updates to prevent unnecessary re-renders of the file list.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [structuralTransfersFingerprint]);

    const mergedFileList = useMemo(() => {
        const merged = [...files];
        const existingNames = new Set(files.map(f => f.filename));
        const currentDirTransfers = structuralTransfers.filter(t =>
            normalizeRemotePath(t.remotePath.substring(0, t.remotePath.lastIndexOf('/')) || '/') === normalizeRemotePath(path)
        );

        currentDirTransfers.forEach(t => {
            if (!existingNames.has(t.filename)) {
                merged.push({
                    filename: t.filename,
                    longname: '',
                    attrs: {
                        mode: t.isDir ? 0o040000 : 0o100644,
                        uid: 0,
                        gid: 0,
                        size: t.size || 0,
                        atime: 0,
                        mtime: 0
                    }
                } as SftpFileEntry);
                existingNames.add(t.filename);
            }
        });

        return merged.sort((a, b) => {
            if (a.filename === '..') return -1;
            if (b.filename === '..') return 1;

            const aIsDir = (a.attrs.mode & 0o170000) === 0o040000;
            const bIsDir = (b.attrs.mode & 0o170000) === 0o040000;

            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;

            let comparison = 0;
            if (sortField === 'name') {
                comparison = a.filename.localeCompare(b.filename);
            } else if (sortField === 'size') {
                comparison = (a.attrs.size || 0) - (b.attrs.size || 0);
            } else if (sortField === 'mtime') {
                comparison = (a.attrs.mtime || 0) - (b.attrs.mtime || 0);
            } else if (sortField === 'type') {
                const aIsLink = (a.attrs.mode & 0o170000) === 0o120000;
                const bIsLink = (b.attrs.mode & 0o170000) === 0o120000;

                if (aIsDir && !bIsDir) comparison = -1;
                else if (!aIsDir && bIsDir) comparison = 1;
                else if (aIsLink && !bIsLink) comparison = -1;
                else if (!aIsLink && bIsLink) comparison = 1;
                else {
                    const aExt = a.filename.split('.').pop() || '';
                    const bExt = b.filename.split('.').pop() || '';
                    comparison = aExt.localeCompare(bExt);
                }
            }

            return sortDirection === 'asc' ? comparison : -comparison;
        });
    }, [files, structuralTransfers, path, sortField, sortDirection]);

    const isConnectingRef = useRef(false);
    const wasConnectedRef = useRef(false);
    const rawStatusRef = useRef('');

    const loadDirectory = useCallback(async (dirPath: string, force = false) => {
        if (!force && rawStatusRef.current !== tRef.current('sftp.ready')) return;
        const normalizedPath = normalizeRemotePath(dirPath);
        setLoading(true);
        setError(null);
        setSelectedFilenames([]);
        setLastSelectedIndex(-1);

        try {
            const list = await ipcRenderer?.sftpReaddir?.({id, path: normalizedPath}) as SftpFileEntry[] | null;
            if (list === null) throw new Error(tRef.current('errors.readdirError', { message: '' }));

            // Больше не удаляем успешно завершенные трансферы автоматически,
            // чтобы пользователь видел историю операций в списке задач.

            let filteredList = (list || []).filter((f: SftpFileEntry) => !f.filename.startsWith('.'));
            filteredList.sort((a, b) => {
                const aMode = a.attrs.mode;
                const bMode = b.attrs.mode;
                const aIsDir = (aMode & 0o170000) === 0o040000;
                const bIsDir = (bMode & 0o170000) === 0o040000;
                if (aIsDir && !bIsDir) return -1;
                if (!aIsDir && bIsDir) return 1;
                return a.filename.localeCompare(b.filename);
            });

            if (normalizedPath !== '/' && normalizedPath !== '') {
                filteredList = [{
                    filename: '..',
                    longname: '..',
                    attrs: { mode: 0o040000, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 }
                } as SftpFileEntry, ...filteredList];
            }

            setFiles(filteredList);
            setPath(dirPath);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [id]);

    const connect = useCallback(() => {
        setStatus(tRef.current('sftp.downloading'));
        setError(null);
        setCountdown(null);
        isConnectingRef.current = false;
        // wasConnectedRef.current НЕ сбрасываем, чтобы авто-реконнект работал при ECONNREFUSED
        ipcRenderer?.sftpConnect?.({id, config});
    }, [id, config]);

    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | undefined;
        const eLower = error?.toLowerCase() || '';
        const isConnectionClosed = error === 'SFTP-соединение завершено' || error === 'SFTP-соединение закрыто' || error === 'Connection closed' || error === 'Connection ended' || eLower.includes('closed') || eLower.includes('ended');
        const isErrorStatus = error && (
            eLower.includes('ошибка') ||
            eLower.includes('тайм-аут') ||
            eLower.includes('error') ||
            eLower.includes('failed') ||
            eLower.includes('timeout') ||
            eLower.includes('reset') ||
            eLower.includes('aborted') ||
            eLower.includes('econn') ||
            eLower.includes('etimedout')
        );

        const isAuthFailed = error?.startsWith('AUTH_FAILURE:');

        if ((isConnectionClosed || isErrorStatus) && wasConnectedRef.current && !isAuthFailed) {
            setCountdown(5);
            timer = setInterval(() => {
                setCountdown(prev => {
                    if (prev === null) return null;
                    if (prev <= 1) {
                        clearInterval(timer);
                        connect();
                        return null;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [error, connect]);

    useEffect(() => {
        let active = true;
        const preventDefault = (e: DragEvent) => e.preventDefault();
        window.addEventListener('dragover', preventDefault);
        window.addEventListener('drop', preventDefault);

        const unsubStatus = ipcRenderer?.onSFTPStatus?.(id, async (msg: string) => {
            if (!active) return;
            rawStatusRef.current = msg;
            setStatus(msg);
            if (msg === tRef.current('sftp.ready')) {
                wasConnectedRef.current = true;
                if (!isConnectingRef.current) {
                    isConnectingRef.current = true;
                    if (pendingDeletesRef.current.length > 0) {
                        const toDelete = [...pendingDeletesRef.current];
                        pendingDeletesRef.current = [];
                        for (const p of toDelete) {
                            try {
                                await ipcRenderer?.sftpRm?.({id, path: p, isDir: false});
                            } catch { /* ignore */
                            }
                        }
                    }
                    ipcRenderer?.sftpRealpath?.({id, path: '.'}).then((res: string) => {
                        loadDirectory(res, true);
                    }).catch(() => loadDirectory('/', true));
                }
            } else {
                isConnectingRef.current = false;
                if (msg === tRef.current('sftp.connectionEnded') || msg === tRef.current('sftp.connectionClosed')) {
                    setError(msg);
                    setLoading(false);
                }
            }
        });

        const unsubError = ipcRenderer?.onSFTPError?.(id, (msg: string) => {
            if (!active) return;
            rawStatusRef.current = msg;
            if (msg.startsWith('AUTH_FAILURE:')) {
                wasConnectedRef.current = false;
            }
            setError(msg);
            setStatus(msg); // Устанавливаем статус в само сообщение об ошибке
            setLoading(false);
            isConnectingRef.current = false;
        });

        const unsubFileChanged = ipcRenderer?.onSFTPFileChanged?.(id, (data: unknown) => {
            if (!active) return;
            const payload = data as { localPath: string; remotePath: string; filename: string };

            setModal(prev => {
                const currentFiles = prev?.type === 'fileUpdate' ? (prev.changedFiles || []) : [];
                // Check if file is already in queue
                const exists = currentFiles.some(f => f.localPath === payload.localPath);
                const updatedFiles = exists
                    ? currentFiles.map(f => f.localPath === payload.localPath ? { ...f, selected: true } : f)
                    : [...currentFiles, { ...payload, selected: true }];

                return {
                    type: 'fileUpdate',
                    changedFiles: updatedFiles
                };
            });
        });

        const unsubProgress = ipcRenderer?.onSFTPProgress?.(id, (data: unknown) => {
            if (!active) return;
            const payload = data as SftpProgress;
            const normalizedPath = normalizeRemotePath(payload.remotePath);

            if (payload.id && cancelledTransferIdsRef.current.has(payload.id)) return;
            if (cancelledPathsRef.current.has(`${payload.type}:${normalizedPath}`)) return;

            pendingUpdatesRef.current.push(payload);

            const processUpdates = () => {
                if (throttleTimerRef.current) {
                    clearTimeout(throttleTimerRef.current);
                    throttleTimerRef.current = null;
                }
                const updates = [...pendingUpdatesRef.current];
                pendingUpdatesRef.current = [];
                if (updates.length === 0) return;

                setActiveTransfers(prev => {
                    const next = [...prev];
                    let changed = false;

                    for (const d of updates) {
                        const dPath = normalizeRemotePath(d.remotePath);
                        if (d.id && cancelledTransferIdsRef.current.has(d.id)) continue;
                        if (cancelledPathsRef.current.has(`${d.type}:${dPath}`)) continue;

                        const idx = next.findIndex(t => d.id ? t.id === d.id : (normalizeRemotePath(t.remotePath) === dPath && t.type === d.type && t.status === 'active'));

                        if (idx !== -1) {
                            const t = next[idx];
                            const isFinished = d.progress >= 100;
                            const newProgress = d.progress;
                            const newStatus = isFinished ? 'success' : 'active';

                            if (t.progress !== newProgress || t.status !== newStatus || (d.total !== undefined && t.size !== d.total)) {
                                next[idx] = {
                                    ...t,
                                    progress: newProgress,
                                    // Если пришло значение d.total, обновляем размер (особенно важно для папок)
                                    size: d.total ?? t.size,
                                    status: newStatus as "active" | "success"
                                };
                                changed = true;
                            }
                        } else if (d.progress < 100 && !d.id) {
                            // Автоматически добавляем новый трансфер, если он не был найден И у него нет ID.
                            // Наличие ID означает, что это событие от уже существующего (или отмененного) трансфера.
                            next.unshift({
                                id: Math.random().toString(36).substring(2, 9),
                                filename: dPath.split('/').pop() || 'unknown',
                                remotePath: dPath,
                                progress: d.progress,
                                size: d.total,
                                type: d.type,
                                status: 'active' as const,
                                isDir: false
                            });
                            changed = true;
                        }
                    }
                    return changed ? next : prev;
                });
            };

            const isCritical = payload.progress >= 100 || payload.progress === 0;
            if (isCritical) {
                processUpdates();
            } else if (!throttleTimerRef.current) {
                throttleTimerRef.current = setTimeout(processUpdates, 150);
            }
        });

        if (active) {
            connect();
        }

        return () => {
            active = false;
            window.removeEventListener('dragover', preventDefault);
            window.removeEventListener('drop', preventDefault);
            if (typeof unsubStatus === 'function') unsubStatus();
            if (typeof unsubError === 'function') unsubError();
            if (typeof unsubProgress === 'function') unsubProgress();
            if (typeof unsubFileChanged === 'function') unsubFileChanged();
            if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
            ipcRenderer?.sshClose?.(id);
        };
    }, [id, config, connect, loadDirectory]);

    const handleDownload = useCallback(async (filenames: string[]) => {
        if (filenames.length === 0) return;
        const newTransfers: Transfer[] = filenames.map(filename => {
            const file = files.find(f => f.filename === filename);
            const remotePath = normalizeRemotePath(`${path}/${filename}`);
            cancelledPathsRef.current.delete(`download:${remotePath}`);
            const transferId = Math.random().toString(36).substring(2, 9);
            cancelledTransferIdsRef.current.delete(transferId);
            const isDir = file ? (file.attrs.mode & 0o170000) === 0o040000 : false;

            return {
                id: transferId,
                filename,
                remotePath,
                progress: 0,
                size: file?.attrs.size,
                type: 'download',
                status: 'active' as const,
                isDir
            };
        });
        setActiveTransfers(prev => [...newTransfers, ...prev]);
        try {
            if (filenames.length === 1) await ipcRenderer?.sftpDownloadFile?.({
                id,
                remotePath: `${path}/${filenames[0]}`.replace(/\/+/g, '/'),
                filename: filenames[0],
                transferId: newTransfers[0].id
            });
            else await ipcRenderer?.sftpDownloadMultiple?.({
                id,
                files: newTransfers.map(t => ({filename: t.filename, remotePath: t.remotePath, transferId: t.id}))
            });
            notifyTransferSuccess();
            loadDirectory(path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('No response from server') || message.includes('closed') || message.includes('destroyed')) {
                setActiveTransfers(prev => prev.map(t => newTransfers.find(nt => nt.remotePath === t.remotePath) ? {
                    ...t,
                    status: 'cancelled'
                } : t));
            } else {
                setActiveTransfers(prev => prev.map(t => newTransfers.find(nt => nt.remotePath === t.remotePath) ? {
                    ...t,
                    status: 'error',
                    error: message
                } : t));
            }
        }
    }, [id, path, files, loadDirectory, notifyTransferSuccess]);

    const handleUpload = useCallback(async (mode: 'file' | 'folder') => {
        let newTransfersToUpdate: Transfer[] = [];
        try {
            const selectedFiles = await ipcRenderer?.sftpSelectFiles?.(mode) as { path: string, name: string, size: number, isDir?: boolean }[] | null;
            if (!selectedFiles || selectedFiles.length === 0) return;

            newTransfersToUpdate = selectedFiles.map(f => {
                const remotePath = normalizeRemotePath(`${path}/${f.name}`);
                cancelledPathsRef.current.delete(`upload:${remotePath}`);
                const transferId = Math.random().toString(36).substring(2, 9);
                cancelledTransferIdsRef.current.delete(transferId);
                return {
                    id: transferId,
                    filename: f.name,
                    remotePath,
                    progress: 0,
                    size: f.size,
                    type: 'upload' as const,
                    status: 'active' as const,
                    isDir: f.isDir
                };
            });

            setActiveTransfers(prev => [...newTransfersToUpdate, ...prev]);

            await ipcRenderer?.sftpUploadFilesFromPaths?.({
                id,
                remoteDir: path,
                transfers: newTransfersToUpdate.map((t, idx) => ({
                    localPath: selectedFiles[idx].path,
                    transferId: t.id
                }))
            });
            notifyTransferSuccess();
            loadDirectory(path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('No response from server') || message.includes('closed') || message.includes('destroyed')) {
                setActiveTransfers(prev => prev.map(t => newTransfersToUpdate.find(nt => nt.id === t.id) ? {
                    ...t,
                    status: 'cancelled'
                } : t));
                return;
            }
            if (newTransfersToUpdate.length > 0) {
                setActiveTransfers(prev => prev.map(t => newTransfersToUpdate.find(nt => nt.id === t.id) ? {
                    ...t,
                    status: 'error',
                    error: message
                } : t));
            }
            setModal({type: 'error', errorMessage: message});
        }
    }, [id, path, loadDirectory, notifyTransferSuccess]);

    const handleCreateDirectory = useCallback(async () => {
        if (!modalInput) return;
        try {
            await ipcRenderer?.sftpMkdir?.({
                id,
                path: `${path}/${modalInput}`.replace(/\/+/g, '/')
            });
            setModal(null);
            loadDirectory(path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({type: 'error', errorMessage: message});
        }
    }, [id, path, modalInput, loadDirectory]);

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
        const remotePath = normalizeRemotePath(`${path}/${filename}`);
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
        cancelledPathsRef.current.delete(`download:${remotePath}`);
        const file = files.find(f => f.filename === filename);
        const transferId = Math.random().toString(36).substring(2, 9);
        cancelledTransferIdsRef.current.delete(transferId);
        const newTransfer: Transfer = {
            id: transferId,
            filename,
            remotePath,
            progress: 0,
            size: file?.attrs.size,
            type: 'download',
            status: 'active' as const
        };
        setActiveTransfers(prev => [newTransfer, ...prev]);

        try {
            const result = await ipcRenderer?.sftpOpenInEditor?.({
                id,
                remotePath,
                filename,
                transferId
            });

            if (result === null) {
                // User cancelled or handled externally without error
                setActiveTransfers(prev => prev.filter(t => t.id !== transferId));
            } else if (result === false) {
                throw new Error(tRef.current('errors.selectedAppNotFound'));
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('No response from server') || message.includes('destroyed') || message.includes('closed')) {
                setActiveTransfers(prev => prev.map(t => t.id === newTransfer.id ? { ...t, status: 'cancelled' } : t));
            } else {
                setModal({type: 'error', errorMessage: message});
                setActiveTransfers(prev => prev.map(t => t.id === newTransfer.id ? { ...t, status: 'error', error: message } : t));
            }
        }
    }, [id, path, files, getApplicationName]);

    const handleDelete = useCallback(async () => {
        const items = modal?.selectedFiles || (modal?.file ? [modal.file] : []);
        setIsProcessing(true);
        try {
            const removedPaths: string[] = [];
            for (const file of items) {
                const fullPath = `${path}/${file.filename}`.replace(/\/+/g, '/');
                await ipcRenderer?.sftpRm?.({
                    id,
                    path: fullPath,
                    isDir: (file.attrs.mode & 0o040000) !== 0
                });
                removedPaths.push(normalizeRemotePath(fullPath));
            }

            // Удаляем удаленные файлы из списка задач, чтобы они исчезли из таблицы (через mergedFileList)
            setActiveTransfers(prev => prev.filter(t => !removedPaths.includes(normalizeRemotePath(t.remotePath))));

            setModal(null);
            loadDirectory(path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({type: 'error', errorMessage: message});
        } finally {
            setIsProcessing(false);
        }
    }, [id, path, modal, loadDirectory]);

    const handleRename = useCallback(async () => {
        if (!modal?.file || !modalInput) return;
        try {
            const oldPath = `${path}/${modal.file.filename}`.replace(/\/+/g, '/');
            await ipcRenderer?.sftpRename?.({
                id,
                oldPath,
                newPath: `${path}/${modalInput}`.replace(/\/+/g, '/')
            });

            // Очищаем старый путь из списка задач, чтобы избежать дубликатов или "фантомных" файлов при переименовании
            const normalizedOldPath = normalizeRemotePath(oldPath);
            setActiveTransfers(prev => prev.filter(t => normalizeRemotePath(t.remotePath) !== normalizedOldPath));

            setModal(null);
            loadDirectory(path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({type: 'error', errorMessage: message});
        }
    }, [id, path, modal, modalInput, loadDirectory]);

    const handlePermissions = useCallback(async () => {
        if (!modal?.file || !modalInput) return;
        try {
            await ipcRenderer?.sftpChmod?.({
                id,
                path: `${path}/${modal.file.filename}`.replace(/\/+/g, '/'),
                mode: parseInt(modalInput, 8)
            });
            setModal(null);
            loadDirectory(path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({type: 'error', errorMessage: message});
        }
    }, [id, path, modal, modalInput, loadDirectory]);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        dragCounter.current = 0;
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length === 0) return;

        const droppedFilesWithPaths = await Promise.all(droppedFiles.map(async f => {
            const localPath = ipcRenderer?.getPathForFile?.(f);
            if (!localPath) return null;
            const stats = await ipcRenderer?.fsStat?.(localPath) as { size: number, isDir: boolean } | null;
            return {
                name: f.name,
                size: stats?.size || 0,
                path: localPath,
                isDir: stats?.isDir || false
            };
        }));

        const validDroppedFiles = droppedFilesWithPaths.filter((f): f is NonNullable<typeof f> => f !== null);
        if (validDroppedFiles.length === 0) return;

        const newTransfers: Transfer[] = validDroppedFiles.map((f) => {
            const remotePath = normalizeRemotePath(`${path}/${f.name}`);
            cancelledPathsRef.current.delete(`upload:${remotePath}`);
            const transferId = Math.random().toString(36).substring(2, 9);
            cancelledTransferIdsRef.current.delete(transferId);
            return {
                id: transferId,
                filename: f.name,
                remotePath,
                progress: 0,
                size: f.size,
                type: 'upload' as const,
                status: 'active' as const,
                isDir: f.isDir
            };
        });
        setActiveTransfers(prev => [...newTransfers, ...prev]);

        try {
            await ipcRenderer?.sftpUploadFilesFromPaths?.({
                id,
                remoteDir: path,
                transfers: newTransfers.map((t, idx) => ({
                    localPath: validDroppedFiles[idx].path,
                    transferId: t.id
                }))
            });
            notifyTransferSuccess();
            loadDirectory(path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('No response from server') || message.includes('closed') || message.includes('destroyed')) {
                setActiveTransfers(prev => prev.map(t => newTransfers.find(nt => nt.id === t.id) ? {
                    ...t,
                    status: 'cancelled'
                } : t));
                return;
            }
            const failedPaths = newTransfers.map(u => u.remotePath);
            pendingDeletesRef.current = Array.from(new Set([...pendingDeletesRef.current, ...failedPaths]));
            setActiveTransfers(prev => prev.map(t => newTransfers.find(nt => nt.remotePath === t.remotePath) ? {
                ...t,
                status: 'error' as const,
                error: message
            } : t));
        }
    }, [id, path, loadDirectory, notifyTransferSuccess]);

    const handleGoHome = useCallback(() => loadDirectory('/'), [loadDirectory]);
    const handleRefresh = useCallback(() => loadDirectory(path), [loadDirectory, path]);

    const handleFileClick = useCallback((e: React.MouseEvent, f: string, i: number) => {
        if (e.shiftKey && lastSelectedIndex !== -1) {
            const start = Math.min(lastSelectedIndex, i), end = Math.max(lastSelectedIndex, i);
            setSelectedFilenames(prev => Array.from(new Set([...prev, ...mergedFileList.slice(start, end + 1).map(f => f.filename)])));
        } else if (e.ctrlKey || e.metaKey) {
            setSelectedFilenames(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
            setLastSelectedIndex(i);
        } else {
            setSelectedFilenames([f]);
            setLastSelectedIndex(i);
        }
    }, [lastSelectedIndex, mergedFileList]);

    const handleFileDoubleClick = useCallback((f: SftpFileEntry) => {
        if (f.filename === '..') {
            const parts = path.split('/').filter(Boolean);
            parts.pop();
            loadDirectory('/' + parts.join('/'));
            return;
        }
        const isDir = (f.attrs.mode & 0o170000) === 0o040000;
        const isLink = (f.attrs.mode & 0o170000) === 0o120000;
        if (isDir || isLink) {
            const isTargetDir = isLink && f.targetAttrs ? (f.targetAttrs.mode & 0o170000) === 0o040000 : isDir;
            if (isTargetDir) {
                loadDirectory(path === '/' ? `/${f.filename}` : `${path}/${f.filename}`.replace(/\/+/g, '/'));
            } else {
                handleEdit(f.filename);
            }
        } else handleEdit(f.filename);
    }, [path, loadDirectory, handleEdit]);

    const handleFileContextMenu = useCallback((e: React.MouseEvent, f: SftpFileEntry) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedFilenames.includes(f.filename)) {
            setSelectedFilenames([f.filename]);
            setLastSelectedIndex(files.findIndex(x => x.filename === f.filename));
        }

        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            file: f
        });
    }, [selectedFilenames, files]);

    const handleCancelTransfer = useCallback((t: Transfer) => {
        const normPath = normalizeRemotePath(t.remotePath);
        cancelledPathsRef.current.add(`${t.type}:${normPath}`);
        cancelledTransferIdsRef.current.add(t.id);

        // Немедленно удаляем из состояния и очищаем очередь, чтобы не было "двойного клика"
        pendingUpdatesRef.current = pendingUpdatesRef.current.filter(u => u.id !== t.id && normalizeRemotePath(u.remotePath) !== normPath);
        setActiveTransfers(prev => prev.filter(x => x.id !== t.id));

        ipcRenderer?.sftpCancelUpload?.({ id, transferId: t.id });
        if (t.type === 'upload') {
            ipcRenderer?.sftpRm?.({ id, path: t.remotePath, isDir: t.isDir });
        }
    }, [id]);

    const primaryRed = 'var(--primary-color)';

    const handleOpenWithRemember = useCallback(async (): Promise<void> => {
        if (!modal || !modal.filename || !modal.remotePath || !modal.applicationPath) {
            setModal(null);
            return;
        }
        const transferId = Math.random().toString(36).substring(2, 9);
        const file = files.find((currentFile) => currentFile.filename === modal.filename);
        const newTransfer: Transfer = {
            id: transferId,
            filename: modal.filename,
            remotePath: modal.remotePath,
            progress: 0,
            size: file?.attrs.size,
            type: 'download',
            status: 'active' as const
        };
        setActiveTransfers((previousTransfers) => [newTransfer, ...previousTransfers]);
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
                setActiveTransfers((previousTransfers) => previousTransfers.filter((transfer) => transfer.id !== transferId));
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
            setModal({type: 'error', errorMessage: message});
            setActiveTransfers((previousTransfers) => previousTransfers.map((transfer) => {
                if (transfer.id === transferId) {
                    return {...transfer, status: 'error', error: message};
                }
                return transfer;
            }));
        }
    }, [files, id, modal, modalInput, onAppConfigUpdate]);

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
                setSelectedFilenames([]);
                setLastSelectedIndex(-1);
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
                            <UploadCloud size={64} strokeWidth={1.5}/>
                            <div style={{fontWeight: 'bold', fontSize: '1.2em'}}>{t('sftp.uploading')}</div>
                        </div>
                    </div>
                )}
                <SftpToolbar path={path} loading={loading} onGoHome={handleGoHome} onRefresh={handleRefresh} onUpload={handleUpload} onNavigate={loadDirectory} appConfig={appConfig}/>

                <div className="sftp-content"
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
                         scrollbarGutter: 'stable'
                     }}>
                {(!isConnected || isFailed) && (
                    <div className={`connection-overlay ${!isFailed ? 'loading' : 'failed'}`} style={{
                        position: 'absolute',
                        top: 0, left: 0, right: 0, bottom: 0,
                        background: 'var(--bg-color)',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        zIndex: 10, padding: '40px', textAlign: 'center',
                        transition: 'opacity 0.3s ease, visibility 0.3s'
                    }}>
                        <div className="connection-container" style={{ gap: '40px', padding: '48px', maxWidth: '550px', width: '95%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', gap: '20px' }}>
                                <div className="server-info-card" style={{ gap: '16px', border: 'none', background: 'transparent', padding: 0 }}>
                                    <div className="os-icon-wrapper" style={{ width: '48px', height: '48px', padding: '0', flexShrink: 0, background: 'transparent' }}>
                                        <img src={getOSIcon(config.osPrettyName)} alt="OS" style={{ width: '100%', height: '100%', objectFit: 'contain' }} draggable="false" />
                                    </div>
                                    <div className="server-details" style={{ textAlign: 'left' }}>
                                        <div className="server-name" style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)' }}>{config.name || config.host}</div>
                                        <div className="server-address" style={{ fontSize: '14px', opacity: 0.7, color: 'var(--text-secondary)' }}>SFTP {config.host}:{config.port}</div>
                                    </div>
                                </div>
                            </div>

                            {!isFailed ? (
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
                                                opacity: isConnected ? 0 : 1,
                                                transition: 'opacity 0.3s ease'
                                            }} />
                                            <Plug size={24} />
                                        </div>

                                        <div className="path-line" style={{ flex: 1, height: '2px', background: isConnected ? 'var(--accent)' : 'var(--border)', margin: '0 -2px', transition: 'background 0.5s ease' }} />

                                        <div style={{
                                            width: '44px',
                                            height: '44px',
                                            borderRadius: '50%',
                                            background: isConnected ? 'var(--accent)' : 'var(--hover-surface)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: isConnected ? '#fff' : 'var(--text-secondary)',
                                            zIndex: 2,
                                            border: isConnected ? 'none' : '1px solid var(--border)',
                                            transition: 'all 0.5s ease'
                                        }}>
                                            <Folder size={22} />
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--accent)', fontWeight: 600, fontSize: '16px', marginTop: '10px' }}>
                                        <Loader2 size={20} className="spin" />
                                        {displayStatus}
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
                                        background: isAuthFailed ? 'rgba(239, 68, 68, 0.1)' : (isClosed ? 'rgba(255, 255, 255, 0.05)' : 'rgba(239, 68, 68, 0.1)'),
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: isAuthFailed ? '#ef4444' : (isClosed ? 'var(--text-primary)' : '#ef4444'),
                                        fontSize: '24px'
                                    }}>{isAuthFailed ? '🔒' : (isClosed ? '🔌' : '⚠️')}</div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'center' }}>
                                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                                            {getDisplayStatus(error || status)}
                                        </div>
                                        {countdown !== null && !isAuthFailed && (
                                            <div style={{ fontSize: '14px', opacity: 0.7, fontWeight: 500 }}>
                                                {t('terminal.reconnectIn', { n: countdown.toString() })}
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
                                            onClick={connect}
                                            className="btn-primary"
                                            style={{ padding: '12px 28px', fontSize: '14px' }}
                                        >
                                            {isClosed ? t('terminal.reconnect') : t('common.connect')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                    <SftpFileList
                        files={mergedFileList}
                        selectedFilenames={selectedFilenames}
                        onFileClick={handleFileClick}
                        onFileDoubleClick={handleFileDoubleClick}
                        onFileContextMenu={handleFileContextMenu}
                        loading={loading}
                        appConfig={appConfig}
                        sortField={sortField}
                        sortDirection={sortDirection}
                        onSort={(field) => {
                            if (sortField === field) {
                                setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                            } else {
                                setSortField(field);
                                setSortDirection(field === 'mtime' ? 'desc' : 'asc');
                            }
                        }}
                    />
                </div>
            </div>

            <SftpTransferPanel activeTransfers={activeTransfers} setActiveTransfers={setActiveTransfers}
                               primaryRed={primaryRed}
                               onCancelTransfer={handleCancelTransfer}
                               appConfig={appConfig}/>

            {contextMenu && (
                <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} options={[
                    ...(contextMenu.file ? [
                        ...(selectedFilenames.length <= 1 ? [
                            {
                                label: ((contextMenu.file.attrs.mode & 0o040000) !== 0 || (contextMenu.file.targetAttrs && (contextMenu.file.targetAttrs.mode & 0o040000) !== 0)) ? t('sftp.goto') : t('sftp.open'),
                                icon: <MousePointer2 size={14}/>,
                                onClick: () => {
                                    const isDir = (contextMenu.file!.attrs.mode & 0o170000) === 0o040000;
                                    const isLink = (contextMenu.file!.attrs.mode & 0o170000) === 0o120000;
                                    if (isDir || isLink) {
                                        const isTargetDir = isLink && contextMenu.file!.targetAttrs ? (contextMenu.file!.targetAttrs.mode & 0o170000) === 0o040000 : isDir;
                                        if (isTargetDir) {
                                            loadDirectory(path === '/' ? `/${contextMenu.file!.filename}` : `${path}/${contextMenu.file!.filename}`.replace(/\/+/g, '/'));
                                        } else {
                                            handleEdit(contextMenu.file!.filename);
                                        }
                                    } else handleEdit(contextMenu.file!.filename);
                                }
                            },
                            {
                                label: t('sftp.openWith'), icon: <MousePointer2 size={14}/>, onClick: () => handleEdit(contextMenu.file!.filename, true)
                            },
                            {
                                label: t('sftp.rename'), icon: <Edit size={14}/>, onClick: () => {
                                    setModal({type: 'rename', file: contextMenu.file});
                                    setModalInput(contextMenu.file!.filename);
                                }
                            },
                            {
                                label: t('sftp.rights'), icon: <Shield size={14}/>, onClick: () => {
                                    setModal({type: 'permissions', file: contextMenu.file});
                                    setModalInput((contextMenu.file!.attrs.mode & 0o777).toString(8));
                                }
                            },
                            {
                                label: t('sftp.copyPath'),
                                icon: <Copy size={14}/>,
                                onClick: () => {
                                    const fullPath = `${path}/${contextMenu.file!.filename}`.replace(/\/+/g, '/');
                                    navigator.clipboard.writeText(fullPath);
                                }
                            }
                        ] : []),
                        {label: t('sftp.download'), icon: <Download size={14}/>, onClick: () => handleDownload(selectedFilenames)},
                        ...( !((contextMenu.file.attrs.mode & 0o040000) !== 0) && ['.zip', '.tar', '.gz', '.tgz', '.bz2'].some(ext => contextMenu.file!.filename.toLowerCase().endsWith(ext)) ? [{
                            label: t('sftp.extract'),
                            icon: <Archive size={14}/>,
                            onClick: () => {
                                ipcRenderer?.sftpExtract?.({
                                    id,
                                    remotePath: `${path}/${contextMenu.file!.filename}`.replace(/\/+/g, '/')
                                }).then(() => loadDirectory(path));
                            }
                        }] : [])
                    ] : []),
                    {
                        label: t('sftp.newFolder'),
                        icon: <Archive size={14}/>,
                        onClick: () => {
                            setModal({type: 'mkdir'});
                            setModalInput(t('sftp.newFolder'));
                        }
                    },
                    {
                        label: t('sftp.refresh'),
                        icon: <RefreshCw size={14}/>,
                        onClick: () => loadDirectory(path)
                    },
                    {
                        label: t('sftp.copyDirPath'),
                        icon: <Copy size={14}/>,
                        onClick: () => {
                            navigator.clipboard.writeText(path);
                        }
                    },
                    ...(contextMenu.file ? [{
                        label: t('common.delete'),
                        icon: <Trash2 size={14}/>,
                        danger: true,
                        onClick: () => {
                            const selectedItems = files.filter(f => selectedFilenames.includes(f.filename));
                            setModal({
                                type: 'delete',
                                file: contextMenu.file,
                                selectedFiles: selectedItems.length > 0 ? selectedItems : [contextMenu.file!]
                            });
                        }
                    }] : [])
                ]}/>
            )}

            <SftpModals modal={modal} modalInput={modalInput} setModalInput={setModalInput}
                        isProcessing={isProcessing}
                        appConfig={appConfig}
                        onToggleFileSelection={(localPath) => {
                            setModal(prev => {
                                if (prev?.type !== 'fileUpdate' || !prev.changedFiles) return prev;
                                return {
                                    ...prev,
                                    changedFiles: prev.changedFiles.map(f =>
                                        f.localPath === localPath ? { ...f, selected: !f.selected } : f
                                    )
                                };
                            });
                        }}
                        onToggleAllFiles={(selected) => {
                            setModal(prev => {
                                if (prev?.type !== 'fileUpdate' || !prev.changedFiles) return prev;
                                return {
                                    ...prev,
                                    changedFiles: prev.changedFiles.map(f => ({ ...f, selected }))
                                };
                            });
                        }}
                        onClose={() => setModal(null)} onConfirm={() => {
                if (modal?.type === 'delete') handleDelete(); else if (modal?.type === 'rename') handleRename(); else if (modal?.type === 'mkdir') handleCreateDirectory(); else if (modal?.type === 'permissions') handlePermissions(); else if (modal?.type === 'error') setModal(null); else if (modal?.type === 'cancelUpload') setModal(null); else if (modal?.type === 'openWithRemember') handleOpenWithRemember(); else if (modal?.type === 'fileUpdate') {
                    const selectedFiles = modal.changedFiles?.filter(f => f.selected) || [];
                    if (selectedFiles.length === 0) {
                        setModal(null);
                        return;
                    }

                    selectedFiles.forEach(file => {
                        const transferId = Math.random().toString(36).substring(2, 9);
                        ipcRenderer?.fsStat?.(file.localPath).then((stats: unknown) => {
                            const s = stats as { size: number; isDir: boolean };
                            const newTransfer: Transfer = {
                                id: transferId,
                                filename: file.filename,
                                remotePath: file.remotePath,
                                progress: 0,
                                size: s?.size || 0,
                                type: 'upload',
                                status: 'active'
                            };
                            setActiveTransfers(prev => [newTransfer, ...prev]);
                            ipcRenderer?.sftpUploadDirect?.({
                                id,
                                localPath: file.localPath,
                                remotePath: file.remotePath,
                                transferId
                            }).then(() => {
                                notifyTransferSuccess();
                                loadDirectory(path);
                            });
                        });
                    });
                    setModal(null);
                }
            }} />

        </div>
    );
};
