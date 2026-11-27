import type { SftpProgress, Transfer } from '../../types';

import { normalizeRemotePath } from '../../utils';

import { untrack } from 'svelte';

import { type Dispatch, type RefObject, type SetStateAction } from '../../utils/dom';

const { ipcRenderer } = window;

interface UseSftpTransferEventsProps {
    id: string;
    cancelledTransferIdsRef: RefObject<Set<string>>;
    setActiveTransfers: Dispatch<SetStateAction<Transfer[]>>;
    enqueueProgressUpdate: (payload: SftpProgress) => void;
    notifyTransferSuccess: () => void;
    throttleTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
}

export function useSftpTransferEvents(options: UseSftpTransferEventsProps) {
    $effect(() => {
        void [
            options.id,
            options.cancelledTransferIdsRef,
            options.setActiveTransfers,
            options.enqueueProgressUpdate,
            options.notifyTransferSuccess,
            options.throttleTimerRef,
        ];
        return untrack(() => {
            let active = true;

            const unsubStart = ipcRenderer?.onSFTPStart?.(options.id, (data: unknown) => {
                if (!active) return;
                const payload = data as {
                    id: string;
                    groupId?: string;
                    filename: string;
                    remotePath: string;
                    type: 'upload' | 'download';
                    status: 'active' | 'success' | 'error' | 'cancelled';
                    size?: number;
                    isDir?: boolean;
                    error?: string;
                    notifySuccess?: boolean;
                };
                const normalizedPath = normalizeRemotePath(payload.remotePath);
                if (options.cancelledTransferIdsRef.current.has(payload.id)) return;

                if (payload.status !== 'active') {
                    if (payload.status === 'success' && payload.notifySuccess) {
                        options.notifyTransferSuccess();
                    }
                    options.setActiveTransfers((prev) =>
                        prev.map((transfer) =>
                            transfer.id === payload.id
                                ? {
                                      ...transfer,
                                      status: payload.status,
                                      progress: payload.status === 'success' ? 100 : transfer.progress,
                                      size: payload.size ?? transfer.size,
                                      error: payload.error,
                                  }
                                : transfer,
                        ),
                    );
                    return;
                }

                options.setActiveTransfers((prev) => {
                    const idx = prev.findIndex((t) => t.id === payload.id);
                    if (idx !== -1) return prev;
                    return [
                        {
                            id: payload.id,
                            groupId: payload.groupId,
                            filename: payload.filename,
                            remotePath: normalizedPath,
                            progress: 0,
                            size: payload.size,
                            type: payload.type,
                            status: 'active' as const,
                            isDir: payload.isDir,
                        },
                        ...prev,
                    ];
                });
            });

            const unsubProgress = ipcRenderer?.onSFTPProgress?.(options.id, (data: unknown) => {
                if (!active) return;
                options.enqueueProgressUpdate(data as SftpProgress);
            });

            return () => {
                active = false;
                if (typeof unsubStart === 'function') unsubStart();
                if (typeof unsubProgress === 'function') unsubProgress();
                if (options.throttleTimerRef.current) {
                    clearTimeout(options.throttleTimerRef.current);
                    options.throttleTimerRef.current = null;
                }
            };
        });
    });
}
