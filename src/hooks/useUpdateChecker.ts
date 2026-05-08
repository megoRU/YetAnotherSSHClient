import { useState, useEffect } from 'react';
import type { UpdateInfo, UpdateProgress, UpdateStatus } from '../types';

const { ipcRenderer } = window;

export const useUpdateChecker = () => {
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [status, setStatus] = useState<UpdateStatus>('idle');
    const [progress, setProgress] = useState<UpdateProgress | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const unsubAvailable = ipcRenderer?.onUpdateAvailable?.((info: unknown) => {
            setUpdateInfo(info as UpdateInfo);
        });

        const unsubStatus = ipcRenderer?.onUpdateStatus?.((s: string) => {
            setStatus(s as UpdateStatus);
        });

        const unsubProgress = ipcRenderer?.onUpdateProgress?.((p: unknown) => {
            setProgress(p as UpdateProgress);
        });

        const unsubError = ipcRenderer?.onUpdateError?.((err: string) => {
            setError(err);
        });

        return () => {
            if (typeof unsubAvailable === 'function') unsubAvailable();
            if (typeof unsubStatus === 'function') unsubStatus();
            if (typeof unsubProgress === 'function') unsubProgress();
            if (typeof unsubError === 'function') unsubError();
        };
    }, []);

    const startDownload = () => {
        ipcRenderer?.startUpdateDownload?.().catch((err: unknown) => {
            setError((err as Error).message);
            setStatus('error');
        });
    };

    const quitAndInstall = () => {
        ipcRenderer?.quitAndInstall?.();
    };

    return {
        updateInfo,
        status,
        progress,
        error,
        startDownload,
        quitAndInstall
    };
};
