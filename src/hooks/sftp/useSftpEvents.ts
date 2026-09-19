import { useEffect } from 'react';
import type { PendingFileUpdate, SftpProgress, SSHConfig } from '../../types';
import { normalizeRemotePath } from '../../utils';

const { ipcRenderer } = window;

interface UseSftpEventsProps {
    id: string;
    config: SSHConfig;
    connect: () => void;
    rawStatusRef: React.MutableRefObject<string>;
    setStatus: (msg: string) => void;
    wasConnectedRef: React.MutableRefObject<boolean>;
    isConnectingRef: React.MutableRefObject<boolean>;
    pendingDeletesRef: React.MutableRefObject<string[]>;
    loadDirectory: (path: string, force?: boolean) => Promise<void>;
    setError: (msg: string | null) => void;
    setLoading: (loading: boolean) => void;
    cancelledTransferIdsRef: React.MutableRefObject<Set<string>>;
    cancelledPathsRef: React.MutableRefObject<Set<string>>;
    setActiveTransfers: React.Dispatch<React.SetStateAction<import('../../types').Transfer[]>>;
    setModal: React.Dispatch<React.SetStateAction<{
        type: string;
        file?: import('../../types').SftpFileEntry;
        selectedFiles?: import('../../types').SftpFileEntry[];
        errorMessage?: string;
        cancelPath?: string;
        localPath?: string;
        remotePath?: string;
        filename?: string;
        applicationPath?: string;
        applicationName?: string;
        fileUpdates?: PendingFileUpdate[];
    } | null>>;
    enqueueProgressUpdate: (payload: SftpProgress) => void;
    throttleTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
    tRef: React.MutableRefObject<(key: string, params?: Record<string, string>) => string>;
}

export function useSftpEvents({
    id,
    connect,
    rawStatusRef,
    setStatus,
    wasConnectedRef,
    isConnectingRef,
    pendingDeletesRef,
    loadDirectory,
    setError,
    setLoading,
    cancelledTransferIdsRef,
    cancelledPathsRef,
    setActiveTransfers,
    setModal,
    enqueueProgressUpdate,
    throttleTimerRef,
    tRef
}: UseSftpEventsProps) {
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
                                await ipcRenderer?.sftpRm?.({ id, path: p, isDir: false });
                            } catch { /* ignore */ }
                        }
                    }
                    ipcRenderer?.sftpRealpath?.({ id, path: '.' }).then((res: string) => {
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
            setStatus(msg);
            setLoading(false);
            isConnectingRef.current = false;
        });

        const unsubStart = ipcRenderer?.onSFTPStart?.(id, (data: unknown) => {
            if (!active) return;
            const payload = data as {
                id: string;
                filename: string;
                remotePath: string;
                type: 'upload' | 'download';
                status: 'active';
                size?: number;
                isDir?: boolean;
            };
            const normalizedPath = normalizeRemotePath(payload.remotePath);
            if (cancelledTransferIdsRef.current.has(payload.id)) return;
            if (cancelledPathsRef.current.has(`${payload.type}:${normalizedPath}`)) return;

            setActiveTransfers(prev => {
                const idx = prev.findIndex(t => t.id === payload.id);
                if (idx !== -1) return prev;
                return [{
                    id: payload.id,
                    filename: payload.filename,
                    remotePath: normalizedPath,
                    progress: 0,
                    size: payload.size,
                    type: payload.type,
                    status: 'active' as const,
                    isDir: payload.isDir
                }, ...prev];
            });
        });

        const unsubFileChanged = ipcRenderer?.onSFTPFileChanged?.(id, (data: unknown) => {
            if (!active) return;
            const payload = data as { localPath: string; remotePath: string; filename: string };
            const update: PendingFileUpdate = {
                localPath: payload.localPath,
                remotePath: payload.remotePath,
                filename: payload.filename,
                selected: true
            };
            setModal(previousModal => {
                if (previousModal?.type === 'fileUpdate') {
                    const currentUpdates = previousModal.fileUpdates || [];
                    const existingUpdateIndex = currentUpdates.findIndex(currentUpdate => currentUpdate.localPath === update.localPath);
                    if (existingUpdateIndex >= 0) {
                        const nextUpdates = currentUpdates.map((currentUpdate, index) => {
                            if (index === existingUpdateIndex) {
                                return { ...update, selected: currentUpdate.selected };
                            }
                            return currentUpdate;
                        });
                        return { ...previousModal, fileUpdates: nextUpdates };
                    }
                    return { ...previousModal, fileUpdates: [...currentUpdates, update] };
                }
                return { type: 'fileUpdate', fileUpdates: [update] };
            });
        });

        const unsubProgress = ipcRenderer?.onSFTPProgress?.(id, (data: unknown) => {
            if (!active) return;
            enqueueProgressUpdate(data as SftpProgress);
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
            if (typeof unsubStart === 'function') unsubStart();
            if (typeof unsubFileChanged === 'function') unsubFileChanged();
            if (throttleTimerRef.current) {
                clearTimeout(throttleTimerRef.current);
                throttleTimerRef.current = null;
            }
            ipcRenderer?.sshClose?.(id);
        };
    }, [
        id,
        connect,
        rawStatusRef,
        setStatus,
        wasConnectedRef,
        isConnectingRef,
        pendingDeletesRef,
        loadDirectory,
        setError,
        setLoading,
        cancelledTransferIdsRef,
        cancelledPathsRef,
        setActiveTransfers,
        setModal,
        enqueueProgressUpdate,
        throttleTimerRef,
        tRef
    ]);
}
