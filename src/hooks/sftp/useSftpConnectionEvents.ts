import { useEffect } from 'react';
import type { SSHConfig } from '../../types';

const { ipcRenderer } = window;

interface UseSftpConnectionEventsProps {
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
    tRef: React.MutableRefObject<(key: string, params?: Record<string, string>) => string>;
}

export function useSftpConnectionEvents({
    id,
    connect,
    rawStatusRef,
    setStatus,
    wasConnectedRef,
    isConnectingRef,
    pendingDeletesRef,
    loadDirectory,
    setError,
    setLoading,
    tRef
}: UseSftpConnectionEventsProps) {
    useEffect(() => {
        let active = true;

        const unsubStatus = ipcRenderer?.onSFTPStatus?.(id, async (msg: string) => {
            if (!active) return;
            rawStatusRef.current = msg;
            setStatus(msg);
            if (msg === tRef.current('sftp.ready')) {
                wasConnectedRef.current = true;
                if (!isConnectingRef.current) {
                    isConnectingRef.current = true;
                    if (pendingDeletesRef.current.length > 0) {
                        const toDelete = [...pendingDeletesRef.current];
                        pendingDeletesRef.current = [];
                        for (const p of toDelete) {
                            try {
                                await ipcRenderer?.sftpRm?.({ id, path: p, isDir: false });
                            } catch { /* ignore */ }
                        }
                    }
                    ipcRenderer?.sftpRealpath?.({ id, path: '.' }).then((res: string) => {
                        loadDirectory(res, true);
                    }).catch(() => loadDirectory('/', true));
                }
            } else {
                isConnectingRef.current = false;
                if (msg === tRef.current('sftp.connectionEnded') || msg === tRef.current('sftp.connectionClosed')) {
                    setError(msg);
                    setLoading(false);
                }
            }
        });

        const unsubError = ipcRenderer?.onSFTPError?.(id, (msg: string) => {
            if (!active) return;
            rawStatusRef.current = msg;
            if (msg.startsWith('AUTH_FAILURE:')) {
                wasConnectedRef.current = false;
            }
            setError(msg);
            setStatus(msg);
            setLoading(false);
            isConnectingRef.current = false;
        });

        if (active) {
            connect();
        }

        return () => {
            active = false;
            if (typeof unsubStatus === 'function') unsubStatus();
            if (typeof unsubError === 'function') unsubError();
            ipcRenderer?.sshClose?.(id);
        };
    }, [
        id,
        connect,
        rawStatusRef,
        setStatus,
        wasConnectedRef,
        isConnectingRef,
        pendingDeletesRef,
        loadDirectory,
        setError,
        setLoading,
        tRef
    ]);
}
