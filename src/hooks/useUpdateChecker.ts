import { useState, useEffect } from 'react';

const { ipcRenderer } = window;

export const useUpdateChecker = () => {
    const [updateAvailable, setUpdateAvailable] = useState<{ version: string, url: string } | null>(null);

    useEffect(() => {
        const unlisten = ipcRenderer.on('update-available', (...args: unknown[]) => {
            setUpdateAvailable(args[0] as { version: string, url: string });
        });
        return () => {
            if (typeof unlisten === 'function') unlisten();
        };
    }, []);

    return updateAvailable;
};
