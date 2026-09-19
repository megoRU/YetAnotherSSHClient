import { useCallback, useRef, useState } from 'react';
import type { AppConfig, SftpProgress, Transfer } from '../../types';
import { normalizeRemotePath, playSuccessSound } from '../../utils';

const { ipcRenderer } = window;

export function useSftpTransfers(id: string, appConfig?: AppConfig) {
    const [activeTransfers, setActiveTransfers] = useState<Transfer[]>([]);
    const pendingUpdatesRef = useRef<SftpProgress[]>([]);
    const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingDeletesRef = useRef<string[]>([]);
    const cancelledPathsRef = useRef<Set<string>>(new Set());
    const cancelledTransferIdsRef = useRef<Set<string>>(new Set());

    const notifyTransferSuccess = useCallback(() => {
        if (appConfig?.sftpSoundEnabled) {
            playSuccessSound(appConfig.sftpSoundVolume);
        }
        if (appConfig?.sftpFlashIcon) {
            ipcRenderer?.flashFrame?.();
        }
    }, [appConfig]);

    const addPendingDeletes = useCallback((paths: string[]) => {
        pendingDeletesRef.current = Array.from(new Set([...pendingDeletesRef.current, ...paths]));
    }, []);

    const handleCancelTransfer = useCallback((t: Transfer) => {
        const normPath = normalizeRemotePath(t.remotePath);
        cancelledPathsRef.current.add(`${t.type}:${normPath}`);
        cancelledTransferIdsRef.current.add(t.id);

        pendingUpdatesRef.current = pendingUpdatesRef.current.filter(u => u.id !== t.id && normalizeRemotePath(u.remotePath) !== normPath);
        setActiveTransfers(prev => prev.filter(x => x.id !== t.id));

        ipcRenderer?.sftpCancelUpload?.({ id, transferId: t.id });
        if (t.type === 'upload') {
            ipcRenderer?.sftpRm?.({ id, path: t.remotePath, isDir: t.isDir });
        }
    }, [id]);

    const processUpdates = useCallback(() => {
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
                            size: d.total ?? t.size,
                            status: newStatus as 'active' | 'success'
                        };
                        changed = true;
                    }
                } else if (d.progress < 100) {
                    next.unshift({
                        id: d.id || Math.random().toString(36).substring(2, 9),
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
    }, []);

    const enqueueProgressUpdate = useCallback((payload: SftpProgress) => {
        const normalizedPath = normalizeRemotePath(payload.remotePath);

        if (payload.id && cancelledTransferIdsRef.current.has(payload.id)) return;
        if (cancelledPathsRef.current.has(`${payload.type}:${normalizedPath}`)) return;

        pendingUpdatesRef.current.push(payload);

        const isCritical = payload.progress >= 100 || payload.progress === 0;
        if (isCritical) {
            processUpdates();
        } else if (!throttleTimerRef.current) {
            throttleTimerRef.current = setTimeout(processUpdates, 150);
        }
    }, [processUpdates]);

    return {
        activeTransfers,
        setActiveTransfers,
        pendingUpdatesRef,
        throttleTimerRef,
        pendingDeletesRef,
        addPendingDeletes,
        cancelledPathsRef,
        cancelledTransferIdsRef,
        notifyTransferSuccess,
        handleCancelTransfer,
        enqueueProgressUpdate,
        processUpdates
    };
}
