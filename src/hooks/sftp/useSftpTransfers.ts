import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import type { AppConfig, SftpProgress, Transfer } from '../../types';
import { playSuccessSound } from '../../utils';

const { ipcRenderer } = window;

class ProgressStore {
    private progressMap = new Map<string, SftpProgress>();
    private listeners = new Set<() => void>();

    public subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    public getSnapshot = () => {
        return this.progressMap;
    };

    public setProgressBatch(updates: SftpProgress[]) {
        let changed = false;
        for (const update of updates) {
            if (!update.id) continue;
            const prev = this.progressMap.get(update.id);
            if (!prev || prev.progress !== update.progress || prev.transferred !== update.transferred || prev.total !== update.total) {
                this.progressMap.set(update.id, update);
                changed = true;
            }
        }
        if (changed) {
            this.listeners.forEach(listener => listener());
        }
    }

    public removeProgress(id: string) {
        if (this.progressMap.has(id)) {
            this.progressMap.delete(id);
            this.listeners.forEach(listener => listener());
        }
    }

    public clear() {
        if (this.progressMap.size > 0) {
            this.progressMap.clear();
            this.listeners.forEach(listener => listener());
        }
    }
}

export function useSftpTransfers(id: string, appConfig?: AppConfig) {
    const [activeTransfers, setActiveTransfers] = useState<Transfer[]>([]);
    const pendingProgressMapRef = useRef<Map<string, SftpProgress>>(new Map());
    const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingDeletesRef = useRef<string[]>([]);
    const cancelledTransferIdsRef = useRef<Set<string>>(new Set());

    const progressStoreRef = useRef<ProgressStore>(new ProgressStore());

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

        pendingProgressMapRef.current.delete(t.id);
        progressStoreRef.current.removeProgress(t.id);
        setActiveTransfers(prev => prev.filter(x => x.id !== t.id));

        ipcRenderer?.sftpCancelUpload?.({ id, transferId: t.id });
    }, [id]);

    const removeTransfer = useCallback((transferId: string) => {
        cancelledTransferIdsRef.current.delete(transferId);
        pendingProgressMapRef.current.delete(transferId);
        progressStoreRef.current.removeProgress(transferId);
        setActiveTransfers(prev => prev.filter(t => t.id !== transferId));
    }, []);

    const clearFinishedTransfers = useCallback(() => {
        setActiveTransfers(prev => {
            const finished = prev.filter(t => t.status !== 'active');
            finished.forEach(t => {
                cancelledTransferIdsRef.current.delete(t.id);
                pendingProgressMapRef.current.delete(t.id);
                progressStoreRef.current.removeProgress(t.id);
            });
            return prev.filter(t => t.status === 'active');
        });
    }, []);

    const processUpdates = useCallback(() => {
        if (throttleTimerRef.current) {
            clearTimeout(throttleTimerRef.current);
            throttleTimerRef.current = null;
        }

        if (pendingProgressMapRef.current.size === 0) return;

        const latestUpdates = Array.from(pendingProgressMapRef.current.values());
        pendingProgressMapRef.current.clear();

        const activeUpdates = latestUpdates.filter(u => u.id && !cancelledTransferIdsRef.current.has(u.id));
        if (activeUpdates.length > 0) {
            progressStoreRef.current.setProgressBatch(activeUpdates);
        }

        const completedUpdates = activeUpdates.filter(u => u.progress >= 100);
        if (completedUpdates.length > 0) {
            setActiveTransfers(prev => {
                let changed = false;
                const next = [...prev];

                for (const d of completedUpdates) {
                    const idx = next.findIndex(t => t.id === d.id);
                    if (idx !== -1 && next[idx].status !== 'success') {
                        next[idx] = {
                            ...next[idx],
                            progress: 100,
                            size: d.total ?? next[idx].size,
                            status: 'success'
                        };
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
        }
    }, []);

    const enqueueProgressUpdate = useCallback((payload: SftpProgress) => {
        if (!payload || !payload.id) return;
        if (cancelledTransferIdsRef.current.has(payload.id)) return;

        pendingProgressMapRef.current.set(payload.id, payload);

        const isCritical = payload.progress >= 100 || payload.progress === 0;
        if (isCritical) {
            processUpdates();
        } else if (!throttleTimerRef.current) {
            throttleTimerRef.current = setTimeout(processUpdates, 150);
        }
    }, [processUpdates]);

    const useProgressStore = () => {
        return useSyncExternalStore(
            progressStoreRef.current.subscribe,
            progressStoreRef.current.getSnapshot
        );
    };

    return {
        activeTransfers,
        setActiveTransfers,
        pendingProgressMapRef,
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
        processUpdates,
        useProgressStore
    };
}
