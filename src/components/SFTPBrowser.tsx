import React, { useEffect, useState, useCallback, useRef } from 'react';
import { MousePointer2, Archive, UploadCloud, Edit, Trash2, Shield, Download } from 'lucide-react';
import { ContextMenu } from './layout/ContextMenu';
import { SftpToolbar } from './sftp/SftpToolbar';
import { SftpFileList } from './sftp/SftpFileList';
import { SftpTransferPanel } from './sftp/SftpTransferPanel';
import { SftpModals } from './sftp/SftpModals';
import type { SftpFileEntry, SftpProgress, Transfer, SSHConfig } from '../types';
import { normalizeRemotePath } from '../utils';

const { ipcRenderer } = window as any;

interface Props {
    id: string;
    config: SSHConfig;
    visible?: boolean;
}

export const SFTPBrowser: React.FC<Props> = ({ id, config, visible }) => {
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

    const [selectedFilenames, setSelectedFilenames] = useState<string[]>([]);
    const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, file?: SftpFileEntry } | null>(null);
    const [modal, setModal] = useState<{ type: string, file?: SftpFileEntry, errorMessage?: string, cancelPath?: string, localPath?: string, remotePath?: string, filename?: string } | null>(null);
    const [modalInput, setModalInput] = useState('');

    const isConnectingRef = useRef(false);
    const wasConnectedRef = useRef(false);

    const loadDirectory = useCallback(async (dirPath: string, force = false) => {
        if (!force && status !== 'SFTP-сессия готова') return;
        const normalizedPath = normalizeRemotePath(dirPath);
        setLoading(true);
        setError(null);
        setSelectedFilenames([]);
        setLastSelectedIndex(-1);
        try {
            const list: SftpFileEntry[] | null = await ipcRenderer.invoke('sftp-readdir', { id, path: normalizedPath });
            const filteredList = (list || []).filter((f: SftpFileEntry) => !f.filename.startsWith('.'));
            filteredList.sort((a, b) => {
                const aIsDir = (a.attrs.mode & 0o040000) !== 0;
                const bIsDir = (b.attrs.mode & 0o040000) !== 0;
                if (aIsDir && !bIsDir) return -1;
                if (!aIsDir && bIsDir) return 1;
                return a.filename.localeCompare(b.filename);
            });
            setFiles(filteredList);
            setPath(dirPath);
        } catch (err: any) {
            if (err.message?.includes('No response from server')) return;
            setError(err.message || String(err));
        } finally {
            setLoading(false);
        }
    }, [id, status]);

    const connect = useCallback(() => {
        setStatus('Подключение...');
        setError(null);
        isConnectingRef.current = false;
        wasConnectedRef.current = false;
        ipcRenderer.send('sftp-connect', { id, config });
    }, [id, config]);

    useEffect(() => {
        const preventDefault = (e: DragEvent) => e.preventDefault();
        window.addEventListener('dragover', preventDefault);
        window.addEventListener('drop', preventDefault);

        const unsubStatus = ipcRenderer.on(`sftp-status-${id}`, async (msg: string) => {
            setStatus(msg);
            if (msg === 'SFTP-сессия готова') {
                wasConnectedRef.current = true;
                if (!isConnectingRef.current) {
                    isConnectingRef.current = true;
                    if (pendingDeletesRef.current.length > 0) {
                        const toDelete = [...pendingDeletesRef.current];
                        pendingDeletesRef.current = [];
                        for (const p of toDelete) {
                            try { await ipcRenderer.invoke('sftp-rm', { id, path: p, isDir: false }); } catch (e) { }
                        }
                    }
                    ipcRenderer.invoke('sftp-realpath', { id, path: '.' }).then((resolvedPath: string) => {
                        loadDirectory(resolvedPath, true);
                    }).catch(() => loadDirectory('/', true));
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

        const unsubFileChanged = ipcRenderer.on(`sftp-file-changed-${id}`, (data: any) => {
            setModal({ type: 'fileUpdate', ...data });
        });

        const unsubProgress = ipcRenderer.on(`sftp-progress-${id}`, (data: SftpProgress) => {
            setActiveTransfers(prev => {
                const normalizedPath = normalizeRemotePath(data.remotePath);
                const existingIndex = prev.findIndex(t => normalizeRemotePath(t.remotePath) === normalizedPath && t.type === data.type && t.status === 'active');

                if (existingIndex !== -1) {
                    const newTransfers = [...prev];
                    newTransfers[existingIndex] = { ...newTransfers[existingIndex], progress: data.progress, size: data.total || newTransfers[existingIndex].size, status: data.progress >= 100 ? 'success' : 'active' };
                    return newTransfers;
                }
                if (data.progress < 100) {
                    return [{ id: Math.random().toString(36).substr(2, 9), filename: normalizedPath.split('/').pop() || 'unknown', remotePath: normalizedPath, progress: data.progress, size: data.total, type: data.type, status: 'active' as const }, ...prev];
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
    }, [id, config, connect, loadDirectory]);

    const handleDownload = async (filenames: string[]) => {
        if (filenames.length === 0) return;
        const newTransfers: Transfer[] = filenames.map(filename => ({ id: Math.random().toString(36).substr(2, 9), filename, remotePath: normalizeRemotePath(`${path}/${filename}`), progress: 0, type: 'download', status: 'active' as const }));
        setActiveTransfers(prev => [...newTransfers, ...prev]);
        setShowTransfers(true);
        try {
            if (filenames.length === 1) await ipcRenderer.invoke('sftp-download-file', { id, remotePath: `${path}/${filenames[0]}`.replace(/\/+/g, '/'), filename: filenames[0] });
            else await ipcRenderer.invoke('sftp-download-multiple-files', { id, files: filenames.map(f => ({ filename: f, remotePath: `${path}/${f}`.replace(/\/+/g, '/') })) });
            loadDirectory(path);
        } catch (err: any) {
            setActiveTransfers(prev => prev.map(t => newTransfers.find(nt => nt.remotePath === t.remotePath) ? { ...t, status: 'error', error: err.message } : t));
        }
    };

    const handleUpload = async () => {
        try {
            const results = await ipcRenderer.invoke('sftp-upload-file', { id, remoteDir: path });
            if (results && results.length > 0) { setShowTransfers(true); loadDirectory(path); }
        } catch (err: any) { setModal({ type: 'error', errorMessage: err.message }); }
    };

    const handleEdit = async (filename: string) => {
        try { await ipcRenderer.invoke('sftp-open-in-editor', { id, remotePath: `${path}/${filename}`.replace(/\/+/g, '/'), filename }); }
        catch (err: any) { setModal({ type: 'error', errorMessage: err.message }); }
    };

    const handleDelete = async () => {
        const items = selectedFilenames.length > 0 ? selectedFilenames : (modal?.file ? [modal.file.filename] : []);
        setLoading(true);
        try {
            for (const filename of items) {
                const file = files.find(f => f.filename === filename);
                if (file) await ipcRenderer.invoke('sftp-rm', { id, path: `${path}/${filename}`.replace(/\/+/g, '/'), isDir: (file.attrs.mode & 0o040000) !== 0 });
            }
            setModal(null); loadDirectory(path);
        } catch (err: any) { setModal({ type: 'error', errorMessage: err.message }); setLoading(false); }
    };

    const handleRename = async () => {
        if (!modal?.file || !modalInput) return;
        try {
            await ipcRenderer.invoke('sftp-rename', { id, oldPath: `${path}/${modal.file.filename}`.replace(/\/+/g, '/'), newPath: `${path}/${modalInput}`.replace(/\/+/g, '/') });
            setModal(null); loadDirectory(path);
        } catch (err: any) { setModal({ type: 'error', errorMessage: err.message }); }
    };

    const handlePermissions = async () => {
        if (!modal?.file || !modalInput) return;
        try {
            await ipcRenderer.invoke('sftp-chmod', { id, path: `${path}/${modal.file.filename}`.replace(/\/+/g, '/'), mode: parseInt(modalInput, 8) });
            setModal(null); loadDirectory(path);
        } catch (err: any) { setModal({ type: 'error', errorMessage: err.message }); }
    };

    const handleCancelUpload = async () => {
        try {
            const pathsToCleanup = activeTransfers.filter(t => t.type === 'upload' && t.status === 'active').map(u => u.remotePath);
            pendingDeletesRef.current = Array.from(new Set([...pendingDeletesRef.current, ...pathsToCleanup]));
            ipcRenderer.invoke('sftp-cancel-upload', { id });
            setActiveTransfers(prev => prev.map(t => t.status === 'active' ? { ...t, status: 'cancelled' as const } : t));
            isConnectingRef.current = wasConnectedRef.current = false;
            setStatus('Подключение...'); setModal(null);
            setTimeout(() => ipcRenderer.send('sftp-connect', { id, config }), 1500);
        } catch (err: any) { setModal({ type: 'error', errorMessage: err.message }); }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation(); setIsDragging(false); dragCounter.current = 0;
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length === 0) return;
        const filePaths = droppedFiles.map(f => (f as any).path).filter(Boolean);
        if (filePaths.length === 0) return;

        const newTransfers: Transfer[] = droppedFiles.map(f => ({ id: Math.random().toString(36).substr(2, 9), filename: f.name, remotePath: normalizeRemotePath(`${path}/${f.name}`), progress: 0, size: f.size, type: 'upload' as const, status: 'active' as const }));
        setActiveTransfers(prev => [...newTransfers, ...prev]); setShowTransfers(true);

        try {
            await ipcRenderer.invoke('sftp-upload-files-from-paths', { id, remoteDir: path, filePaths });
            loadDirectory(path);
        } catch (err: any) {
            const failedPaths = newTransfers.map(u => u.remotePath);
            pendingDeletesRef.current = Array.from(new Set([...pendingDeletesRef.current, ...failedPaths]));
            setActiveTransfers(prev => prev.map(t => newTransfers.find(nt => nt.remotePath === t.remotePath) ? { ...t, status: 'error' as const, error: err.message } : t));
        }
    };

    const isDark = theme.includes('dark');
    const primaryRed = isDark ? '#fb4934' : '#c81e51';

    return (
        <div
            className={`sftp-container ${isDragging ? 'dragging' : ''}`}
            onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; if (e.dataTransfer.items.length > 0) setIsDragging(true); }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current === 0) setIsDragging(false); }}
            onDrop={handleDrop}
            onClick={() => { setSelectedFilenames([]); setLastSelectedIndex(-1); }}
            style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', height: '100%', width: '100%', background: 'var(--bg-color)', color: 'var(--text-color)', userSelect: 'none', position: 'relative' }}
        >
            {isDragging && (
                <div style={{ position: 'absolute', top: '10px', left: '10px', right: '10px', bottom: '10px', background: isDark ? 'rgba(251, 73, 52, 0.15)' : 'rgba(200, 30, 81, 0.15)', border: `3px dashed ${primaryRed}`, borderRadius: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', zIndex: 1000, pointerEvents: 'none', backdropFilter: 'blur(2px)' }}>
                    <div style={{ background: 'var(--bg-color)', padding: '40px', borderRadius: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', color: primaryRed }}>
                        <UploadCloud size={64} strokeWidth={1.5} />
                        <div style={{ fontWeight: 'bold', fontSize: '1.2em' }}>Перетащите файлы сюда для загрузки</div>
                    </div>
                </div>
            )}

            <SftpTransferPanel showTransfers={showTransfers} setShowTransfers={setShowTransfers} activeTransfers={activeTransfers} setActiveTransfers={setActiveTransfers} primaryRed={primaryRed} onCancelTransfer={(t) => setModal({ type: 'cancelUpload', cancelPath: t.remotePath })} />
            <SftpToolbar path={path} loading={loading} primaryRed={primaryRed} onGoUp={() => { const parts = path.split('/').filter(Boolean); parts.pop(); loadDirectory('/' + parts.join('/')); }} onGoHome={() => loadDirectory('/')} onRefresh={() => loadDirectory(path)} onUpload={handleUpload} />

            <div className="sftp-content" style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
                {(loading || status !== 'SFTP-сессия готова') && files.length === 0 && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '15px', zIndex: 5, background: 'var(--bg-color)' }}><div className="loading-spinner" /><div style={{ fontWeight: 'bold' }}>{status}</div></div>}
                {error && <div style={{ padding: '20px', color: '#cc241d', background: 'rgba(204, 36, 29, 0.1)', margin: '10px', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><strong>Ошибка:</strong> {error}</div><button className="btn-primary" onClick={connect} style={{ padding: '5px 15px', fontSize: '12px' }}>Переподключиться</button></div>}
                <SftpFileList files={files} selectedFilenames={selectedFilenames} onFileClick={(e, f, i) => { if (e.shiftKey && lastSelectedIndex !== -1) { const start = Math.min(lastSelectedIndex, i), end = Math.max(lastSelectedIndex, i); setSelectedFilenames(Array.from(new Set([...selectedFilenames, ...files.slice(start, end + 1).map(f => f.filename)]))); } else if (e.ctrlKey || e.metaKey) { setSelectedFilenames(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]); setLastSelectedIndex(i); } else { setSelectedFilenames([f]); setLastSelectedIndex(i); } }} onFileDoubleClick={(f) => { if ((f.attrs.mode & 0o040000) !== 0) loadDirectory(path === '/' ? `/${f.filename}` : `${path}/${f.filename}`.replace(/\/+/g, '/')); else handleEdit(f.filename); }} onFileContextMenu={(e, f) => { e.preventDefault(); if (!selectedFilenames.includes(f.filename)) { setSelectedFilenames([f.filename]); setLastSelectedIndex(files.findIndex(x => x.filename === f.filename)); } setContextMenu({ x: e.clientX, y: e.clientY, file: f }); }} loading={loading} />
            </div>

            {contextMenu && (
                <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} options={[
                    { label: (contextMenu.file && (contextMenu.file.attrs.mode & 0o040000) !== 0) ? 'Перейти' : 'Открыть', icon: <MousePointer2 size={14} />, onClick: () => { if (contextMenu.file) { if ((contextMenu.file.attrs.mode & 0o040000) !== 0) loadDirectory(path === '/' ? `/${contextMenu.file.filename}` : `${path}/${contextMenu.file.filename}`.replace(/\/+/g, '/')); else handleEdit(contextMenu.file.filename); } } },
                    { label: 'Переименовать', icon: <Edit size={14} />, onClick: () => { if (contextMenu.file) { setModal({ type: 'rename', file: contextMenu.file }); setModalInput(contextMenu.file.filename); } } },
                    { label: 'Права доступа', icon: <Shield size={14} />, onClick: () => { if (contextMenu.file) { setModal({ type: 'permissions', file: contextMenu.file }); setModalInput((contextMenu.file.attrs.mode & 0o777).toString(8)); } } },
                    { label: 'Редактировать', icon: <Edit size={14} />, onClick: () => { if (contextMenu.file) handleEdit(contextMenu.file.filename); } },
                    { label: 'Скачать', icon: <Download size={14} />, onClick: () => handleDownload(selectedFilenames) },
                    { label: 'Удалить', icon: <Trash2 size={14} />, danger: true, onClick: () => setModal({ type: 'delete', file: contextMenu.file }) },
                    ...(contextMenu.file && !((contextMenu.file.attrs.mode & 0o040000) !== 0) && ['.zip', '.tar', '.gz', '.tgz', '.bz2'].some(ext => contextMenu.file!.filename.toLowerCase().endsWith(ext)) ? [{ label: 'Распаковать', icon: <Archive size={14} />, onClick: () => { ipcRenderer.invoke('sftp-extract', { id, remotePath: `${path}/${contextMenu.file!.filename}`.replace(/\/+/g, '/') }).then(() => loadDirectory(path)); } }] : [])
                ]} />
            )}

            <SftpModals modal={modal} modalInput={modalInput} setModalInput={setModalInput} onClose={() => setModal(null)} onConfirm={() => { if (modal?.type === 'delete') handleDelete(); else if (modal?.type === 'rename') handleRename(); else if (modal?.type === 'permissions') handlePermissions(); else if (modal?.type === 'error') setModal(null); else if (modal?.type === 'cancelUpload') handleCancelUpload(); else if (modal?.type === 'fileUpdate') { ipcRenderer.invoke('sftp-upload-direct', { id, localPath: modal.localPath, remotePath: modal.remotePath }).then(() => { setModal(null); loadDirectory(path); }); } }} selectedCount={selectedFilenames.length} />

        </div>
    );
};
