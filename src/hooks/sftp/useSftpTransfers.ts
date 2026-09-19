import { useCallback, useRef, useState } from 'react';
import type { AppConfig, SftpProgress, Transfer } from '../../types';
import { playSuccessSound } from '../../utils';

const { ipcRenderer } = window;

export function useSftpTransfers(id: string, appConfig?: AppConfig) {
    const [activeTransfers, setActiveTransfers] = useState<Transfer[]>([]);
    const pendingUpdatesRef = useRef<SftpProgress[]>([]);
    const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingDeletesRef = useRef<string[]>([]);
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

    const clearTransferCancellation = useCallback((transferId: string) => {
        cancelledTransferIdsRef.current.delete(transferId);
    }, []);

    const handleCancelTransfer = useCallback((t: Transfer) => {
        cancelledTransferIdsRef.current.add(t.id);

        pendingUpdatesRef.current = pendingUpdatesRef.current.filter(u => u.id !== t.id);
        setActiveTransfers(prev => prev.filter(x => x.id !== t.id));

        ipcRenderer?.sftpCancelUpload?.({ id, transferId: t.id });

        // Safe upload cleanup: only delete remote partial file if the transfer was actively uploading
        // and partially completed (progress > 0 && < 100), avoiding accidental deletion of existing or completed files.
        if (t.type === 'upload' && t.status === 'active' && typeof t.progress === 'number' && t.progress > 0 && t.progress < 100) {
            ipcRenderer?.sftpRm?.({ id, path: t.remotePath, isDir: t.isDir || false });
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
                if (!d.id) continue;
                if (cancelledTransferIdsRef.current.has(d.id)) continue;

                const idx = next.findIndex(t => t.id === d.id);

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
                }
            }
            return changed ? next : prev;
        });
    }, []);

    const enqueueProgressUpdate = useCallback((payload: SftpProgress) => {
        if (!payload || !payload.id) return;
        if (cancelledTransferIdsRef.current.has(payload.id)) return;

        pendingUpdatesRef.current.push(payload);

        const isCritical = payload.progress >= 100 || payload.progress === 0;
        if (isCritical) {
            processUpdates();
        } else if (!throttleTimerRef.current) {
            throttleTimerRef.current = setTimeout(processUpdates, 150);
        }
    }, [processUpdates]);

    const removeTransfer = useCallback((transferId: string) => {
        cancelledTransferIdsRef.current.delete(transferId);
        setActiveTransfers(prev => prev.filter(t => t.id !== transferId));
    }, []);

    const clearFinishedTransfers = useCallback(() => {
        setActiveTransfers(prev => {
            const finished = prev.filter(t => t.status !== 'active');
            finished.forEach(t => cancelledTransferIdsRef.current.delete(t.id));
            return prev.filter(t => t.status === 'active');
        });
    }, []);

    return {
        activeTransfers,
        setActiveTransfers,
        pendingUpdatesRef,
        throttleTimerRef,
        pendingDeletesRef,
        addPendingDeletes,
        cancelledTransferIdsRef,
        clearTransferCancellation,
        removeTransfer,
        clearFinishedTransfers,
        notifyTransferSuccess,
        handleCancelTransfer,
        enqueueProgressUpdate,
        processUpdates
    };
}
