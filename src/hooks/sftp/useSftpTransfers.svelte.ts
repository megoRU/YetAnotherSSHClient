import type { AppConfig, SftpProgress, Transfer } from '../../types';

import { playSuccessSound } from '../../utils';

import { type RefObject, type SetStateAction } from '../../utils/dom';

const { ipcRenderer } = window;

export class ProgressStore {
    private snapshot = new Map<string, SftpProgress>();
    private listeners = new Map<string, Set<() => void>>();

    public subscribe = (id: string, listener: () => void) => {
        const idListeners = this.listeners.get(id) ?? new Set<() => void>();
        idListeners.add(listener);
        this.listeners.set(id, idListeners);
        return () => {
            idListeners.delete(listener);
            if (idListeners.size === 0) this.listeners.delete(id);
        };
    };

    public getSnapshot = (id: string) => {
        return this.snapshot.get(id);
    };

    public setProgressBatch(updates: SftpProgress[]) {
        let changed = false;
        const nextMap = new Map(this.snapshot);
        const changedIds: string[] = [];

        for (const update of updates) {
            if (!update.id) continue;
            const prev = nextMap.get(update.id);
            if (
                !prev ||
                prev.progress !== update.progress ||
                prev.transferred !== update.transferred ||
                prev.total !== update.total
            ) {
                nextMap.set(update.id, update);
                changed = true;
                changedIds.push(update.id);
            }
        }

        if (changed) {
            this.snapshot = nextMap;
            changedIds.forEach((id) => this.notify(id));
        }
    }

    public removeProgress(id: string) {
        if (this.snapshot.has(id)) {
            const nextMap = new Map(this.snapshot);
            nextMap.delete(id);
            this.snapshot = nextMap;
            this.notify(id);
        }
    }

    public clear() {
        if (this.snapshot.size > 0) {
            const ids = Array.from(this.snapshot.keys());
            this.snapshot = new Map();
            ids.forEach((id) => this.notify(id));
        }
    }

    private notify(id: string) {
        this.listeners.get(id)?.forEach((listener) => listener());
    }
}

export function useSftpTransfers(getId: () => string, getAppConfig: () => AppConfig | undefined) {
    let activeTransfers = $state.raw<Transfer[]>([]);
    function setActiveTransfers(next: SetStateAction<Transfer[]>) {
        activeTransfers = typeof next === 'function' ? next(activeTransfers) : next;
    }
    const pendingProgressMapRef: RefObject<Map<string, SftpProgress>> = { current: new Map() };
    const throttleTimerRef: RefObject<ReturnType<typeof setTimeout> | null> = { current: null };
    const pendingDeletesRef: RefObject<string[]> = { current: [] };
    const cancelledTransferIdsRef: RefObject<Set<string>> = { current: new Set() };

    const progressStore = new ProgressStore();

    const notifyTransferSuccess = () => {
        const config = getAppConfig();
        if (config?.sftpSoundEnabled) {
            playSuccessSound(config.sftpSoundVolume);
        }
        if (config?.sftpFlashIcon) {
            ipcRenderer?.flashFrame?.();
        }
    };

    const addPendingDeletes = (paths: string[]) => {
        pendingDeletesRef.current = Array.from(new Set([...pendingDeletesRef.current, ...paths]));
    };

    const clearTransferCancellation = (transferId: string) => {
        cancelledTransferIdsRef.current.delete(transferId);
    };

    const handleCancelTransfer = (t: Transfer) => {
        const groupTransfers = t.groupId
            ? activeTransfers.filter((transfer) => transfer.groupId === t.groupId)
            : [t];
        for (const transfer of groupTransfers) {
            cancelledTransferIdsRef.current.add(transfer.id);
            pendingProgressMapRef.current.delete(transfer.id);
            progressStore.removeProgress(transfer.id);
        }
        setActiveTransfers((prev) =>
            prev.filter((transfer) => (t.groupId ? transfer.groupId !== t.groupId : transfer.id !== t.id)),
        );

        void ipcRenderer?.sftpCancelUpload?.({
            id: getId(),
            groupId: t.groupId,
            transferId: t.groupId ? undefined : t.id,
            deleteRemotePartial: getAppConfig()?.sftpDeletePartialOnCancel ?? false,
        });
    };

    const removeTransfer = (transferId: string) => {
        cancelledTransferIdsRef.current.delete(transferId);
        pendingProgressMapRef.current.delete(transferId);
        progressStore.removeProgress(transferId);
        setActiveTransfers((prev) => prev.filter((t) => t.id !== transferId));
    };

    const clearFinishedTransfers = () => {
        const finished = activeTransfers.filter((t) => t.status !== 'active');
        finished.forEach((t) => {
            cancelledTransferIdsRef.current.delete(t.id);
            pendingProgressMapRef.current.delete(t.id);
            progressStore.removeProgress(t.id);
        });
        setActiveTransfers((prev) => prev.filter((t) => t.status === 'active'));
    };

    const processUpdates = () => {
        if (throttleTimerRef.current) {
            clearTimeout(throttleTimerRef.current);
            throttleTimerRef.current = null;
        }

        if (pendingProgressMapRef.current.size === 0) return;

        const latestUpdates = Array.from(pendingProgressMapRef.current.values());
        pendingProgressMapRef.current.clear();

        const activeUpdates = latestUpdates.filter((u) => u.id && !cancelledTransferIdsRef.current.has(u.id));
        if (activeUpdates.length > 0) {
            progressStore.setProgressBatch(activeUpdates);
        }

        const completedUpdates = activeUpdates.filter((u) => u.progress >= 100);
        if (completedUpdates.length > 0) {
            setActiveTransfers((prev) => {
                let changed = false;
                const next = [...prev];

                for (const d of completedUpdates) {
                    const idx = next.findIndex((t) => t.id === d.id);
                    if (idx !== -1 && next[idx].status !== 'success') {
                        next[idx] = {
                            ...next[idx],
                            progress: 100,
                            size: d.total ?? next[idx].size,
                            status: 'success',
                        };
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
        }
    };

    const enqueueProgressUpdate = (payload: SftpProgress) => {
        if (!payload || !payload.id) return;
        if (cancelledTransferIdsRef.current.has(payload.id)) return;

        pendingProgressMapRef.current.set(payload.id, payload);

        const isCritical = payload.progress >= 100;
        if (isCritical) {
            processUpdates();
        } else if (!throttleTimerRef.current) {
            throttleTimerRef.current = setTimeout(processUpdates, 150);
        }
    };

    return {
        get activeTransfers() {
            return activeTransfers;
        },
        setActiveTransfers,
        pendingProgressMapRef,
        throttleTimerRef,
        pendingDeletesRef,
        addPendingDeletes,
        cancelledTransferIdsRef,
        clearTransferCancellation,
        get removeTransfer() {
            return removeTransfer;
        },
        get clearFinishedTransfers() {
            return clearFinishedTransfers;
        },
        get notifyTransferSuccess() {
            return notifyTransferSuccess;
        },
        get handleCancelTransfer() {
            return handleCancelTransfer;
        },
        get enqueueProgressUpdate() {
            return enqueueProgressUpdate;
        },
        get processUpdates() {
            return processUpdates;
        },
        get progressStore() {
            return progressStore;
        },
    };
}
