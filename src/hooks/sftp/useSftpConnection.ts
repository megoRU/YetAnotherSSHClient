import { useCallback, useEffect, useRef, useState } from 'react';
import type { SSHConfig } from '../../types';
import { useI18n } from '../../utils/i18n';

const { ipcRenderer } = window;

export function useSftpConnection(id: string, config: SSHConfig, language = 'ru') {
    const { t } = useI18n(language);
    const tRef = useRef(t);
    useEffect(() => {
        tRef.current = t;
    }, [t]);

    const [status, setStatus] = useState(t('sftp.downloading'));
    const [error, setError] = useState<string | null>(null);
    const [countdown, setCountdown] = useState<number | null>(null);

    const isConnectingRef = useRef(false);
    const wasConnectedRef = useRef(false);
    const rawStatusRef = useRef('');

    const connect = useCallback(() => {
        setStatus(tRef.current('sftp.downloading'));
        setError(null);
        setCountdown(null);
        isConnectingRef.current = false;
        ipcRenderer?.sftpConnect?.({ id, config });
    }, [id, config]);

    const isAuthFailed = error?.startsWith('AUTH_FAILURE:');
    const isClosed = error === t('sftp.connectionEnded') || error === t('sftp.connectionClosed');
    const isConnected = status === t('sftp.ready');
    const isFailed = !!error;

    const getDisplayStatus = useCallback((s: string) => {
        if (isAuthFailed) return t('terminal.authFailed');
        if (isConnected) return t('sftp.ready');
        if (s === t('sftp.downloading') || s === t('terminal.connecting')) return t('terminal.connecting');
        if (s === t('sftp.connectionEnded')) return t('sftp.connectionEnded');
        if (s === t('sftp.connectionClosed')) return t('sftp.connectionClosed');
        if (s === t('common.tcpTimeout')) return t('common.tcpTimeout');
        if (s?.startsWith(t('common.socketError'))) {
            return s;
        }
        return s;
    }, [isAuthFailed, isConnected, t]);

    const displayStatus = getDisplayStatus(status);

    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | undefined;
        const eLower = error?.toLowerCase() || '';
        const isConnectionClosed = error === 'SFTP-соединение завершено' || error === 'SFTP-соединение закрыто' || error === 'Connection closed' || error === 'Connection ended' || eLower.includes('closed') || eLower.includes('ended');
        const isErrorStatus = error && (
            eLower.includes('ошибка') ||
            eLower.includes('тайм-аут') ||
            eLower.includes('error') ||
            eLower.includes('failed') ||
            eLower.includes('timeout') ||
            eLower.includes('reset') ||
            eLower.includes('aborted') ||
            eLower.includes('econn') ||
            eLower.includes('etimedout')
        );

        if ((isConnectionClosed || isErrorStatus) && wasConnectedRef.current && !isAuthFailed) {
            setCountdown(5);
            timer = setInterval(() => {
                setCountdown(prev => {
                    if (prev === null) return null;
                    if (prev <= 1) {
                        clearInterval(timer);
                        connect();
                        return null;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [error, connect, isAuthFailed]);

    return {
        status,
        setStatus,
        error,
        setError,
        countdown,
        setCountdown,
        connect,
        isAuthFailed,
        isClosed,
        isConnected,
        isFailed,
        displayStatus,
        getDisplayStatus,
        isConnectingRef,
        wasConnectedRef,
        rawStatusRef,
        tRef
    };
}
