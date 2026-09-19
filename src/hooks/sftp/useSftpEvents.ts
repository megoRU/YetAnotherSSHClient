import { useEffect } from 'react';
import type { PendingFileUpdate, SftpErrorKind, SftpFileEntry, SftpProgress, SftpStatusKind, SSHConfig, Transfer } from '../../types';
import { useSftpConnectionEvents } from './useSftpConnectionEvents';
import { useSftpTransferEvents } from './useSftpTransferEvents';
import { useSftpFileChangeEvents } from './useSftpFileChangeEvents';

interface SftpModalState {
    type: string;
    file?: SftpFileEntry;
    selectedFiles?: SftpFileEntry[];
    errorMessage?: string;
    cancelPath?: string;
    localPath?: string;
    remotePath?: string;
    filename?: string;
    applicationPath?: string;
    applicationName?: string;
    fileUpdates?: PendingFileUpdate[];
}

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
    setStatusKind: (kind: SftpStatusKind | null) => void;
    setErrorKind: (kind: SftpErrorKind | null) => void;
    cancelledTransferIdsRef: React.MutableRefObject<Set<string>>;
    setActiveTransfers: React.Dispatch<React.SetStateAction<Transfer[]>>;
    setModal: React.Dispatch<React.SetStateAction<SftpModalState | null>>;
    enqueueProgressUpdate: (payload: SftpProgress) => void;
    throttleTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
    tRef: React.MutableRefObject<(key: string, params?: Record<string, string>) => string>;
}

export function useSftpEvents({
    id,
    config,
    connect,
    rawStatusRef,
    setStatus,
    wasConnectedRef,
    isConnectingRef,
    pendingDeletesRef,
    loadDirectory,
    setError,
    setLoading,
    setStatusKind,
    setErrorKind,
    cancelledTransferIdsRef,
    setActiveTransfers,
    setModal,
    enqueueProgressUpdate,
    throttleTimerRef,
    tRef
}: UseSftpEventsProps) {
    useEffect(() => {
        const preventDefault = (e: DragEvent) => e.preventDefault();
        window.addEventListener('dragover', preventDefault);
        window.addEventListener('drop', preventDefault);

        return () => {
            window.removeEventListener('dragover', preventDefault);
            window.removeEventListener('drop', preventDefault);
        };
    }, []);

    useSftpConnectionEvents({
        id,
        config,
        connect,
        rawStatusRef,
        setStatus,
        wasConnectedRef,
        isConnectingRef,
        pendingDeletesRef,
        loadDirectory,
        setError,
        setLoading,
        setStatusKind,
        setErrorKind,
        tRef
    });

    useSftpTransferEvents({
        id,
        cancelledTransferIdsRef,
        setActiveTransfers,
        enqueueProgressUpdate,
        throttleTimerRef
    });

    useSftpFileChangeEvents({
        id,
        setModal
    });
}
