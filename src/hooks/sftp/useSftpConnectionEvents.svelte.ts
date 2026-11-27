import type { SftpErrorEvent, SftpErrorKind, SftpStatusEvent, SftpStatusKind, SSHConfig } from '../../types';

import { untrack } from 'svelte';

import { type RefObject } from '../../utils/dom';

const { ipcRenderer } = window;

interface UseSftpConnectionEventsProps {
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
    tRef: RefObject<(key: string, params?: Record<string, string>) => string>;
}

export function useSftpConnectionEvents(options: UseSftpConnectionEventsProps) {
    const defaultDirectoryRef = { current: options.config.sftpDefaultDirectory };
    $effect(() => {
        void [options.config.sftpDefaultDirectory];
        return untrack(() => {
            defaultDirectoryRef.current = options.config.sftpDefaultDirectory;
        });
    });

    $effect(() => {
        void [
            options.id,
            options.connect,
            options.rawStatusRef,
            options.setStatus,
            options.wasConnectedRef,
            options.isConnectingRef,
            options.pendingDeletesRef,
            options.loadDirectory,
            options.setError,
            options.setLoading,
            options.setStatusKind,
            options.setErrorKind,
            options.tRef,
        ];
        return untrack(() => {
            let active = true;

            const unsubStatus = ipcRenderer?.onSFTPStatus?.(options.id, async (event: SftpStatusEvent) => {
                if (!active) return;
                options.rawStatusRef.current = event.kind;
                options.setStatusKind(event.kind);
                if (event.kind === 'ready') {
                    options.setStatus(options.tRef.current('sftp.ready'));
                    options.wasConnectedRef.current = true;
                    if (!options.isConnectingRef.current) {
                        options.isConnectingRef.current = true;
                        if (options.pendingDeletesRef.current.length > 0) {
                            const toDelete = [...options.pendingDeletesRef.current];
                            options.pendingDeletesRef.current = [];
                            for (const p of toDelete) {
                                try {
                                    await ipcRenderer?.sftpRm?.({ id: options.id, path: p, isDir: false });
                                } catch {
                                    /* ignore */
                                }
                            }
                        }
                        ipcRenderer
                            ?.sftpRealpath?.({ id: options.id, path: '.' })
                            .then((res: string) => {
                                options.loadDirectory(defaultDirectoryRef.current?.trim() || res, true);
                            })
                            .catch(() => options.loadDirectory(defaultDirectoryRef.current?.trim() || '/', true));
                    }
                } else {
                    options.isConnectingRef.current = false;
                    const message = options.tRef.current(
                        event.kind === 'connection-ended' ? 'sftp.connectionEnded' : 'sftp.connectionClosed',
                    );
                    options.setStatus(message);
                    options.setError(message);
                    options.setLoading(false);
                }
            });

            const unsubError = ipcRenderer?.onSFTPError?.(options.id, (event: SftpErrorEvent) => {
                if (!active) return;
                options.rawStatusRef.current = event.kind;
                options.setErrorKind(event.kind);
                if (event.kind === 'auth-failure') {
                    options.wasConnectedRef.current = false;
                }
                const message = resolveErrorMessage(event, options.tRef.current);
                options.setError(message);
                options.setStatus(message);
                options.setLoading(false);
                options.isConnectingRef.current = false;
            });

            if (active) {
                options.connect();
            }

            return () => {
                active = false;
                if (typeof unsubStatus === 'function') unsubStatus();
                if (typeof unsubError === 'function') unsubError();
                ipcRenderer?.sshClose?.(options.id);
            };
        });
    });
}

function resolveErrorMessage(
    event: SftpErrorEvent,
    t: (key: string, params?: Record<string, string>) => string,
): string {
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
