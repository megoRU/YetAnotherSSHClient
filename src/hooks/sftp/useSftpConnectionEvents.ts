import { useEffect } from 'react';
import type { SftpErrorEvent, SftpErrorKind, SftpStatusEvent, SftpStatusKind, SSHConfig } from '../../types';

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
    setStatusKind: (kind: SftpStatusKind | null) => void;
    setErrorKind: (kind: SftpErrorKind | null) => void;
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
    setStatusKind,
    setErrorKind,
    tRef
}: UseSftpConnectionEventsProps) {
    useEffect(() => {
        let active = true;

        const unsubStatus = ipcRenderer?.onSFTPStatus?.(id, async (event: SftpStatusEvent) => {
            if (!active) return;
            rawStatusRef.current = event.kind;
            setStatusKind(event.kind);
            if (event.kind === 'ready') {
                setStatus(tRef.current('sftp.ready'));
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
                const message = tRef.current(event.kind === 'connection-ended' ? 'sftp.connectionEnded' : 'sftp.connectionClosed');
                setStatus(message);
                setError(message);
                setLoading(false);
            }
        });

        const unsubError = ipcRenderer?.onSFTPError?.(id, (event: SftpErrorEvent) => {
            if (!active) return;
            rawStatusRef.current = event.kind;
            setErrorKind(event.kind);
            if (event.kind === 'auth-failure') {
                wasConnectedRef.current = false;
            }
            const message = resolveErrorMessage(event, tRef.current);
            setError(message);
            setStatus(message);
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
        setStatusKind,
        setErrorKind,
        tRef
    ]);
}

function resolveErrorMessage(event: SftpErrorEvent, t: (key: string, params?: Record<string, string>) => string): string {
    switch (event.kind) {
        case 'auth-failure':
            return t('terminal.authFailed');
        case 'tcp-timeout':
            return t('common.tcpTimeout');
        case 'socket-error':
            return t('errors.socketError', { message: event.message ?? '' });
        default:
            // ssh-error / config-error: сообщение уже локализовано в main-процессе.
            return event.message ?? event.kind;
    }
}
