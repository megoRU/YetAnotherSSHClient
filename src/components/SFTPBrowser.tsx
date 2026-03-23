import React, {useEffect, useState, useCallback, useRef} from 'react';
import {File, Folder, RefreshCw, Home, ArrowUp, Download, Upload, Edit, Trash2, Shield, MousePointer2, Archive, UploadCloud, AlertTriangle, X, Plus, Minus} from 'lucide-react';
import {ContextMenu} from './ContextMenu';
interface SftpFileEntry {
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

interface SftpProgress {
    remotePath: string;
    progress: number;
    transferred?: number;
    total?: number;
    type: 'upload' | 'download';
}

type SftpTransferStatus = 'active' | 'success' | 'error' | 'cancelled';

interface SSHConfig {
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

const {ipcRenderer} = window as {
    ipcRenderer: {
        send: (channel: string, ...args: any[]) => void;
        on: (channel: string, func: (...args: any[]) => void) => () => void;
        invoke: (channel: string, ...args: any[]) => Promise<any>;
        getPathForFile?: (file: File) => string;
    }
};

interface Transfer {
    id: string;
    filename: string;
    remotePath: string;
    progress: number;
    size?: number;
    type: 'upload' | 'download';
    status: SftpTransferStatus;
    error?: string;
}

interface Props {
    id: string;
    config: SSHConfig;
    visible?: boolean;
}

export const SFTPBrowser: React.FC<Props> = ({id, config, visible}) => {
    const [theme, setTheme] = useState(document.body.className);
    const [path, setPath] = useState('');
    const [files, setFiles] = useState<SftpFileEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState('Подключение...');
    const [activeTransfers, setActiveTransfers] = useState<Transfer[]>([]);
    const [showTransfers, setShowTransfers] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const dragCounter = useRef(0);
    const pendingDeletesRef = useRef<string[]>([]);

    // Selection state
    const [selectedFilenames, setSelectedFilenames] = useState<string[]>([]);
    const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, file?: SftpFileEntry } | null>(null);

    // Modal states
    const [modal, setModal] = useState<{ type: 'delete' | 'rename' | 'permissions' | 'error' | 'cancelUpload' | 'fileUpdate', file?: SftpFileEntry, errorMessage?: string, cancelPath?: string, localPath?: string, remotePath?: string, filename?: string } | null>(null);
    const [modalInput, setModalInput] = useState('');

    const isConnectingRef = useRef(false);

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const showError = (msg: string) => {
        setModal({ type: 'error', errorMessage: msg });
    };

    const wasConnectedRef = useRef(false);

    const normalizeRemotePath = (p: string) => {
        if (!p) return '/';
        const normalized = p.replace(/\/+/g, '/').replace(/\/$/, '');
        return normalized || '/';
    };

