import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SftpErrorKind, SftpStatusKind, SSHConfig } from '../../types';
import { useI18n, type Language } from '../../utils/i18n';

const { ipcRenderer } = window;

export function useSftpConnection(id: string, config: SSHConfig, language: Language = 'ru') {
    const { t } = useI18n(language);
    const tRef = useRef(t);
    useEffect(() => {
        tRef.current = t;
    }, [t]);

    const [status, setStatus] = useState(t('sftp.downloading'));
    const [error, setError] = useState<string | null>(null);
    const [countdown, setCountdown] = useState<number | null>(null);

    // Логика (reconnect, isConnected, isAuthFailed и т.п.) строится на
    // структурированных кодах, а не на локализованных строках. Перевод
    // применяется только при отображении (status/displayStatus).
    const [statusKind, setStatusKind] = useState<SftpStatusKind | null>(null);
    const [errorKind, setErrorKind] = useState<SftpErrorKind | null>(null);

    const isConnectingRef = useRef(false);
    const wasConnectedRef = useRef(false);
    const rawStatusRef = useRef('');

    // Каталог по умолчанию используется рендерером при открытии списка и не
    // должен менять параметры активного SSH/SFTP-соединения.
    const connectionConfig = useMemo(() => {
        const next = { ...config };
        delete next.sftpDefaultDirectory;
        return next;
    // Зависимости перечислены по полям SSHConfig; намеренно исключено только
    // sftpDefaultDirectory, чтобы его переключение не перезапускало соединение.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        config.id,
        config.name,
        config.user,
        config.host,
        config.port,
        config.password,
        config.keyPassphrase,
        config.authType,
        config.privateKey,
        config.privateKeyPath,
        config.osPrettyName,
        config.initialCommands,
        config.fingerprint
    ]);

    const connect = useCallback(() => {
        setStatus(tRef.current('sftp.downloading'));
        setError(null);
        setErrorKind(null);
        setStatusKind(null);
        setCountdown(null);
        isConnectingRef.current = false;
        ipcRenderer?.sftpConnect?.({ id, config: connectionConfig });
    }, [id, connectionConfig]);

    const isAuthFailed = errorKind === 'auth-failure';
    const isClosed = statusKind === 'connection-ended' || statusKind === 'connection-closed';
    const isConnected = statusKind === 'ready';
    const isFailed = errorKind !== null || isClosed;

    const getDisplayStatus = useCallback((s: string): string => {
        if (isAuthFailed) return t('terminal.authFailed');
        if (isConnected) return t('sftp.ready');
        if (s === t('sftp.downloading') || s === t('terminal.connecting')) return t('terminal.connecting');
        if (s === t('sftp.connectionEnded')) return t('sftp.connectionEnded');
        if (s === t('sftp.connectionClosed')) return t('sftp.connectionClosed');
        if (s === t('common.tcpTimeout')) return t('common.tcpTimeout');
        return s;
    }, [isAuthFailed, isConnected, t]);

    const displayStatus = error ?? getDisplayStatus(status);

    useEffect(() => {
        const isConnectionClosed = statusKind === 'connection-ended' || statusKind === 'connection-closed';
        const isErrorStatus = errorKind !== null && errorKind !== 'auth-failure';

        if (!((isConnectionClosed || isErrorStatus) && wasConnectedRef.current && !isAuthFailed)) {
            return;
        }
        setCountdown(5);
        const timer = setInterval(() => {
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
        return () => clearInterval(timer);
    }, [statusKind, errorKind, connect, isAuthFailed]);

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
        statusKind,
        setStatusKind,
        errorKind,
        setErrorKind,
        isConnectingRef,
        wasConnectedRef,
        rawStatusRef,
        tRef
    };
}
