import { useMemo, useCallback, useSyncExternalStore } from 'react';
import type { UpdateInfo, UpdateProgress, UpdateStatus } from '../types';

const { ipcRenderer } = window;

export interface ManualCheckResult {
    available: boolean;
    version?: string;
    url?: string;
    releaseNotes?: string;
    error?: string;
}

export interface SharedUpdateState {
    updateInfo: UpdateInfo | null;
    status: UpdateStatus;
    progress: UpdateProgress | null;
    error: string | null;
    isChecking: boolean;
    manualCheckResult: ManualCheckResult | null;
}

let globalState: SharedUpdateState = {
    updateInfo: null,
    status: 'idle',
    progress: null,
    error: null,
    isChecking: false,
    manualCheckResult: null,
};

const listeners = new Set<() => void>();
let isIpcInitialized = false;

function notifyListeners() {
    listeners.forEach(listener => listener());
}

function setGlobalState(updater: Partial<SharedUpdateState> | ((prev: SharedUpdateState) => SharedUpdateState)) {
    if (typeof updater === 'function') {
        globalState = updater(globalState);
    } else {
        globalState = { ...globalState, ...updater };
    }
    notifyListeners();
}

function initIpcListeners() {
    if (isIpcInitialized || typeof ipcRenderer === 'undefined') return;
    isIpcInitialized = true;

    ipcRenderer?.onUpdateAvailable?.((info: unknown) => {
        const updateInfo = info as UpdateInfo;
        setGlobalState(prev => ({
            ...prev,
            updateInfo,
            status: prev.status === 'idle' ? 'available' : prev.status
        }));
    });

    ipcRenderer?.onUpdateStatus?.((s: string) => {
        const status = s as UpdateStatus;
        setGlobalState(prev => ({
            ...prev,
            status
        }));
    });

    ipcRenderer?.onUpdateProgress?.((p: unknown) => {
        const progress = p as UpdateProgress;
        setGlobalState(prev => ({
            ...prev,
            progress,
            status: 'downloading'
        }));
    });

    ipcRenderer?.onUpdateError?.((err: string) => {
        setGlobalState(prev => ({
            ...prev,
            error: err,
            status: 'error',
            isChecking: false
        }));
    });
}

function subscribeToUpdateState(listener: () => void): () => void {
    initIpcListeners();
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

function getUpdateStateSnapshot(): SharedUpdateState {
    return globalState;
}

export const useUpdateChecker = () => {
    const state = useSyncExternalStore(subscribeToUpdateState, getUpdateStateSnapshot, getUpdateStateSnapshot);

    const checkUpdates = useCallback(async () => {
        setGlobalState(prev => ({ ...prev, isChecking: true, error: null }));
        try {
            const result = await ipcRenderer?.checkUpdates?.() as { available: boolean; version?: string; url?: string; releaseNotes?: string; error?: string };
            if (result?.available) {
                setGlobalState(prev => ({
                    ...prev,
                    isChecking: false,
                    manualCheckResult: result,
                    status: 'available',
                    updateInfo: {
                        version: result.version || prev.updateInfo?.version || '',
                        releaseNotes: result.releaseNotes || prev.updateInfo?.releaseNotes
                    }
                }));
            } else if (result?.error) {
                setGlobalState({
                    isChecking: false,
                    manualCheckResult: result,
                    error: result.error,
                    status: 'error'
                });
            } else {
                setGlobalState(prev => ({
                    ...prev,
                    isChecking: false,
                    manualCheckResult: { available: false },
                    status: prev.status === 'idle' ? 'not-available' : prev.status
                }));
            }
            return result;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            const errResult = { available: false, error: message };
            setGlobalState({
                isChecking: false,
                manualCheckResult: errResult,
                error: message,
                status: 'error'
            });
            return errResult;
        }
    }, []);

    const startDownload = useCallback(() => {
        if (globalState.status === 'downloading' || globalState.status === 'installing') {
            return;
        }
        setGlobalState(prev => ({
            ...prev,
            status: 'downloading',
            error: null,
            progress: prev.progress || { percent: 0, bytesPerSecond: 0, total: 0, transferred: 0 }
        }));
        ipcRenderer?.startUpdateDownload?.().catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            setGlobalState(prev => ({
                ...prev,
                error: message,
                status: 'error'
            }));
        });
    }, []);

    const quitAndInstall = useCallback(() => {
        setGlobalState(prev => ({
            ...prev,
            status: 'installing',
            error: null
        }));
        ipcRenderer?.quitAndInstall?.();
    }, []);

    const isMac = ipcRenderer?.platform === 'darwin';

    const isUpdateAvailable = !isMac && (
        state.status === 'available' ||
        state.status === 'downloading' ||
        state.status === 'downloaded' ||
        state.status === 'installing' ||
        (!!state.updateInfo && state.status !== 'not-available' && state.status !== 'error') ||
        !!state.manualCheckResult?.available
    );

    const targetVersion = state.updateInfo?.version || state.manualCheckResult?.version || '';
    const releaseNotes = state.updateInfo?.releaseNotes || state.manualCheckResult?.releaseNotes;

    return useMemo(() => ({
        updateInfo: state.updateInfo,
        status: state.status,
        progress: state.progress,
        error: state.error,
        isChecking: state.isChecking,
        manualCheckResult: state.manualCheckResult,
        isUpdateAvailable,
        targetVersion,
        releaseNotes,
        checkUpdates,
        startDownload,
        quitAndInstall
    }), [state, isUpdateAvailable, targetVersion, releaseNotes, checkUpdates, startDownload, quitAndInstall]);
};
