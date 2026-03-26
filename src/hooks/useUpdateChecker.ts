import { useState, useEffect } from 'react';

const { ipcRenderer } = window as any;

export const useUpdateChecker = () => {
    const [updateAvailable, setUpdateAvailable] = useState<{ version: string, url: string } | null>(null);

    useEffect(() => {
        const unlisten = ipcRenderer.on('update-available', (data: any) => {
            setUpdateAvailable(data);
        });
        return () => {
            if (typeof unlisten === 'function') unlisten();
        };
    }, []);

    return updateAvailable;
};
