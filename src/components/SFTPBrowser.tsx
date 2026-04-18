import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Archive, Download, Edit, MousePointer2, RefreshCw, Shield, Trash2, UploadCloud} from 'lucide-react';
import {ContextMenu} from './layout/ContextMenu';
import {SftpToolbar} from './sftp/SftpToolbar';
import {SftpFileList} from './sftp/SftpFileList';
import {SftpTransferPanel} from './sftp/SftpTransferPanel';
import {SftpModals} from './sftp/SftpModals';
import type {SftpFileEntry, SftpProgress, SSHConfig, Transfer} from '../types';
import {normalizeRemotePath} from '../utils';

const {ipcRenderer} = window;

interface Props {
    id: string;
    config: SSHConfig;
    visible?: boolean;
    onEditConfig?: (config: SSHConfig) => void;
}

export const SFTPBrowser: React.FC<Props> = ({id, config, visible, onEditConfig}) => {
    const [path, setPath] = useState('');
    const [files, setFiles] = useState<SftpFileEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState('Подключение...');
    const [isProcessing, setIsProcessing] = useState(false);
    const [activeTransfers, setActiveTransfers] = useState<Transfer[]>([]);
    const pendingUpdatesRef = useRef<SftpProgress[]>([]);
    const throttleTimerRef = useRef<NodeJS.Timeout | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragCounter = useRef(0);
    const pendingDeletesRef = useRef<string[]>([]);
    const cancelledPathsRef = useRef<Set<string>>(new Set());
    const cancelledTransferIdsRef = useRef<Set<string>>(new Set());

    const [selectedFilenames, setSelectedFilenames] = useState<string[]>([]);
    const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, file?: SftpFileEntry } | null>(null);
    const [modal, setModal] = useState<{
        type: string,
        file?: SftpFileEntry,
        selectedFiles?: SftpFileEntry[],
        errorMessage?: string,
        cancelPath?: string,
        localPath?: string,
        remotePath?: string,
        filename?: string
    } | null>(null);
    const [modalInput, setModalInput] = useState('');

    const mergedFileList = useMemo(() => {
        const merged = [...files];
        const existingNames = new Set(files.map(f => f.filename));
        const currentDirTransfers = activeTransfers.filter(t =>
            t.type === 'upload' &&
            (t.status === 'active' || t.status === 'success') &&
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
                        atime: Date.now() / 1000,
                        mtime: Date.now() / 1000
                    }
                } as SftpFileEntry);
                existingNames.add(t.filename);
            }
        });

        return merged.sort((a, b) => {
            if (a.filename === '..') return -1;
            if (b.filename === '..') return 1;
            const aIsDir = (a.attrs.mode & 0o040000) !== 0;
            const bIsDir = (b.attrs.mode & 0o040000) !== 0;
            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;
            return a.filename.localeCompare(b.filename);
        });
    }, [files, activeTransfers, path]);

    const isConnectingRef = useRef(false);
    const wasConnectedRef = useRef(false);
    const statusRef = useRef(status);

    useEffect(() => {
        statusRef.current = status;
    }, [status]);

    const loadDirectory = useCallback(async (dirPath: string, force = false) => {
        if (!force && statusRef.current !== 'SFTP сессия готова') return;
        const normalizedPath = normalizeRemotePath(dirPath);
        setLoading(true);
        setError(null);
        setSelectedFilenames([]);
        setLastSelectedIndex(-1);

        try {
            const list = await ipcRenderer.invoke('sftp-readdir', {id, path: normalizedPath}) as SftpFileEntry[] | null;

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
            if (message.includes('No response from server')) return;
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [id]);

    const connect = useCallback(() => {
        setStatus('Подключение...');
        setError(null);
        isConnectingRef.current = false;
        // wasConnectedRef.current НЕ сбрасываем, чтобы авто-реконнект работал при ECONNREFUSED
        ipcRenderer.send('sftp-connect', {id, config});
    }, [id, config]);

    useEffect(() => {
        const preventDefault = (e: DragEvent) => e.preventDefault();
        window.addEventListener('dragover', preventDefault);
        window.addEventListener('drop', preventDefault);

        const unsubStatus = ipcRenderer.on(`sftp-status-${id}`, async (...args: unknown[]) => {
            const msg = args[0] as string;
            setStatus(msg);
            if (msg === 'SFTP сессия готова') {
                wasConnectedRef.current = true;
                if (!isConnectingRef.current) {
                    isConnectingRef.current = true;
                    if (pendingDeletesRef.current.length > 0) {
                        const toDelete = [...pendingDeletesRef.current];
                        pendingDeletesRef.current = [];
                        for (const p of toDelete) {
                            try {
                                await ipcRenderer.invoke('sftp-rm', {id, path: p, isDir: false});
                            } catch { /* ignore */
                            }
                        }
                    }
                    ipcRenderer.invoke('sftp-realpath', {id, path: '.'}).then((res: unknown) => {
                        const resolvedPath = res as string;
                        loadDirectory(resolvedPath, true);
                    }).catch(() => loadDirectory('/', true));
                }
            } else {
                isConnectingRef.current = false;
            }
        });

        const unsubError = ipcRenderer.on(`sftp-error-${id}`, (...args: unknown[]) => {
            const msg = args[0] as string;
            if (msg.startsWith('AUTH_FAILURE:')) {
                wasConnectedRef.current = false;
            }
            setError(msg);
            setStatus(msg); // Устанавливаем статус в само сообщение об ошибке
            setLoading(false);
            isConnectingRef.current = false;
        });

        const unsubFileChanged = ipcRenderer.on(`sftp-file-changed-${id}`, (...args: unknown[]) => {
            const data = args[0] as { localPath: string; remotePath: string; filename: string };
            setModal({type: 'fileUpdate', ...data});
        });

        const unsubProgress = ipcRenderer.on(`sftp-progress-${id}`, (...args: unknown[]) => {
            const data = args[0] as SftpProgress;
            const normalizedPath = normalizeRemotePath(data.remotePath);

            if (data.id && cancelledTransferIdsRef.current.has(data.id)) return;
            if (cancelledPathsRef.current.has(`${data.type}:${normalizedPath}`)) return;

            pendingUpdatesRef.current.push(data);

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
                            const pathMatches = dPath === normalizeRemotePath(t.remotePath);
                            const isFinished = d.progress >= 100 && pathMatches;
                            const newProgress = pathMatches ? d.progress : t.progress;
                            const newStatus = isFinished ? 'success' : 'active';

                            if (t.progress !== newProgress || t.status !== newStatus) {
                                next[idx] = {
                                    ...t,
                                    progress: newProgress,
                                    // Для папок сохраняем ранее вычисленный рекурсивный размер,
                                    // чтобы он не перезаписывался размером отдельного вложенного файла
                                    size: t.isDir ? t.size : (pathMatches ? (d.total || t.size) : t.size),
                                    status: newStatus as "active" | "success"
                                };
                                changed = true;
                            }
                        } else if (d.progress < 100 && !d.id) {
                            // Автоматически добавляем новый трансфер, если он не был найден И у него нет ID.
                            // Наличие ID означает, что это событие от уже существующего (или отмененного) трансфера.
                            next.unshift({
                                id: Math.random().toString(36).substr(2, 9),
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

            const isCritical = data.progress >= 100 || data.progress === 0;
            if (isCritical) {
                processUpdates();
            } else if (!throttleTimerRef.current) {
                throttleTimerRef.current = setTimeout(processUpdates, 150);
            }
        });

        connect();

        return () => {
            window.removeEventListener('dragover', preventDefault);
            window.removeEventListener('drop', preventDefault);
            if (typeof unsubStatus === 'function') unsubStatus();
            if (typeof unsubError === 'function') unsubError();
            if (typeof unsubProgress === 'function') unsubProgress();
            if (typeof unsubFileChanged === 'function') unsubFileChanged();
            if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
            ipcRenderer.send('ssh-close', id);
        };
    }, [id, config]);

    const handleDownload = async (filenames: string[]) => {
        if (filenames.length === 0) return;
        const newTransfers: Transfer[] = filenames.map(filename => {
            const file = files.find(f => f.filename === filename);
            const remotePath = normalizeRemotePath(`${path}/${filename}`);
            cancelledPathsRef.current.delete(`download:${remotePath}`);
            const transferId = Math.random().toString(36).substr(2, 9);
            cancelledTransferIdsRef.current.delete(transferId);
            return {
                id: transferId,
                filename,
                remotePath,
                progress: 0,
                size: file?.attrs.size,
                type: 'download',
                status: 'active' as const
            };
        });
        setActiveTransfers(prev => [...newTransfers, ...prev]);
        try {
            if (filenames.length === 1) await ipcRenderer.invoke('sftp-download-file', {
                id,
                remotePath: `${path}/${filenames[0]}`.replace(/\/+/g, '/'),
                filename: filenames[0],
                transferId: newTransfers[0].id
            });
            else await ipcRenderer.invoke('sftp-download-multiple-files', {
                id,
                files: newTransfers.map(t => ({filename: t.filename, remotePath: t.remotePath, transferId: t.id}))
            });
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
    };

    const handleUpload = async (mode: 'file' | 'folder') => {
        let newTransfersToUpdate: Transfer[] = [];
        try {
            const selectedFiles = await ipcRenderer.invoke('sftp-select-files', mode) as { path: string, name: string, size: number, isDir?: boolean }[] | null;
            if (!selectedFiles || selectedFiles.length === 0) return;

            newTransfersToUpdate = selectedFiles.map(f => {
                const remotePath = normalizeRemotePath(`${path}/${f.name}`);
                cancelledPathsRef.current.delete(`upload:${remotePath}`);
                const transferId = Math.random().toString(36).substr(2, 9);
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

            await ipcRenderer.invoke('sftp-upload-files-from-paths', {
                id,
                remoteDir: path,
                transfers: newTransfersToUpdate.map((t, idx) => ({
                    localPath: selectedFiles[idx].path,
                    transferId: t.id
                }))
            });
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
    };

    const handleCreateDirectory = async () => {
        if (!modalInput) return;
        try {
            await ipcRenderer.invoke('sftp-mkdir', {
                id,
                path: `${path}/${modalInput}`.replace(/\/+/g, '/')
            });
            setModal(null);
            loadDirectory(path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({type: 'error', errorMessage: message});
        }
    };

    const handleEdit = async (filename: string) => {
        const remotePath = normalizeRemotePath(`${path}/${filename}`);
        cancelledPathsRef.current.delete(`download:${remotePath}`);
        const file = files.find(f => f.filename === filename);
        const transferId = Math.random().toString(36).substr(2, 9);
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
            await ipcRenderer.invoke('sftp-open-in-editor', {
                id,
                remotePath,
                filename,
                transferId
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('No response from server') || message.includes('destroyed') || message.includes('closed')) {
                setActiveTransfers(prev => prev.map(t => t.id === newTransfer.id ? { ...t, status: 'cancelled' } : t));
            } else {
                setModal({type: 'error', errorMessage: message});
                setActiveTransfers(prev => prev.map(t => t.id === newTransfer.id ? { ...t, status: 'error', error: message } : t));
            }
        }
    };

    const handleDelete = async () => {
        const items = modal?.selectedFiles || (modal?.file ? [modal.file] : []);
        setIsProcessing(true);
        try {
            for (const file of items) {
                await ipcRenderer.invoke('sftp-rm', {
                    id,
                    path: `${path}/${file.filename}`.replace(/\/+/g, '/'),
                    isDir: (file.attrs.mode & 0o040000) !== 0
                });
            }
            setModal(null);
            loadDirectory(path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({type: 'error', errorMessage: message});
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRename = async () => {
        if (!modal?.file || !modalInput) return;
        try {
            await ipcRenderer.invoke('sftp-rename', {
                id,
                oldPath: `${path}/${modal.file.filename}`.replace(/\/+/g, '/'),
                newPath: `${path}/${modalInput}`.replace(/\/+/g, '/')
            });
            setModal(null);
            loadDirectory(path);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setModal({type: 'error', errorMessage: message});
        }
    };

    const handlePermissions = async () => {
        if (!modal?.file || !modalInput) return;
        try {
            await ipcRenderer.invoke('sftp-chmod', {
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
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        dragCounter.current = 0;
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length === 0) return;

        const droppedFilesWithPaths = await Promise.all(droppedFiles.map(async f => {
            const localPath = ipcRenderer.getPathForFile(f);
            if (!localPath) return null;
            const stats = await ipcRenderer.invoke('fs-stat', localPath);
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
            const transferId = Math.random().toString(36).substr(2, 9);
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
            await ipcRenderer.invoke('sftp-upload-files-from-paths', {
                id,
                remoteDir: path,
                transfers: newTransfers.map((t, idx) => ({
                    localPath: validDroppedFiles[idx].path,
                    transferId: t.id
                }))
            });
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
    };

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
                            <div style={{fontWeight: 'bold', fontSize: '1.2em'}}>Перетащите файлы сюда для загрузки</div>
                        </div>
                    </div>
                )}
                <SftpToolbar path={path} loading={loading} primaryRed={primaryRed} onGoHome={() => loadDirectory('/')} onRefresh={() => loadDirectory(path)} onUpload={handleUpload}/>

                <div className="sftp-content"
                     onContextMenu={(e) => {
                         if (e.target === e.currentTarget) {
                             e.preventDefault();
                             setContextMenu({
                                 x: e.clientX,
                                 y: e.clientY
                             });
                         }
                     }}
                     style={{
                         flex: 1,
                         overflowY: 'auto',
                         position: 'relative',
                         scrollbarGutter: 'stable'
                     }}>
                {(loading || status !== 'SFTP сессия готова') && files.length === 0 && <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '15px',
                    zIndex: 5,
                    background: 'var(--bg-color)'
                }}>
                    <div className="loading-spinner"/>
                    <div style={{fontWeight: 'bold'}}>{status}</div>
                </div>}
                {error && (
                    <div style={{
                        padding: '15px 20px',
                        color: error.startsWith('AUTH_FAILURE:') ? 'var(--primary-color)' : '#cc241d',
                        background: error.startsWith('AUTH_FAILURE:') ? 'rgba(200, 30, 81, 0.05)' : 'rgba(204, 36, 29, 0.1)',
                        margin: '10px',
                        borderRadius: '10px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        border: `1px solid ${error.startsWith('AUTH_FAILURE:') ? 'rgba(200, 30, 81, 0.2)' : 'rgba(204, 36, 29, 0.2)'}`
                    }}>
                        <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                            <span style={{fontSize: '18px'}}>{error.startsWith('AUTH_FAILURE:') ? '🔒' : '⚠️'}</span>
                            <div>
                                <strong>{error.startsWith('AUTH_FAILURE:') ? 'Ошибка аутентификации:' : 'Ошибка:'}</strong> {error.startsWith('AUTH_FAILURE:') ? 'Неверный логин или пароль' : error}
                            </div>
                        </div>
                        <div style={{display: 'flex', gap: '10px'}}>
                            <button className="btn-primary" onClick={connect}
                                    style={{padding: '8px 16px', fontSize: '12px'}}>Попробовать снова
                            </button>
                            {error.startsWith('AUTH_FAILURE:') && onEditConfig && (
                                <button
                                    onClick={() => onEditConfig(config)}
                                    className="btn-primary"
                                    style={{
                                        padding: '8px 16px',
                                        fontSize: '12px',
                                        background: 'var(--card-bg)',
                                        color: 'var(--text-color)',
                                        border: '1px solid var(--border-color)'
                                    }}
                                >
                                    Настроить сервер
                                </button>
                            )}
                        </div>
                    </div>
                )}
                    <SftpFileList files={mergedFileList} selectedFilenames={selectedFilenames} onFileClick={(e, f, i) => {
                    if (e.shiftKey && lastSelectedIndex !== -1) {
                        const start = Math.min(lastSelectedIndex, i), end = Math.max(lastSelectedIndex, i);
                        setSelectedFilenames(Array.from(new Set([...selectedFilenames, ...files.slice(start, end + 1).map(f => f.filename)])));
                    } else if (e.ctrlKey || e.metaKey) {
                        setSelectedFilenames(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
                        setLastSelectedIndex(i);
                    } else {
                        setSelectedFilenames([f]);
                        setLastSelectedIndex(i);
                    }
                }} onFileDoubleClick={(f) => {
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
                }} onFileContextMenu={(e, f) => {
                    e.preventDefault();
                    if (!selectedFilenames.includes(f.filename)) {
                        setSelectedFilenames([f.filename]);
                        setLastSelectedIndex(files.findIndex(x => x.filename === f.filename));
                    }

                    setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        file: f
                    });
                    }} loading={loading}/>
                </div>
            </div>

            <SftpTransferPanel activeTransfers={activeTransfers} setActiveTransfers={setActiveTransfers}
                               primaryRed={primaryRed}
                               onCancelTransfer={(t) => {
                                   const normPath = normalizeRemotePath(t.remotePath);
                                   cancelledPathsRef.current.add(`${t.type}:${normPath}`);
                                   cancelledTransferIdsRef.current.add(t.id);

                                   // Немедленно удаляем из состояния и очищаем очередь, чтобы не было "двойного клика"
                                   pendingUpdatesRef.current = pendingUpdatesRef.current.filter(u => u.id !== t.id && normalizeRemotePath(u.remotePath) !== normPath);
                                   setActiveTransfers(prev => prev.filter(x => x.id !== t.id));

                                   ipcRenderer.invoke('sftp-cancel-upload', { id, transferId: t.id });
                                   if (t.type === 'upload') {
                                       ipcRenderer.invoke('sftp-rm', { id, path: t.remotePath, isDir: t.isDir });
                                   }
                               }}/>

            {contextMenu && (
                <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} options={[
                    ...(contextMenu.file ? [
                        ...(selectedFilenames.length <= 1 ? [
                            {
                                label: ((contextMenu.file.attrs.mode & 0o040000) !== 0 || (contextMenu.file.targetAttrs && (contextMenu.file.targetAttrs.mode & 0o040000) !== 0)) ? 'Перейти' : 'Открыть',
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
                                label: 'Переименовать', icon: <Edit size={14}/>, onClick: () => {
                                    setModal({type: 'rename', file: contextMenu.file});
                                    setModalInput(contextMenu.file!.filename);
                                }
                            },
                            {
                                label: 'Права доступа', icon: <Shield size={14}/>, onClick: () => {
                                    setModal({type: 'permissions', file: contextMenu.file});
                                    setModalInput((contextMenu.file!.attrs.mode & 0o777).toString(8));
                                }
                            }
                        ] : []),
                        {label: 'Скачать', icon: <Download size={14}/>, onClick: () => handleDownload(selectedFilenames)},
                        ...( !((contextMenu.file.attrs.mode & 0o040000) !== 0) && ['.zip', '.tar', '.gz', '.tgz', '.bz2'].some(ext => contextMenu.file!.filename.toLowerCase().endsWith(ext)) ? [{
                            label: 'Распаковать',
                            icon: <Archive size={14}/>,
                            onClick: () => {
                                ipcRenderer.invoke('sftp-extract', {
                                    id,
                                    remotePath: `${path}/${contextMenu.file!.filename}`.replace(/\/+/g, '/')
                                }).then(() => loadDirectory(path));
                            }
                        }] : [])
                    ] : []),
                    {
                        label: 'Создать папку',
                        icon: <Archive size={14}/>,
                        onClick: () => {
                            setModal({type: 'mkdir'});
                            setModalInput('Новая папка');
                        }
                    },
                    {
                        label: 'Обновить',
                        icon: <RefreshCw size={14}/>,
                        onClick: () => loadDirectory(path)
                    },
                    ...(contextMenu.file ? [{
                        label: 'Удалить',
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
                        onClose={() => setModal(null)} onConfirm={() => {
                if (modal?.type === 'delete') handleDelete(); else if (modal?.type === 'rename') handleRename(); else if (modal?.type === 'mkdir') handleCreateDirectory(); else if (modal?.type === 'permissions') handlePermissions(); else if (modal?.type === 'error') setModal(null); else if (modal?.type === 'cancelUpload') setModal(null); else if (modal?.type === 'fileUpdate') {
                    const transferId = Math.random().toString(36).substr(2, 9);
                    ipcRenderer.invoke('fs-stat', modal.localPath).then((stats: { size: number }) => {
                        const newTransfer: Transfer = {
                            id: transferId,
                            filename: modal.filename || 'unknown',
                            remotePath: modal.remotePath!,
                            progress: 0,
                            size: stats?.size || 0,
                            type: 'upload',
                            status: 'active'
                        };
                        setActiveTransfers(prev => [newTransfer, ...prev]);
                        ipcRenderer.invoke('sftp-upload-direct', {
                            id,
                            localPath: modal.localPath,
                            remotePath: modal.remotePath,
                            transferId
                        }).then(() => {
                            setModal(null);
                            loadDirectory(path);
                        });
                    });
                }
            }} />

        </div>
    );
};