    const loadDirectory = useCallback(async (dirPath: string, force = false) => {
        if (!force && status !== 'SFTP-сессия готова') return;
        const normalizedPath = normalizeRemotePath(dirPath);
        setLoading(true);
        setError(null);
        setSelectedFilenames([]);
        setLastSelectedIndex(-1);
        try {
            const list: SftpFileEntry[] | null = await ipcRenderer.invoke('sftp-readdir', {id, path: normalizedPath});
            const filteredList = (list || []).filter((f: SftpFileEntry) => !f.filename.startsWith('.'));
            filteredList.sort((a: SftpFileEntry, b: SftpFileEntry) => {
                const aIsDir = (a.attrs.mode & 0o040000) !== 0;
                const bIsDir = (b.attrs.mode & 0o040000) !== 0;
                if (aIsDir && !bIsDir) return -1;
                if (!aIsDir && bIsDir) return 1;
                return a.filename.localeCompare(b.filename);
            });
            setFiles(filteredList);
            setPath(dirPath);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('No response from server') || msg.includes('Channel closed') || msg.includes('not found')) {
                // Ignore errors during reconnection
                return;
            }
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [id, status]);

    useEffect(() => {
        const observer = new MutationObserver(() => setTheme(document.body.className));
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    const connect = useCallback(() => {
        setStatus('Подключение...');
        setError(null);
        isConnectingRef.current = false;
        wasConnectedRef.current = false;
        ipcRenderer.send('sftp-connect', {id, config});
    }, [id, config]);

    useEffect(() => {
        // Prevent default behavior for drag and drop on the entire window
        const preventDefault = (e: DragEvent) => e.preventDefault();
        window.addEventListener('dragover', preventDefault);
        window.addEventListener('drop', preventDefault);

        const unsubStatus = ipcRenderer.on(`sftp-status-${id}`, async (msg: string) => {
            setStatus(msg);
            if (msg === 'SFTP-сессия готова') {
                wasConnectedRef.current = true;
                if (!isConnectingRef.current) {
                    isConnectingRef.current = true;

                    // Cleanup partial files from previous cancelled uploads
                    if (pendingDeletesRef.current.length > 0) {
                        const toDelete = [...pendingDeletesRef.current];
                        pendingDeletesRef.current = [];
                        for (const p of toDelete) {
                            try {
                                await ipcRenderer.invoke('sftp-rm', { id, path: p, isDir: false });
                            } catch (e) {
                                // ignore
                            }
                        }
                    }

                    ipcRenderer.invoke('sftp-realpath', {id, path: '.'}).then((resolvedPath: string) => {
                        loadDirectory(resolvedPath, true);
                    }).catch(() => {
                        loadDirectory('/', true);
                    });
                }
            } else {
                isConnectingRef.current = false;
            }
        });

        const unsubError = ipcRenderer.on(`sftp-error-${id}`, (msg: string) => {
            setError(msg);
            setStatus('Ошибка');
            setLoading(false);
            isConnectingRef.current = false;
        });

        const unsubFileChanged = ipcRenderer.on(`sftp-file-changed-${id}`, (data: { localPath: string, remotePath: string, filename: string }) => {
            setModal({
                type: 'fileUpdate',
                localPath: data.localPath,
                remotePath: data.remotePath,
                filename: data.filename
            });
        });

        const unsubProgress = ipcRenderer.on(`sftp-progress-${id}`, (data: SftpProgress) => {
            setActiveTransfers(prev => {
                const normalizedPath = normalizeRemotePath(data.remotePath);
                const existingIndex = prev.findIndex(t =>
                    normalizeRemotePath(t.remotePath) === normalizedPath &&
                    t.type === data.type &&
                    t.status === 'active'
                );

                if (existingIndex !== -1) {
                    const newTransfers = [...prev];
                    const existing = newTransfers[existingIndex];
                    newTransfers[existingIndex] = {
                        ...existing,
                        progress: data.progress,
                        size: data.total || existing.size,
                        status: data.progress >= 100 ? 'success' : 'active'
                    };
                    return newTransfers;
                }

                // If not found (e.g. background recursive download starts a new file), add it
                if (data.progress < 100) {
                    const newTransfer: Transfer = {
                        id: Math.random().toString(36).substr(2, 9),
                        filename: normalizedPath.split('/').pop() || normalizedPath || 'unknown',
                        remotePath: normalizedPath,
                        progress: data.progress,
                        size: data.total,
                        type: data.type,
                        status: 'active'
                    };
                    return [newTransfer, ...prev];
                }
                return prev;
            });
        });

        connect();

        return () => {
            window.removeEventListener('dragover', preventDefault);
            window.removeEventListener('drop', preventDefault);
            if (typeof unsubStatus === 'function') unsubStatus();
            if (typeof unsubError === 'function') unsubError();
            if (typeof unsubProgress === 'function') unsubProgress();
            if (typeof unsubFileChanged === 'function') unsubFileChanged();
            ipcRenderer.send('ssh-close', id);
        };
    }, [id]);

    const handleNavigate = (filename: string, isDir: boolean) => {
        if (!isDir) return;
        const newPath = path === '/' ? `/${filename}` : `${path}/${filename}`.replace(/\/+/g, '/');
        loadDirectory(newPath);
    };

    const handleGoUp = () => {
        if (path === '/' || !path) return;
        const parts = path.split('/').filter(Boolean);
        parts.pop();
        const newPath = '/' + parts.join('/');
        loadDirectory(newPath);
    };

    const handleDownload = async (filenames: string[]) => {
        if (filenames.length === 0) return;

        const newTransfers: Transfer[] = filenames.map(filename => ({
            id: Math.random().toString(36).substr(2, 9),
            filename,
            remotePath: normalizeRemotePath(`${path}/${filename}`),
            progress: 0,
            type: 'download',
            status: 'active'
        }));
        setActiveTransfers(prev => [...newTransfers, ...prev]);
        setShowTransfers(true);

        try {
            if (filenames.length === 1) {
                const filename = filenames[0];
                const remotePath = `${path}/${filename}`.replace(/\/+/g, '/');
                await ipcRenderer.invoke('sftp-download-file', {id, remotePath, filename});
            } else {
                const filesToDownload = filenames.map(filename => ({
                    filename,
                    remotePath: `${path}/${filename}`.replace(/\/+/g, '/')
                }));
                await ipcRenderer.invoke('sftp-download-multiple-files', {id, files: filesToDownload});
            }
            loadDirectory(path);
        } catch (err: any) {
            const msg = err.message || String(err);
            if (msg.includes('No response from server') || msg.includes('Channel closed') || msg.includes('destroyed')) {
                return;
            }
            showError(`Ошибка скачивания: ${msg}`);
            // Mark these transfers as error
            setActiveTransfers(prev => prev.map(t =>
                newTransfers.find(nt => nt.remotePath === t.remotePath && nt.type === 'download')
                ? { ...t, status: 'error', error: msg }
                : t
            ));
        }
    };

    const handleUpload = async () => {
        try {
            // Since sftp-upload-file opens a dialog, we can't pre-calculate Transfers.
            // But we know it's an upload, and the progress events will handle adding it.
            const results = await ipcRenderer.invoke('sftp-upload-file', {id, remoteDir: path});
            if (results && results.length > 0) {
                setShowTransfers(true);
                loadDirectory(path);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            showError(`Ошибка загрузки: ${msg}`);
        }
    };

    const handleEdit = async (filename: string) => {
        const remotePath = `${path}/${filename}`.replace(/\/+/g, '/');
        try {
            await ipcRenderer.invoke('sftp-open-in-editor', {id, remotePath, filename});
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            showError(`Ошибка открытия: ${msg}`);
        }
    };

    const handleDelete = async () => {
        const itemsToDelete = selectedFilenames.length > 0 ? selectedFilenames : (modal?.file ? [modal.file.filename] : []);
        if (itemsToDelete.length === 0) return;

        setLoading(true);
        try {
            for (const filename of itemsToDelete) {
                const file = files.find(f => f.filename === filename);
                if (!file) continue;
                const isDir = (file.attrs.mode & 0o040000) !== 0;
                const remotePath = `${path}/${filename}`.replace(/\/+/g, '/');
                await ipcRenderer.invoke('sftp-rm', {id, path: remotePath, isDir});
            }
            setModal(null);
            loadDirectory(path);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            showError(`Ошибка удаления: ${msg}`);
            setLoading(false);
        }
    };

    const handleRename = async () => {
        if (!modal?.file || !modalInput) return;
        const oldPath = `${path}/${modal.file.filename}`.replace(/\/+/g, '/');
        const newPath = `${path}/${modalInput}`.replace(/\/+/g, '/');
        try {
            await ipcRenderer.invoke('sftp-rename', {id, oldPath, newPath});
            setModal(null);
            loadDirectory(path);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            showError(`Ошибка переименования: ${msg}`);
        }
    };

    const handlePermissions = async () => {
        if (!modal?.file || !modalInput) return;
        const remotePath = `${path}/${modal.file.filename}`.replace(/\/+/g, '/');
        try {
            // mode from input (e.g. 755) to octal number
            const mode = parseInt(modalInput, 8);
            await ipcRenderer.invoke('sftp-chmod', {id, path: remotePath, mode});
            setModal(null);
            loadDirectory(path);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            showError(`Ошибка изменения прав: ${msg}`);
        }
    };

    const handleUpdateFromServer = async () => {
        if (!modal || modal.type !== 'fileUpdate' || !modal.localPath || !modal.remotePath) return;
        try {
            await ipcRenderer.invoke('sftp-upload-direct', {
                id,
                localPath: modal.localPath,
                remotePath: modal.remotePath
            });
            setModal(null);
            loadDirectory(path);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            showError(`Ошибка обновления файла: ${msg}`);
        }
    };

    const handleExtract = async (filename: string) => {
        const remotePath = `${path}/${filename}`.replace(/\/+/g, '/');
        setLoading(true);
        setStatus('Распаковка...');
        try {
            await ipcRenderer.invoke('sftp-extract', {id, remotePath});
            loadDirectory(path);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            showError(`Ошибка распаковки: ${msg}`);
            setLoading(false);
            setStatus('SFTP-сессия готова');
        }
    };

    const handleFileClick = (e: React.MouseEvent, filename: string, index: number) => {
        if (e.shiftKey && lastSelectedIndex !== -1) {
            const start = Math.min(lastSelectedIndex, index);
            const end = Math.max(lastSelectedIndex, index);
            const newSelection = files.slice(start, end + 1).map(f => f.filename);
            setSelectedFilenames(Array.from(new Set([...selectedFilenames, ...newSelection])));
        } else if (e.ctrlKey || e.metaKey) {
            setSelectedFilenames(prev =>
                prev.includes(filename) ? prev.filter(f => f !== filename) : [...prev, filename]
            );
            setLastSelectedIndex(index);
        } else {
            setSelectedFilenames([filename]);
            setLastSelectedIndex(index);
        }
    };

    const onFileContextMenu = (e: React.MouseEvent, file: SftpFileEntry) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedFilenames.includes(file.filename)) {
            setSelectedFilenames([file.filename]);
            setLastSelectedIndex(files.findIndex(f => f.filename === file.filename));
        }
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            file: file
        });
    };

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current++;
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            setIsDragging(true);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current--;
        if (dragCounter.current === 0) {
            setIsDragging(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        dragCounter.current = 0;

        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length === 0) return;

        const filePaths = droppedFiles.map(f => {
            if (ipcRenderer.getPathForFile) return ipcRenderer.getPathForFile(f);
            return (f as any).path;
        }).filter(Boolean);

        if (filePaths.length === 0) return;

        // Add to active transfers immediately
        const newTransfers: Transfer[] = droppedFiles.map(f => ({
            id: Math.random().toString(36).substr(2, 9),
            filename: f.name,
            remotePath: normalizeRemotePath(`${path}/${f.name}`),
            progress: 0,
            size: f.size,
            type: 'upload',
            status: 'active'
        }));
        setActiveTransfers(prev => [...newTransfers, ...prev]);
        setShowTransfers(true);

        try {
            const results = await ipcRenderer.invoke('sftp-upload-files-from-paths', {
                id,
                remoteDir: path,
                filePaths
            });
            if (results && results.length > 0) {
                loadDirectory(path);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('No response from server') || msg.includes('Channel closed') || msg.includes('destroyed')) {
                return;
            }
            showError(`Ошибка загрузки: ${msg}`);
            // Cleanup failed uploads
            const failedPaths = newTransfers.map(u => u.remotePath);
            pendingDeletesRef.current = Array.from(new Set([...pendingDeletesRef.current, ...failedPaths]));
            setActiveTransfers(prev => prev.map(t =>
                newTransfers.find(nt => nt.remotePath === t.remotePath && nt.type === 'upload')
                ? { ...t, status: 'error', error: msg }
                : t
            ));
        }
    };

