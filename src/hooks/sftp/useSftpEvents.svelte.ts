import type {
    PendingFileUpdate,
    SftpErrorKind,
    SftpFileEntry,
    SftpProgress,
    SftpStatusKind,
    SSHConfig,
    Transfer,
} from '../../types';

import { useSftpConnectionEvents } from './useSftpConnectionEvents.svelte';

import { useSftpTransferEvents } from './useSftpTransferEvents.svelte';

import { useSftpFileChangeEvents } from './useSftpFileChangeEvents.svelte';

import { onMount } from 'svelte';

import { type Dispatch, type RefObject, type SetStateAction } from '../../utils/dom';

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
    rawStatusRef: RefObject<string>;
    setStatus: (msg: string) => void;
    wasConnectedRef: RefObject<boolean>;
    isConnectingRef: RefObject<boolean>;
    pendingDeletesRef: RefObject<string[]>;
    loadDirectory: (path: string, force?: boolean) => Promise<void>;
    setError: (msg: string | null) => void;
    setLoading: (loading: boolean) => void;
    setStatusKind: (kind: SftpStatusKind | null) => void;
    setErrorKind: (kind: SftpErrorKind | null) => void;
    cancelledTransferIdsRef: RefObject<Set<string>>;
    setActiveTransfers: Dispatch<SetStateAction<Transfer[]>>;
    setModal: Dispatch<SetStateAction<SftpModalState | null>>;
    enqueueProgressUpdate: (payload: SftpProgress) => void;
    notifyTransferSuccess: () => void;
    throttleTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
    tRef: RefObject<(key: string, params?: Record<string, string>) => string>;
}

export function useSftpEvents(options: UseSftpEventsProps) {
    onMount(() => {
        const preventDefault = (e: DragEvent) => e.preventDefault();
        window.addEventListener('dragover', preventDefault);
        window.addEventListener('drop', preventDefault);

        return () => {
            window.removeEventListener('dragover', preventDefault);
            window.removeEventListener('drop', preventDefault);
        };
    });

    useSftpConnectionEvents({
        get id() {
            return options.id;
        },
        get config() {
            return options.config;
        },
        get connect() {
            return options.connect;
        },
        get rawStatusRef() {
            return options.rawStatusRef;
        },
        get setStatus() {
            return options.setStatus;
        },
        get wasConnectedRef() {
            return options.wasConnectedRef;
        },
        get isConnectingRef() {
            return options.isConnectingRef;
        },
        get pendingDeletesRef() {
            return options.pendingDeletesRef;
        },
        get loadDirectory() {
            return options.loadDirectory;
        },
        get setError() {
            return options.setError;
        },
        get setLoading() {
            return options.setLoading;
        },
        get setStatusKind() {
            return options.setStatusKind;
        },
        get setErrorKind() {
            return options.setErrorKind;
        },
        get tRef() {
            return options.tRef;
        },
    });

    useSftpTransferEvents({
        get id() {
            return options.id;
        },
        get cancelledTransferIdsRef() {
            return options.cancelledTransferIdsRef;
        },
        get setActiveTransfers() {
            return options.setActiveTransfers;
        },
        get enqueueProgressUpdate() {
            return options.enqueueProgressUpdate;
        },
        get notifyTransferSuccess() {
            return options.notifyTransferSuccess;
        },
        get throttleTimerRef() {
            return options.throttleTimerRef;
        },
    });

    useSftpFileChangeEvents({
        get id() {
            return options.id;
        },
        get setModal() {
            return options.setModal;
        },
    });
}
