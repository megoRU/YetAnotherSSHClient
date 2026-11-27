import type { SftpErrorKind, SftpStatusKind, SSHConfig } from '../../types';

import { createI18n, type Language } from '../../utils/i18n';

import { untrack } from 'svelte';

import { type SetStateAction } from '../../utils/dom';

const { ipcRenderer } = window;

export function useSftpConnection(
    getId: () => string,
    getConfig: () => SSHConfig,
    getLanguage: () => Language = () => 'ru',
) {
    const { t } = $derived(createI18n(getLanguage()));
    const tRef = {
        get current() {
            return t;
        },
    };
    let status = $state.raw(untrack(() => t('sftp.downloading')));
    function setStatus(next: SetStateAction<typeof status>) {
        status = typeof next === 'function' ? next(status) : next;
    }
    let error = $state.raw<string | null>(null);
    function setError(next: SetStateAction<string | null>) {
        error = typeof next === 'function' ? next(error) : next;
    }
    let countdown = $state.raw<number | null>(null);
    function setCountdown(next: SetStateAction<number | null>) {
        countdown = typeof next === 'function' ? next(countdown) : next;
    }

    // Логика (reconnect, isConnected, isAuthFailed и т.п.) строится на
    // структурированных кодах, а не на локализованных строках. Перевод
    // применяется только при отображении (status/displayStatus).
    let statusKind = $state.raw<SftpStatusKind | null>(null);
    function setStatusKind(next: SetStateAction<SftpStatusKind | null>) {
        statusKind = typeof next === 'function' ? next(statusKind) : next;
    }
    let errorKind = $state.raw<SftpErrorKind | null>(null);
    function setErrorKind(next: SetStateAction<SftpErrorKind | null>) {
        errorKind = typeof next === 'function' ? next(errorKind) : next;
    }

    const isConnectingRef = { current: false };
    const wasConnectedRef = { current: false };
    const rawStatusRef = { current: '' };

    // Каталог по умолчанию используется рендерером при открытии списка и не
    // должен менять параметры активного SSH/SFTP-соединения.
    const configId = $derived(getConfig().id);
    const name = $derived(getConfig().name);
    const user = $derived(getConfig().user);
    const host = $derived(getConfig().host);
    const port = $derived(getConfig().port);
    const password = $derived(getConfig().password);
    const keyPassphrase = $derived(getConfig().keyPassphrase);
    const authType = $derived(getConfig().authType);
    const privateKey = $derived(getConfig().privateKey);
    const privateKeyPath = $derived(getConfig().privateKeyPath);
    const osPrettyName = $derived(getConfig().osPrettyName);
    const initialCommands = $derived(getConfig().initialCommands);
    const fingerprint = $derived(getConfig().fingerprint);

    const connect = $derived.by(() => {
        const id = getId();
        const config: SSHConfig = {
            id: configId,
            name,
            user,
            host,
            port,
            password,
            keyPassphrase,
            authType,
            privateKey,
            privateKeyPath,
            osPrettyName,
            initialCommands,
            fingerprint,
        };
        return () => {
            setStatus(tRef.current('sftp.downloading'));
            setError(null);
            setErrorKind(null);
            setStatusKind(null);
            setCountdown(null);
            isConnectingRef.current = false;
            ipcRenderer?.sftpConnect?.({ id, config });
        };
    });

    const isAuthFailed = $derived(errorKind === 'auth-failure');
    const isClosed = $derived(statusKind === 'connection-ended' || statusKind === 'connection-closed');
    const isConnected = $derived(statusKind === 'ready');
    const isFailed = $derived(errorKind !== null || isClosed);

    const getDisplayStatus = (s: string): string => {
        if (isAuthFailed) return t('terminal.authFailed');
        if (statusKind === 'ready') return t('sftp.ready');
        if (statusKind === 'connection-ended') return t('sftp.connectionEnded');
        if (statusKind === 'connection-closed') return t('sftp.connectionClosed');
        if (errorKind === 'tcp-timeout') return t('common.tcpTimeout');
        if (statusKind === null && errorKind === null) return t('terminal.connecting');
        return s;
    };

    const displayStatus = $derived(error ?? getDisplayStatus(status));

    $effect(() => {
        void [statusKind, errorKind, connect, isAuthFailed];
        return untrack(() => {
            const isConnectionClosed = statusKind === 'connection-ended' || statusKind === 'connection-closed';
            const isErrorStatus = errorKind !== null && errorKind !== 'auth-failure';

            if (!((isConnectionClosed || isErrorStatus) && wasConnectedRef.current && !isAuthFailed)) {
                return;
            }
            setCountdown(5);
            const timer = setInterval(() => {
                setCountdown((prev) => {
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
        });
    });

    return {
        get status() {
            return status;
        },
        get setStatus() {
            return setStatus;
        },
        get error() {
            return error;
        },
        setError,
        get countdown() {
            return countdown;
        },
        setCountdown,
        get connect() {
            return connect;
        },
        get isAuthFailed() {
            return isAuthFailed;
        },
        get isClosed() {
            return isClosed;
        },
        get isConnected() {
            return isConnected;
        },
        get isFailed() {
            return isFailed;
        },
        get displayStatus() {
            return displayStatus;
        },
        get getDisplayStatus() {
            return getDisplayStatus;
        },
        get statusKind() {
            return statusKind;
        },
        setStatusKind,
        get errorKind() {
            return errorKind;
        },
        setErrorKind,
        isConnectingRef,
        wasConnectedRef,
        rawStatusRef,
        tRef,
    };
}
