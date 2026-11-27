import type { UpdateInfo, UpdateProgress, UpdateStatus } from '../types';

import { onMount } from 'svelte';

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

let state = $state.raw<SharedUpdateState>({
    updateInfo: null,
    status: 'idle',
    progress: null,
    error: null,
    isChecking: false,
    manualCheckResult: null,
});

let isIpcInitialized = false;

function setGlobalState(updater: Partial<SharedUpdateState> | ((prev: SharedUpdateState) => SharedUpdateState)) {
    if (typeof updater === 'function') {
        state = updater(state);
    } else {
        state = { ...state, ...updater };
    }
}

function initIpcListeners() {
    if (isIpcInitialized || typeof ipcRenderer === 'undefined') return;
    isIpcInitialized = true;

    ipcRenderer?.onUpdateAvailable?.((info: unknown) => {
        const updateInfo = info as UpdateInfo;
        setGlobalState((prev) => ({
            ...prev,
            updateInfo,
            status: prev.status === 'idle' ? 'available' : prev.status,
        }));
    });

    ipcRenderer?.onUpdateStatus?.((s: string) => {
        const status = s as UpdateStatus;
        setGlobalState((prev) => ({
            ...prev,
            status,
        }));
    });

    ipcRenderer?.onUpdateProgress?.((p: unknown) => {
        const progress = p as UpdateProgress;
        setGlobalState((prev) => ({
            ...prev,
            progress,
            status: 'downloading',
        }));
    });

    ipcRenderer?.onUpdateError?.((err: string) => {
        setGlobalState((prev) => ({
            ...prev,
            error: err,
            status: 'error',
            isChecking: false,
        }));
    });
}

export const useUpdateChecker = () => {
    onMount(initIpcListeners);

    const checkUpdates = async () => {
        setGlobalState((prev) => ({ ...prev, isChecking: true, error: null }));
        try {
            const result = (await ipcRenderer?.checkUpdates?.()) as {
                available: boolean;
                version?: string;
                url?: string;
                releaseNotes?: string;
                error?: string;
            };
            if (result?.available) {
                setGlobalState((prev) => ({
                    ...prev,
                    isChecking: false,
                    manualCheckResult: result,
                    status: 'available',
                    updateInfo: {
                        version: result.version || prev.updateInfo?.version || '',
                        releaseNotes: result.releaseNotes || prev.updateInfo?.releaseNotes,
                    },
                }));
            } else if (result?.error) {
                setGlobalState({
                    isChecking: false,
                    manualCheckResult: result,
                    error: result.error,
                    status: 'error',
                });
            } else {
                setGlobalState((prev) => ({
                    ...prev,
                    isChecking: false,
                    manualCheckResult: { available: false },
                    status: prev.status === 'idle' ? 'not-available' : prev.status,
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
                status: 'error',
            });
            return errResult;
        }
    };

    const startDownload = () => {
        if (state.status === 'downloading' || state.status === 'installing') {
            return;
        }
        setGlobalState((prev) => ({
            ...prev,
            status: 'downloading',
            error: null,
            progress: prev.progress || { percent: 0, total: 0, transferred: 0 },
        }));
        ipcRenderer?.startUpdateDownload?.().catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            setGlobalState((prev) => ({
                ...prev,
                error: message,
                status: 'error',
            }));
        });
    };

    /**
     * Установка скачанного обновления и перезапуск.
     *
     * Отдельное действие после успешного скачивания: статус `downloaded`
     * означает «файл на диске, ждёт подтверждения», а не «уже установлено».
     */
    const installUpdate = () => {
        if (state.status !== 'downloaded') {
            return;
        }
        setGlobalState((prev) => ({
            ...prev,
            status: 'installing',
            error: null,
        }));
        ipcRenderer?.installUpdate?.().catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            setGlobalState((prev) => ({
                ...prev,
                error: message,
                status: 'downloaded',
            }));
        });
    };

    const isUpdateAvailable = $derived(
        state.status === 'available' ||
            state.status === 'downloading' ||
            state.status === 'downloaded' ||
            state.status === 'installing' ||
            (!!state.updateInfo && state.status !== 'not-available' && state.status !== 'error') ||
            !!state.manualCheckResult?.available,
    );

    const targetVersion = $derived(state.updateInfo?.version || state.manualCheckResult?.version || '');
    const releaseNotes = $derived(state.updateInfo?.releaseNotes || state.manualCheckResult?.releaseNotes);

    return {
        get updateInfo() {
            return state.updateInfo;
        },
        get status() {
            return state.status;
        },
        get progress() {
            return state.progress;
        },
        get error() {
            return state.error;
        },
        get isChecking() {
            return state.isChecking;
        },
        get manualCheckResult() {
            return state.manualCheckResult;
        },
        get isUpdateAvailable() {
            return isUpdateAvailable;
        },
        get targetVersion() {
            return targetVersion;
        },
        get releaseNotes() {
            return releaseNotes;
        },
        checkUpdates,
        startDownload,
        installUpdate,
    };
};