    const handleCancelUpload = async () => {
        try {
            // Save paths for later cleanup
            const uploadsToCancel = activeTransfers.filter(t => t.type === 'upload' && t.status === 'active');
            const pathsToCleanup = uploadsToCancel.map(u => u.remotePath);
            pendingDeletesRef.current = Array.from(new Set([...pendingDeletesRef.current, ...pathsToCleanup]));

            ipcRenderer.invoke('sftp-cancel-upload', { id });

            setActiveTransfers(prev => prev.map(t => t.status === 'active' ? { ...t, status: 'cancelled' } : t));
            isConnectingRef.current = false;
            wasConnectedRef.current = false; // Reset connection state
            setStatus('Подключение...');
            setModal(null);

            // Re-connect after a short delay
            setTimeout(() => {
                ipcRenderer.send('sftp-connect', {id, config});
            }, 1500);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            showError(`Ошибка отмены: ${msg}`);
        }
    };

    const displayStyle = visible ? 'flex' : 'none';
    const isDark = theme.includes('dark');
    const primaryRed = isDark ? '#fb4934' : '#c81e51';

    return (
        <div
            className={`sftp-container ${isDragging ? 'dragging' : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => {
                setSelectedFilenames([]);
                setLastSelectedIndex(-1);
            }}
            style={{
                display: displayStyle,
                flexDirection: 'column',
                height: '100%',
                width: '100%',
                background: 'var(--bg-color)',
                color: 'var(--text-color)',
                userSelect: 'none',
                position: 'relative'
            }}
        >
            {isDragging && (
                <div style={{
                    position: 'absolute',
                    top: '10px',
                    left: '10px',
                    right: '10px',
                    bottom: '10px',
                    background: isDark ? 'rgba(251, 73, 52, 0.15)' : 'rgba(200, 30, 81, 0.15)',
                    border: `3px dashed ${primaryRed}`,
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
                        <div style={{ fontWeight: 'bold', fontSize: '1.2em' }}>
                            Перетащите файлы сюда для загрузки
                        </div>
                    </div>
                </div>
            )}
            {/* Transfers Panel */}
            <div className={`sftp-transfers-panel ${showTransfers ? 'open' : ''}`} style={{
                position: 'absolute',
                bottom: 0,
                right: '20px',
                width: '350px',
                maxHeight: '400px',
                background: 'var(--bg-color)',
                border: '1px solid var(--border-color)',
                borderBottom: 'none',
                borderTopLeftRadius: '8px',
                borderTopRightRadius: '8px',
                zIndex: 100,
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 -4px 12px rgba(0,0,0,0.15)',
                transform: showTransfers ? 'translateY(0)' : 'translateY(calc(100% - 40px))',
                transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            }}>
                <div
                    onClick={() => setShowTransfers(!showTransfers)}
                    style={{
                        padding: '10px 15px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        background: 'rgba(0,0,0,0.03)',
                        borderBottom: '1px solid var(--border-color)',
                        borderTopLeftRadius: '8px',
                        borderTopRightRadius: '8px'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
                        <UploadCloud size={16} color={primaryRed} />
                        Передачи ({activeTransfers.filter(t => t.status === 'active').length})
                    </div>
                    {showTransfers ? <Minus size={16} /> : <Plus size={16} />}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
                    {activeTransfers.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', opacity: 0.5, fontSize: '13px' }}>
                            Нет активных передач
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {activeTransfers.map(transfer => (
                                <div key={transfer.id} style={{
                                    padding: '10px',
                                    background: 'rgba(0,0,0,0.02)',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-color)'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                                            {transfer.type === 'upload' ? <Upload size={14} /> : <Download size={14} />}
                                            <span style={{
                                                fontSize: '13px',
                                                fontWeight: 'bold',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis'
                                            }}>
                                                {transfer.filename}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontSize: '12px', color: primaryRed, fontWeight: 'bold' }}>
                                                {transfer.status === 'success' ? 'OK' : transfer.status === 'active' ? `${transfer.progress}%` : '!'}
                                            </span>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (transfer.status === 'active') {
                                                        setModal({ type: 'cancelUpload', cancelPath: transfer.remotePath });
                                                    } else {
                                                        setActiveTransfers(prev => prev.filter(t => t.id !== transfer.id));
                                                    }
                                                }}
                                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', display: 'flex', alignItems: 'center', opacity: 0.6 }}
                                                title={transfer.status === 'active' ? "Отменить" : "Убрать из списка"}
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    <div style={{ width: '100%', height: '4px', background: 'rgba(0,0,0,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                                        <div style={{
                                            width: `${transfer.progress}%`,
                                            height: '100%',
                                            background: transfer.status === 'success' ? '#50fa7b' : transfer.status === 'error' ? '#ff5555' : primaryRed,
                                            transition: 'width 0.2s'
                                        }} />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                                        <span style={{ fontSize: '10px', opacity: 0.6 }}>
                                            {transfer.size ? formatSize(transfer.size) : '--'}
                                        </span>
                                        <span style={{ fontSize: '10px', opacity: 0.6 }}>
                                            {transfer.status === 'active' ? 'В процессе...' : transfer.status === 'success' ? 'Успешно' : 'Ошибка'}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {activeTransfers.length > 0 && (
                    <div style={{ padding: '10px', borderTop: '1px solid var(--border-color)', textAlign: 'center' }}>
                        <button
                            className="btn-secondary"
                            style={{ fontSize: '12px', padding: '4px 10px' }}
                            onClick={() => setActiveTransfers([])}
                        >
                            Очистить список
                        </button>
                    </div>
                )}
            </div>

            {/* Toolbar */}
            <div className="sftp-toolbar" style={{
                padding: '10px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: 'rgba(0,0,0,0.02)'
            }} onClick={e => e.stopPropagation()}>
                <button
                    onClick={handleGoUp}
                    disabled={path === '/' || !path || loading}
                    className="btn-secondary"
                    title="Наверх"
                    style={{padding: '5px', display: 'flex', alignItems: 'center'}}
                >
                    <ArrowUp size={18} />
                </button>
                <button
                    onClick={() => loadDirectory('/')}
                    disabled={loading}
                    className="btn-secondary"
                    title="Корень"
                    style={{padding: '5px', display: 'flex', alignItems: 'center'}}
                >
                    <Home size={18} />
                </button>
                <button
                    onClick={() => loadDirectory(path)}
                    disabled={loading}
                    className="btn-secondary"
                    title="Обновить"
                    style={{padding: '5px', display: 'flex', alignItems: 'center'}}
                >
                    <RefreshCw size={18} className={loading ? 'spin' : ''} />
                </button>
                <div style={{
                    flex: 1,
                    background: 'var(--input-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    padding: '5px 10px',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    gap: '10px'
                }}>
                    <span style={{
                        background: primaryRed,
                        color: 'white',
                        fontSize: '10px',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        fontWeight: 'bold',
                        flexShrink: 0
                    }}>BETA</span>
                    {path}
                </div>
                <button
                    onClick={handleUpload}
                    disabled={loading}
                    className="btn-primary"
                    style={{padding: '5px 15px', display: 'flex', alignItems: 'center', gap: '8px'}}
                >
                    <Upload size={18} />
                    Загрузить
                </button>
            </div>

            {/* Content */}
            <div className="sftp-content" style={{flex: 1, overflowY: 'auto', position: 'relative'}}>
                {(loading || status !== 'SFTP-сессия готова') && files.length === 0 && activeTransfers.filter(t => t.status === 'active').length === 0 && (
                    <div style={{
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
                        <div className="loading-spinner" />
                        <div style={{ fontWeight: 'bold' }}>{status}</div>
                    </div>
                )}

                {error && (
                    <div style={{padding: '20px', color: '#cc241d', background: 'rgba(204, 36, 29, 0.1)', margin: '10px', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                        <div><strong>Ошибка:</strong> {error}</div>
                        <button className="btn-primary" onClick={connect} style={{padding: '5px 15px', fontSize: '12px'}}>
                            Переподключиться
                        </button>
                    </div>
                )}

                <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '14px'}}>
                    <thead style={{
                        position: 'sticky',
                        top: 0,
                        background: 'var(--bg-color)',
                        zIndex: 1,
                        textAlign: 'left',
                        boxShadow: '0 1px 0 var(--border-color)'
                    }}>
                        <tr>
                            <th style={{padding: '10px', width: '30px'}}></th>
                            <th style={{padding: '10px'}}>Имя</th>
                            <th style={{padding: '10px', width: '100px'}}>Размер</th>
                            <th style={{padding: '10px', width: '150px'}}>Дата</th>
                        </tr>
                    </thead>
                    <tbody>
                        {files.map((file, index) => {
                            const isDir = (file.attrs.mode & 0o040000) !== 0;
                            const isSelected = selectedFilenames.includes(file.filename);

                            return (
                                <tr
                                    key={file.filename}
                                    className={`sftp-row ${isSelected ? 'selected' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleFileClick(e, file.filename, index);
                                    }}
                                    onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        if (isDir) {
                                            handleNavigate(file.filename, isDir);
                                        } else {
                                            handleEdit(file.filename);
                                        }
                                    }}
                                    onContextMenu={(e) => onFileContextMenu(e, file)}
                                    style={{cursor: 'pointer', position: 'relative'}}
                                >
                                    <td style={{padding: '8px 10px', textAlign: 'center'}}>
                                        {isDir ? <Folder size={18} color="#d79921" /> : <File size={18} opacity={0.7} />}
                                    </td>
                                    <td style={{padding: '8px 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                        {file.filename}
                                    </td>
                                    <td style={{padding: '8px 10px', opacity: 0.7}}>
                                        {isDir ? '--' : formatSize(file.attrs.size)}
                                    </td>
                                    <td style={{padding: '8px 10px', opacity: 0.7, fontSize: '12px'}}>
                                        {new Date(file.attrs.mtime * 1000).toLocaleString()}
                                    </td>
                                </tr>
                            );
                        })}
                        {!loading && files.length === 0 && !error && (
                            <tr>
                                <td colSpan={4} style={{padding: '40px', textAlign: 'center', opacity: 0.5}}>
                                    Папка пуста
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                    options={[
                        {
                            label: (contextMenu.file && (contextMenu.file.attrs.mode & 0o040000) !== 0) ? 'Перейти' : 'Открыть',
                            icon: <MousePointer2 size={14} />,
                            onClick: () => {
                                if (contextMenu.file) {
                                    const isDir = (contextMenu.file.attrs.mode & 0o040000) !== 0;
                                    if (isDir) {
                                        handleNavigate(contextMenu.file.filename, true);
                                    } else {
                                        handleEdit(contextMenu.file.filename);
                                    }
                                }
                            }
                        },
                        {
                            label: 'Переименовать',
                            icon: <Edit size={14} />,
                            onClick: () => {
                                if (contextMenu.file) {
                                    setModal({ type: 'rename', file: contextMenu.file });
                                    setModalInput(contextMenu.file.filename);
                                }
                            }
                        },
                        {
                            label: 'Права доступа',
                            icon: <Shield size={14} />,
                            onClick: () => {
                                if (contextMenu.file) {
                                    setModal({ type: 'permissions', file: contextMenu.file });
                                    setModalInput((contextMenu.file.attrs.mode & 0o777).toString(8));
                                }
                            }
                        },
                        {
                            label: 'Редактировать',
                            icon: <Edit size={14} />,
                            onClick: () => {
                                if (contextMenu.file) {
                                    handleEdit(contextMenu.file.filename);
                                }
                            }
                        },
                        {
                            label: 'Скачать',
                            icon: <Download size={14} />,
                            onClick: () => {
                                handleDownload(selectedFilenames);
                            }
                        },
                        {
                            label: 'Удалить',
                            icon: <Trash2 size={14} />,
                            danger: true,
                            onClick: () => {
                                setModal({ type: 'delete', file: contextMenu.file });
                            }
                        },
                        ...(contextMenu.file && !((contextMenu.file.attrs.mode & 0o040000) !== 0) && ['.zip', '.tar', '.gz', '.tgz', '.bz2'].some(ext => contextMenu.file!.filename.toLowerCase().endsWith(ext)) ? [{
                            label: 'Распаковать',
                            icon: <Archive size={14} />,
                            onClick: () => {
                                handleExtract(contextMenu.file!.filename);
                            }
                        }] : [])
                    ]}
                />
            )}

            {/* Custom Modals */}
            {modal && (
                <div style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 2000
                }} onClick={() => setModal(null)}>
                    <div style={{
                        background: 'var(--bg-color)',
                        padding: '20px',
                        borderRadius: '8px',
                        width: '400px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                        border: '1px solid var(--border-color)'
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                            {modal.type === 'error' || modal.type === 'cancelUpload' ? <AlertTriangle color="#cc241d" size={24} /> : null}
                            <h3 style={{ marginTop: 0, marginBottom: 0 }}>
                                {modal.type === 'delete' && 'Удаление'}
                                {modal.type === 'rename' && 'Переименование'}
                                {modal.type === 'permissions' && 'Права доступа'}
                                {modal.type === 'error' && 'Ошибка'}
                                {modal.type === 'cancelUpload' && 'Отмена загрузки'}
                                {modal.type === 'fileUpdate' && 'Обновление файла'}
                            </h3>
                        </div>

                        {modal.type === 'delete' && (
                            <p>Вы уверены, что хотите удалить <b>{selectedFilenames.length > 1 ? `${selectedFilenames.length} элементов` : modal.file?.filename}</b>?</p>
                        )}

                        {modal.type === 'fileUpdate' && (
                            <p>Файл <b>{modal.filename}</b> был изменен. Обновить его на сервере?</p>
                        )}

                        {modal.type === 'error' && (
                            <p style={{ color: '#cc241d' }}>{modal.errorMessage}</p>
                        )}

                        {modal.type === 'cancelUpload' && (
                            <p>Вы уверены, что хотите отменить все текущие загрузки? Это приведет к временному разрыву соединения.</p>
                        )}

                        {(modal.type === 'rename' || modal.type === 'permissions') && (
                            <input
                                autoFocus
                                value={modalInput}
                                onChange={e => setModalInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && (modal.type === 'rename' ? handleRename() : handlePermissions())}
                                style={{
                                    width: '100%',
                                    padding: '8px',
                                    marginBottom: '20px',
                                    background: 'var(--input-bg)',
                                    color: 'var(--text-color)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '4px'
                                }}
                            />
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            {modal.type !== 'error' && <button className="btn-secondary" onClick={() => setModal(null)}>Отмена</button>}
                            <button
                                className="btn-primary"
                                onClick={() => {
                                    if (modal.type === 'delete') handleDelete();
                                    else if (modal.type === 'rename') handleRename();
                                    else if (modal.type === 'permissions') handlePermissions();
                                    else if (modal.type === 'error') setModal(null);
                                    else if (modal.type === 'cancelUpload') handleCancelUpload();
                                    else if (modal.type === 'fileUpdate') handleUpdateFromServer();
                                }}
                            >
                                {modal.type === 'delete' ? 'Удалить' : modal.type === 'error' ? 'OK' : modal.type === 'cancelUpload' ? 'Да, отменить' : modal.type === 'fileUpdate' ? 'Обновить' : 'Сохранить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .sftp-row:hover {
                    background: rgba(0,0,0,0.05);
                }
                .sftp-row.selected {
                    background: rgba(200, 30, 81, 0.15) !important;
                }
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .loading-spinner {
                    width: 30px;
                    height: 30px;
                    border: 3px solid var(--border-color);
                    border-top: 3px solid ${primaryRed};
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }
            `}</style>
        </div>
    );
};
