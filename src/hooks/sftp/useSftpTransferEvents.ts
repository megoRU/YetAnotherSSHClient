import { useEffect } from 'react';
import type { SftpProgress, Transfer } from '../../types';
import { normalizeRemotePath } from '../../utils';

const { ipcRenderer } = window;

interface UseSftpTransferEventsProps {
    id: string;
    cancelledTransferIdsRef: React.MutableRefObject<Set<string>>;
    setActiveTransfers: React.Dispatch<React.SetStateAction<Transfer[]>>;
    enqueueProgressUpdate: (payload: SftpProgress) => void;
    throttleTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

export function useSftpTransferEvents({
    id,
    cancelledTransferIdsRef,
    setActiveTransfers,
    enqueueProgressUpdate,
    throttleTimerRef
}: UseSftpTransferEventsProps) {
    useEffect(() => {
        let active = true;

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

        const unsubProgress = ipcRenderer?.onSFTPProgress?.(id, (data: unknown) => {
            if (!active) return;
            enqueueProgressUpdate(data as SftpProgress);
        });

        return () => {
            active = false;
            if (typeof unsubStart === 'function') unsubStart();
            if (typeof unsubProgress === 'function') unsubProgress();
            if (throttleTimerRef.current) {
                clearTimeout(throttleTimerRef.current);
                throttleTimerRef.current = null;
            }
        };
    }, [
        id,
        cancelledTransferIdsRef,
        setActiveTransfers,
        enqueueProgressUpdate,
        throttleTimerRef
    ]);
}
