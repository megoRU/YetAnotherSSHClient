import { useState, useEffect } from 'react';
import type { UpdateInfo, UpdateProgress, UpdateStatus } from '../types';

const { ipcRenderer } = window;

export const useUpdateChecker = () => {
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [status, setStatus] = useState<UpdateStatus>('idle');
    const [progress, setProgress] = useState<UpdateProgress | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const unsubAvailable = ipcRenderer?.on?.('update-available', (info: unknown) => {
            setUpdateInfo(info as UpdateInfo);
        });

        const unsubStatus = ipcRenderer?.on?.('update-status', (s: unknown) => {
            setStatus(s as UpdateStatus);
        });

        const unsubProgress = ipcRenderer?.on?.('update-progress', (p: unknown) => {
            setProgress(p as UpdateProgress);
        });

        const unsubError = ipcRenderer?.on?.('update-error', (err: unknown) => {
            setError(err as string);
        });

        return () => {
            if (typeof unsubAvailable === 'function') unsubAvailable();
            if (typeof unsubStatus === 'function') unsubStatus();
            if (typeof unsubProgress === 'function') unsubProgress();
            if (typeof unsubError === 'function') unsubError();
        };
    }, []);

    const startDownload = () => {
        ipcRenderer?.invoke?.('start-update-download').catch(err => {
            setError(err.message);
            setStatus('error');
        });
    };

    const quitAndInstall = () => {
        ipcRenderer?.send?.('quit-and-install');
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
