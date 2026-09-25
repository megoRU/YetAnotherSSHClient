import React, { useEffect, useMemo, useRef, useState, useCallback, type FC, type MouseEvent } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as IconTerminal, Plug, Loader2 } from 'lucide-react';
import { getXtermTheme } from '../utils/theme';
import { getOSIcon } from '../utils';
import { ensureTerminalFont } from '../utils/fontLoader';
import { useI18n } from '../utils/i18n';
import { useTerminalFit } from '../hooks/useTerminalFit';
import { createTerminalKeyHandler } from '../utils/terminalKeys';
import { LoginPromptModal } from './modals/LoginPromptModal';
import { SshAuthModal } from './modals/SshAuthModal';
import { isLoginRequiredStatus, type SshAuthChallenge, type SessionCredentials } from '../ipc';
import type { SSHConfig, AppConfig, EncryptedSecret } from '../types';
import '@xterm/xterm/css/xterm.css';

const { ipcRenderer } = window;

interface Props {
    theme: string;
    config: SSHConfig;
    terminalFontName: string;
    terminalFontSize: number;
    terminalScrollSensitivity: number;
    id: string;
    visible?: boolean;
    keywordHighlighting: boolean;
    onOSInfo?: (osInfo: string) => void;
    onCredentialsEntered?: (config: SSHConfig, credentials: SessionCredentials) => void;
    onPrivateKeyEntered?: (config: SSHConfig, privateKey: EncryptedSecret) => void;
    enableContextMenu?: boolean;
    onEditConfig?: (config: SSHConfig) => void;
    onClose?: () => void;
    appConfig?: AppConfig;
    onAlternateScreenChange?: (isAlternate: boolean) => void;
}

const RESET = '\x1b[0m';
const IP_COLOR = '\x1b[38;2;210;84;154m';

const IPV4_REGEX = /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g;
const IPV6_REGEX = /(?<![0-9A-Fa-f:])((?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|:(?::[0-9A-Fa-f]{1,4}){1,7}|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4})(?![0-9A-Fa-f:])/g;

const KEYWORD_COLORS: Record<string, string> = {
    ERROR: '\x1b[38;2;239;68;68m',
    WARNING: '\x1b[38;2;251;191;36m',
    WARN: '\x1b[38;2;251;191;36m',
    OK: '\x1b[38;2;74;222;128m',
    INFO: '\x1b[38;2;96;165;250m',
    DEBUG: '\x1b[38;2;192;132;252m'
};

const KEYWORD_REGEX = /\b(ERROR|WARNING|WARN|OK|INFO|DEBUG)\b/gi;

const TerminalComponentBase: FC<Props> = ({
    theme,
    config,
    terminalFontName,
    terminalFontSize,
    terminalScrollSensitivity,
    visible,
    keywordHighlighting,
    onOSInfo,
    onCredentialsEntered,
    onPrivateKeyEntered,
    enableContextMenu,
    onEditConfig,
    onClose,
    appConfig,
    onAlternateScreenChange
}) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    const tRef = useRef(t);
    useEffect(() => {
        tRef.current = t;
    }, [t]);

    const keywordHighlightingRef = useRef(keywordHighlighting);
    useEffect(() => {
        keywordHighlightingRef.current = keywordHighlighting;
    }, [keywordHighlighting]);

    const configRef = useRef(config);
    useEffect(() => {
        configRef.current = config;
    }, [config]);

    const themeRef = useRef(theme);
    const terminalFontNameRef = useRef(terminalFontName);
    const terminalFontSizeRef = useRef(terminalFontSize);
    const terminalScrollSensitivityRef = useRef(terminalScrollSensitivity);
    useEffect(() => { themeRef.current = theme; }, [theme]);
    useEffect(() => { terminalFontNameRef.current = terminalFontName; }, [terminalFontName]);
    useEffect(() => { terminalFontSizeRef.current = terminalFontSize; }, [terminalFontSize]);
    useEffect(() => { terminalScrollSensitivityRef.current = terminalScrollSensitivity; }, [terminalScrollSensitivity]);

    const termRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const webglAddonRef = useRef<WebglAddon | null>(null);
    const connIdRef = useRef<string | null>(null);
    const lastColsRef = useRef<number>(0);
    const lastRowsRef = useRef<number>(0);
    const hasReceivedDataRef = useRef<boolean>(false);
    const [status, setStatus] = useState<string>(t('terminal.connecting'));
    const [retryKey, setRetryKey] = useState<number>(0);
    const [isReady, setIsReady] = useState(false);
    const [hasReceivedData, setHasReceivedData] = useState(false);
    const [showTerminal, setShowTerminal] = useState(false);
    const isMountedRef = useRef<boolean>(true);
    const wasConnectedRef = useRef<boolean>(false);
    const [countdown, setCountdown] = useState<number | null>(null);
    // Логин/пароль/парольная фраза, введённые пользователем при подключении: держатся
    // в памяти компонента и подставляются в payload подключения.
    const sessionCredentialsRef = useRef<SessionCredentials>({});
    // Ключ, введённый пользователем вместо пароля (зашифрованный в вольте).
    const sessionPrivateKeyRef = useRef<EncryptedSecret | undefined>(undefined);
    const [loginPrompt, setLoginPrompt] = useState(false);
    const [authChallenge, setAuthChallenge] = useState<SshAuthChallenge | null>(null);
    const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const outputDecoderRef = useRef<TextDecoder>(new TextDecoder('utf-8'));
    const outputQueueRef = useRef<string[]>([]);
    const outputQueueBytesRef = useRef<number>(0);
    const outputFlushRafIdRef = useRef<number | null>(null);
    const outputFlushIsTimeoutRef = useRef<boolean>(false);

    // Вычисляемые свойства (Derived State)
    const isWaiting = !showTerminal;
    const isAuthFailed = status.startsWith('AUTH_FAILURE:');
    const statusLower = status.toLowerCase();
    const isClosed = status === t('terminal.closed');
    const isConnected = status === t('terminal.connected');
    const isFailed = statusLower.includes('ошибка') ||
                     statusLower.includes('тайм-аут') ||
                     statusLower.includes('error') ||
                     statusLower.includes('failed') ||
                     statusLower.includes('timeout') ||
                     isClosed ||
                     isAuthFailed;

    const getDisplayStatus = useCallback((s: string) => {
        if (isAuthFailed) return t('terminal.authFailed');
        if (isConnected) return t('terminal.connected');
        if (isClosed) return t('terminal.closed');
        if (s === t('terminal.connecting')) return t('terminal.connecting');
        if (s === t('common.tcpTimeout')) return t('common.tcpTimeout');
        if (s?.startsWith(t('common.socketError'))) {
            return s;
        }
        return s;
    }, [isAuthFailed, isConnected, isClosed, t]);

    const displayStatus = getDisplayStatus(status);

    // Refs for props to avoid effect re-runs
    const onOSInfoRef = useRef(onOSInfo);
    useEffect(() => { onOSInfoRef.current = onOSInfo; }, [onOSInfo]);

    const onCredentialsEnteredRef = useRef(onCredentialsEntered);
    useEffect(() => { onCredentialsEnteredRef.current = onCredentialsEntered; }, [onCredentialsEntered]);

    const onPrivateKeyEnteredRef = useRef(onPrivateKeyEntered);
    useEffect(() => { onPrivateKeyEnteredRef.current = onPrivateKeyEntered; }, [onPrivateKeyEntered]);

    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    const onAlternateScreenChangeRef = useRef(onAlternateScreenChange);
    useEffect(() => { onAlternateScreenChangeRef.current = onAlternateScreenChange; }, [onAlternateScreenChange]);

    const visibleRef = useRef(visible);
    useEffect(() => {
        visibleRef.current = visible;
        if (xtermRef.current) {
            const isAlt = xtermRef.current.buffer.active.type === 'alternate';
            onAlternateScreenChangeRef.current?.(visible ? isAlt : false);
        }
    }, [visible]);

    const { safeFit, clearPendingFit } = useTerminalFit({
        visible: !!visible,
        isMountedRef,
        xtermRef,
        fitAddonRef,
        termRef,
        lastColsRef,
        lastRowsRef,
        canResize: useCallback(() => !!connIdRef.current, []),
        onResize: useCallback((cols: number, rows: number) => {
            const connId = connIdRef.current;
            if (connId) ipcRenderer?.sshResize?.({ id: connId, cols, rows });
        }, []),
        logPrefix: '[Terminal]'
    });

    // Ref для вызова safeFit из колбэков, чтобы не тянуть его в зависимости эффектов
    const safeFitRef = useRef(safeFit);
    useEffect(() => { safeFitRef.current = safeFit; }, [safeFit]);

    const connect = useCallback((connId: string, cols?: number, rows?: number) => {
        if (!xtermRef.current) return;
        setStatus(tRef.current('terminal.connecting'));
        hasReceivedDataRef.current = false;
        setHasReceivedData(false);
        setIsAuthSubmitting(false);
        const finalCols = cols || xtermRef.current.cols || 80;
        const finalRows = rows || xtermRef.current.rows || 24;
        const sessionCredentials = sessionCredentialsRef.current;
        const sessionKey = sessionPrivateKeyRef.current;
        const connectConfig: SSHConfig = {
            ...configRef.current,
            ...(sessionCredentials.user ? { user: sessionCredentials.user } : {}),
            ...(sessionCredentials.password ? { password: sessionCredentials.password } : {}),
            ...(sessionCredentials.keyPassphrase ? { keyPassphrase: sessionCredentials.keyPassphrase } : {}),
            ...(sessionKey ? { authType: 'key' as const, privateKey: sessionKey } : {})
        };
        ipcRenderer?.sshConnect?.({ id: connId, config: connectConfig, cols: finalCols, rows: finalRows });
    }, []);

    const handleLoginSubmit = useCallback((user: string) => {
        sessionCredentialsRef.current = { ...sessionCredentialsRef.current, user };
        setLoginPrompt(false);
        // Логин сохраняется для этого сервера, чтобы не спрашивать его снова
        onCredentialsEnteredRef.current?.(configRef.current, { user });
        const connId = connIdRef.current;
        if (!connId) return;
        connect(connId, xtermRef.current?.cols, xtermRef.current?.rows);
    }, [connect]);

    const handleLoginCancel = useCallback(() => {
        setLoginPrompt(false);
        // Отказ от ввода логина закрывает вкладку целиком
        onCloseRef.current?.();
    }, []);

    // Ответ на запрос авторизации от сервера: пароль или парольная фраза
    const handleAuthSecretSubmit = useCallback((secret: string) => {
        const connId = connIdRef.current;
        if (!connId || !authChallenge) return;

        const isPassphrase = authChallenge.kind === 'passphrase';
        sessionCredentialsRef.current = isPassphrase
            ? { ...sessionCredentialsRef.current, keyPassphrase: secret }
            : { ...sessionCredentialsRef.current, password: secret };
        // Отказ сервера от ключа (challenge 'password') переводит сервер на парольную авторизацию;
        // keyboard-interactive — это запрос сервера, метод авторизации не меняем
        const replaceKeyAuth = authChallenge.kind === 'password';
        onCredentialsEnteredRef.current?.(configRef.current, isPassphrase
            ? { keyPassphrase: secret }
            : { password: secret, replaceKeyAuth });

        setIsAuthSubmitting(true);
        setStatus(tRef.current('terminal.connecting'));
        ipcRenderer?.sshAuthResponse?.({
            id: connId,
            response: 'secret',
            kind: authChallenge.kind,
            secret
        });
    }, [authChallenge]);

    // Ответ содержим приватного ключа: шифруем его в вольте и подключаемся ключом
    const handleAuthKeySubmit = useCallback(async (keyContent: string) => {
        const connId = connIdRef.current;
        if (!connId || !authChallenge || isAuthSubmitting) return;

        setIsAuthSubmitting(true);
        try {
            const privateKey = await ipcRenderer?.encryptPrivateKey?.(keyContent);
            if (!privateKey) throw new Error(tRef.current('errors.privateKeyEncryptFailed'));
            sessionPrivateKeyRef.current = privateKey;
            // Логин сохраняем: подключение пойдёт ключом, но пользователь нужен серверу
            sessionCredentialsRef.current = { user: sessionCredentialsRef.current.user };
            // Ключ сохраняется для этого сервера и используется вместо пароля
            onPrivateKeyEnteredRef.current?.(configRef.current, privateKey);
            setStatus(tRef.current('terminal.connecting'));
            ipcRenderer?.sshAuthResponse?.({ id: connId, response: 'privateKey', privateKey });
        } catch (err) {
            console.error('[Terminal] Failed to apply private key:', err);
            setIsAuthSubmitting(false);
            setAuthError(tRef.current('errors.privateKeyEncryptFailed'));
        }
    }, [authChallenge, isAuthSubmitting]);

    const handleAuthCancel = useCallback(() => {
        const connId = connIdRef.current;
        setAuthChallenge(null);
        setIsAuthSubmitting(false);
        if (connId) {
            // Сообщаем main, что ввод отменён: попытка авторизации прерывается
            ipcRenderer?.sshAuthResponse?.({ id: connId, response: 'cancel' });
        }
        // Отказ от ввода закрывает вкладку целиком
        onCloseRef.current?.();
    }, []);

    /**
     * Подпись параметров подключения: терминал пересоздаётся только когда они
     * реально меняются, поэтому, например, обновление osPrettyName после
     * подключения не рвёт соединение и не вызывает повторного подключения.
     */
    const connectionSignature = useMemo(
        () => JSON.stringify([
            config.id ?? '',
            config.host,
            config.port,
            config.user,
            config.authType,
            config.privateKeyPath ?? '',
            config.privateKey ?? '',
            config.password ?? '',
            config.keyPassphrase ?? '',
            config.initialCommands ?? ''
        ]),
        [config]
    );

    useEffect(() => {
        if (!termRef.current) return;
        let active = true;

        Promise.resolve().then(() => {
            if (active) setIsReady(false);
        });

        const connId = Math.random().toString(36).substring(2, 15);
        connIdRef.current = connId;
        isMountedRef.current = true;

        const term = new Terminal({
            cursorBlink: true,
            cursorStyle: 'block',
            theme: getXtermTheme(themeRef.current),
            fontFamily: "'" + terminalFontNameRef.current + "', 'JetBrains Mono', monospace",
            fontSize: terminalFontSizeRef.current,
            allowProposedApi: true,
            lineHeight: 1,
            letterSpacing: 0,
            scrollback: 50000,
            scrollSensitivity: terminalScrollSensitivityRef.current,
        });

        const fitAddon = new FitAddon();
        const clipboardAddon = new ClipboardAddon();
        const webLinksAddon = new WebLinksAddon((_event, url) => {
            ipcRenderer?.openExternal?.(url);
        });

        term.loadAddon(fitAddon);
        term.loadAddon(clipboardAddon);
        term.loadAddon(webLinksAddon);

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        const openTerminal = () => {
            if (!active || !termRef.current) return;
            term.open(termRef.current);

            if (visibleRef.current) {
                try {
                    const webglAddon = new WebglAddon();
                    webglAddon.onContextLoss(() => {
                        webglAddon.dispose();
                        webglAddonRef.current = null;
                    });
                    term.loadAddon(webglAddon);
                    webglAddonRef.current = webglAddon;
                } catch (e) {
                    console.warn('WebGL addon could not be loaded, falling back to standard renderer', e);
                }
            }

            requestAnimationFrame(() => {
                if (!active) return;
                try {
                    if (termRef.current && termRef.current.clientWidth > 0 && termRef.current.clientHeight > 0) {
                        fitAddon.fit();
                    }
                    const { cols, rows } = term;
                    setIsReady(true);
                    lastColsRef.current = cols;
                    lastRowsRef.current = rows;
                    connect(connId, cols, rows);
                    term.element?.classList.add('xterm-ready');
                } catch (e) {
                    console.warn('[Terminal] Initial fit failed:', e);
                    connect(connId);
                    setIsReady(true);
                }
            });
        };

        const ensureFont = async () => {
            await ensureTerminalFont(terminalFontSizeRef.current, terminalFontNameRef.current);
            openTerminal();
        };
        void ensureFont();

        const resizeObserver = new ResizeObserver(() => {
            if (isMountedRef.current) {
                safeFitRef.current();
            }
        });
        resizeObserver.observe(termRef.current);

        term.onData(data => {
            ipcRenderer?.sshInput?.({ id: connId, data });
        });

        const updateBufferType = () => {
            const isAlternate = term.buffer.active.type === 'alternate';
            if (visibleRef.current) {
                onAlternateScreenChangeRef.current?.(isAlternate);
            }
        };

        const bufferDisposable = term.buffer.onBufferChange(updateBufferType);
        updateBufferType();

        term.attachCustomKeyEventHandler(createTerminalKeyHandler(term, {
            isMounted: () => isMountedRef.current,
            isMac: ipcRenderer?.platform === 'darwin',
            // В альтернативном экране (vim, nvim, nano, htop, tmux) сочетания с Ctrl
            // передаются терминалу
            passCtrlInAlternateScreen: true
        }));

        const applyHighlighting = (text: string): string => {
            let result = text;

            // Pre-check for '.' or ':' before running expensive IP regexes
            const hasDot = result.includes('.');
            const hasColon = result.includes(':');

            if (hasDot) {
                result = result.replace(IPV4_REGEX, ip => `${IP_COLOR}${ip}${RESET}`);
            }
            if (hasColon) {
                result = result.replace(IPV6_REGEX, ip => `${IP_COLOR}${ip}${RESET}`);
            }

            if (keywordHighlightingRef.current && /error|warn|ok|info|debug/i.test(result)) {
                result = result.replace(KEYWORD_REGEX, match => {
                    const color = KEYWORD_COLORS[match.toUpperCase()];
                    return color ? `${color}${match}${RESET}` : match;
                });
            }

            return result;
        };

        const cancelScheduledFlush = () => {
            if (outputFlushRafIdRef.current !== null) {
                if (outputFlushIsTimeoutRef.current) {
                    clearTimeout(outputFlushRafIdRef.current);
                } else {
                    window.cancelAnimationFrame(outputFlushRafIdRef.current);
                }
                outputFlushRafIdRef.current = null;
                outputFlushIsTimeoutRef.current = false;
            }
        };

        const flushOutputQueue = () => {
            cancelScheduledFlush();

            if (!isMountedRef.current) {
                outputQueueRef.current = [];
                outputQueueBytesRef.current = 0;
                return;
            }

            if (outputQueueRef.current.length === 0) {
                return;
            }

            const joinedOutput = outputQueueRef.current.join('');
            outputQueueRef.current = [];
            outputQueueBytesRef.current = 0;

            try {
                // Pre-check if string could match IP or keyword before calling applyHighlighting
                const needsHighlighting = visibleRef.current && (
                    joinedOutput.includes('.') ||
                    joinedOutput.includes(':') ||
                    (keywordHighlightingRef.current && /error|warn|ok|info|debug/i.test(joinedOutput))
                );

                if (!needsHighlighting) {
                    term.write(joinedOutput);
                } else {
                    term.write(applyHighlighting(joinedOutput));
                }
            } catch (err) {
                console.warn('[Terminal] batched write failed:', err);
            }
        };

        const scheduleOutputFlush = () => {
            if (outputFlushRafIdRef.current !== null) {
                return;
            }

            if (visibleRef.current) {
                outputFlushIsTimeoutRef.current = false;
                outputFlushRafIdRef.current = window.requestAnimationFrame(() => {
                    flushOutputQueue();
                });
            } else {
                // In hidden tabs, batch output every 20ms to avoid unnecessary CPU load
                outputFlushIsTimeoutRef.current = true;
                outputFlushRafIdRef.current = window.setTimeout(() => {
                    flushOutputQueue();
                }, 20) as unknown as number;
            }
        };

        const onOutput = (data: Uint8Array) => {
            if (!isMountedRef.current) return;
            if (!hasReceivedDataRef.current) {
                hasReceivedDataRef.current = true;
                setHasReceivedData(true);
            }
            try {
                const text = outputDecoderRef.current.decode(data, { stream: true });
                if (text.length > 0) {
                    outputQueueRef.current.push(text);
                    outputQueueBytesRef.current += data.byteLength;
                }

                const isBufferFull = outputQueueBytesRef.current >= 64 * 1024;

                if (visibleRef.current) {
                    const isSmallInteractiveChunk = outputQueueBytesRef.current <= 4096;
                    if (isSmallInteractiveChunk || isBufferFull) {
                        flushOutputQueue();
                        return;
                    }
                } else {
                    // For hidden terminal, flush immediately only when batch is large (>= 64 KB)
                    if (isBufferFull) {
                        flushOutputQueue();
                        return;
                    }
                }

                scheduleOutputFlush();
            } catch (err) {
                console.warn('[Terminal] write failed:', err);
            }
        };

        const onStatus = (data: string) => {
            if (!isMountedRef.current) return;
            // В конфигурации нет логина — показываем форму ввода вместо обычного статуса
            if (isLoginRequiredStatus(data)) {
                console.log('[Terminal] Login required');
                setLoginPrompt(true);
                return;
            }
            setStatus(data);
            if (data === tRef.current('terminal.connected')) {
                setLoginPrompt(false);
                setAuthChallenge(null);
                setIsAuthSubmitting(false);
                setAuthError(null);
                wasConnectedRef.current = true;
                setCountdown(null);
                // Актуальный конфиг читаем через ref: обновление osPrettyName
                // не должно пересоздавать терминал
                if (!configRef.current.osPrettyName) {
                    ipcRenderer?.sshGetOSInfo?.(connId);
                }
                setTimeout(() => {
                    if (isMountedRef.current) {
                        term.focus();
                        safeFitRef.current();
                        setTimeout(() => safeFitRef.current(), 100);
                    }
                }, 100);
            }
        };

        const onError = (data: string) => {
            if (isMountedRef.current) {
                if (data.startsWith('AUTH_FAILURE:')) {
                    wasConnectedRef.current = false;
                    // Введённый в этой сессии пароль/парольная фраза не подошли — сбрасываем
                    // их, чтобы следующая попытка снова спросила данные у сервера. Логин оставляем.
                    sessionCredentialsRef.current = { user: sessionCredentialsRef.current.user };
                }
                // Ошибка подключения закрывает окно ввода: дальше разбирается пользователь
                setAuthChallenge(null);
                setIsAuthSubmitting(false);
                try {
                    const cleanError = data.startsWith('AUTH_FAILURE:') ? data.replace('AUTH_FAILURE:', '').trim() : data;
                    term.write(`\r\n\x1b[31m${tRef.current('common.error')}: ${cleanError}\x1b[0m\r\n`);
                } catch { /* ignore */ }
                setStatus(data);
            }
        };

        const onAuthChallenge = (challenge: SshAuthChallenge) => {
            if (!isMountedRef.current) return;
            console.log(`[Terminal] Auth challenge: ${challenge.kind} (attempt ${challenge.attempt})`);
            setLoginPrompt(false);
            setAuthError(null);
            setIsAuthSubmitting(false);
            setAuthChallenge(challenge);
        };

        const unsubOutput = ipcRenderer?.onSSHOutput?.(connId, (data: Uint8Array) => onOutput(data));
        const unsubStatus = ipcRenderer?.onSSHStatus?.(connId, (status: string) => onStatus(status));
        const unsubError = ipcRenderer?.onSSHError?.(connId, (error: string) => onError(error));
        const unsubAuth = ipcRenderer?.onSSHAuthChallenge?.(connId, (challenge: SshAuthChallenge) => onAuthChallenge(challenge));
        const unsubOSInfo = ipcRenderer?.onSSHOSInfo?.(connId, (info: string) => {
            if (isMountedRef.current && onOSInfoRef.current) onOSInfoRef.current(info);
        });

        return () => {
            active = false;
            isMountedRef.current = false;
            clearPendingFit();
            resizeObserver.disconnect();
            ipcRenderer?.sshClose?.(connId);
            if (typeof unsubOutput === 'function') unsubOutput();
            if (typeof unsubStatus === 'function') unsubStatus();
            if (typeof unsubError === 'function') unsubError();
            if (typeof unsubAuth === 'function') unsubAuth();
            if (typeof unsubOSInfo === 'function') unsubOSInfo();
            bufferDisposable.dispose();
            onAlternateScreenChangeRef.current?.(false);
            if (outputFlushRafIdRef.current !== null) {
                if (outputFlushIsTimeoutRef.current) {
                    clearTimeout(outputFlushRafIdRef.current);
                } else {
                    window.cancelAnimationFrame(outputFlushRafIdRef.current);
                }
                outputFlushRafIdRef.current = null;
                outputFlushIsTimeoutRef.current = false;
            }
            outputQueueRef.current = [];
            outputQueueBytesRef.current = 0;
            if (webglAddonRef.current) {
                try {
                    webglAddonRef.current.dispose();
                } catch { /* ignore */ }
                webglAddonRef.current = null;
            }
            try {
                term.dispose();
            } catch { /* ignore */ }
        };
    }, [retryKey, connectionSignature, clearPendingFit, connect]);

    useEffect(() => {
        if (xtermRef.current) {
            xtermRef.current.options.theme = getXtermTheme(theme);
            xtermRef.current.options.fontFamily = "'" + terminalFontName + "', 'JetBrains Mono', monospace";
            xtermRef.current.options.fontSize = terminalFontSize;
            xtermRef.current.options.lineHeight = 1;
            xtermRef.current.options.letterSpacing = 0;
            xtermRef.current.options.scrollSensitivity = terminalScrollSensitivity;
            safeFit();
        }
    }, [theme, terminalFontName, terminalFontSize, terminalScrollSensitivity, safeFit]);

    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | undefined;
        const sLower = status.toLowerCase();
        const isErrorStatus = sLower.includes('ошибка') || sLower.includes('тайм-аут') || sLower.includes('error') || sLower.includes('failed') || sLower.includes('timeout');
        const shouldRetry = (status === t('terminal.closed') || isErrorStatus) && wasConnectedRef.current && !isAuthFailed;

        if (shouldRetry) {
            Promise.resolve().then(() => setCountdown(5));
            timer = setInterval(() => {
                setCountdown(prev => {
                    if (prev === null) return null;
                    if (prev <= 1) {
                        clearInterval(timer);
                        setRetryKey(k => k + 1);
                        return null;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [status, isAuthFailed, t]);

    useEffect(() => {
        if (visible) {
            if (xtermRef.current && !webglAddonRef.current) {
                try {
                    const webglAddon = new WebglAddon();
                    webglAddon.onContextLoss(() => {
                        webglAddon.dispose();
                        webglAddonRef.current = null;
                    });
                    xtermRef.current.loadAddon(webglAddon);
                    webglAddonRef.current = webglAddon;
                } catch (e) {
                    console.warn('WebGL addon could not be loaded on tab focus', e);
                }
            }
            if (isMountedRef.current) {
                safeFit();
                setTimeout(() => {
                    if (isMountedRef.current && xtermRef.current) {
                        xtermRef.current.focus();
                    }
                }, 50);
            }
        } else {
            if (webglAddonRef.current) {
                try {
                    webglAddonRef.current.dispose();
                } catch { /* ignore */ }
                webglAddonRef.current = null;
            }
        }
    }, [visible, safeFit]);

    const handleContextMenu = (e: MouseEvent) => {
        if (!enableContextMenu || !xtermRef.current) return;
        e.preventDefault();

        const term = xtermRef.current;
        const selection = term.getSelection();

        if (selection) {
            void navigator.clipboard.writeText(selection);
            term.clearSelection();
        } else {
            navigator.clipboard.readText().then(text => {
                if (text && isMountedRef.current) {
                    term.paste(text);
                }
            });
        }
    };

    useEffect(() => {
        const handleForceCtrlR = () => {
            if (visible && connIdRef.current && (status === t('terminal.connected'))) {
                ipcRenderer?.sshInput?.({ id: connIdRef.current, data: '\x12' });
            }
        };

        window.addEventListener('terminal-force-ctrl-r', handleForceCtrlR);
        return () => window.removeEventListener('terminal-force-ctrl-r', handleForceCtrlR);
    }, [visible, status, t]);

    useEffect(() => {
        if ((status === t('terminal.connected')) && hasReceivedData && isReady) {
            const timer = setTimeout(() => {
                if (isMountedRef.current) {
                    setShowTerminal(true);
                    setTimeout(() => safeFit(0), 10);
                    setTimeout(() => safeFit(0), 100);
                    setTimeout(safeFit, 400);
                }
            }, 300);
            return () => clearTimeout(timer);
        } else {
            Promise.resolve().then(() => {
                if (isMountedRef.current) setShowTerminal(false);
            });
        }
    }, [status, hasReceivedData, isReady, safeFit, t]);

    return (
        <div className="terminal-layout" style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            overflow: 'hidden'
        }}>
        <div className="terminal-container"
            onContextMenu={handleContextMenu}
            style={{
            flex: 1,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            paddingLeft: '15px',
            paddingTop: '10px',
            paddingBottom: '15px',
            boxSizing: 'border-box',
            backgroundColor: getXtermTheme(theme).background,
            overflow: 'hidden',
            minWidth: 0
        }}>
            {isWaiting && (
                <div className={`connection-overlay ${!isFailed ? 'loading' : 'failed'}`} style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: getXtermTheme(theme).background,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    zIndex: 10, padding: '40px', textAlign: 'center',
                    transition: 'opacity 0.3s ease, visibility 0.3s'
                }}>
                    {/* Пока открыто окно ввода логина или пароля, остаётся только фон */}
                    {!loginPrompt && !authChallenge && (
                    <div className="connection-container" style={{ gap: '40px', padding: '48px', maxWidth: '550px', width: '95%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '20px' }}>
                            {/* Иконка ОС слева, название и адрес справа (как в окне удаления сервера) */}
                            <div className="server-info-card" style={{ display: 'flex', alignItems: 'center', gap: '16px', border: 'none', background: 'transparent', padding: 0, textAlign: 'left' }}>
                                <div className="os-icon-wrapper" style={{ width: '48px', height: '48px', padding: '0', flexShrink: 0, background: 'transparent' }}>
                                    <img src={getOSIcon(config.osPrettyName)} alt="OS" style={{ width: '100%', height: '100%', objectFit: 'contain' }} draggable="false" />
                                </div>
                                <div className="server-details" style={{ textAlign: 'left' }}>
                                    <div className="server-name" style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)' }}>{config.name || config.host}</div>
                                    <div className="server-address" style={{ fontSize: '14px', opacity: 0.7, color: 'var(--text-secondary)' }}>SSH {config.host}:{config.port}</div>
                                </div>
                            </div>

                        </div>

                        {!isFailed ? (
                            <>
                                <div className="connection-path" style={{ position: 'relative', width: '100%', padding: '0 20px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{
                                        width: '44px',
                                        height: '44px',
                                        borderRadius: '50%',
                                        background: 'var(--accent)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: '#fff',
                                        zIndex: 2,
                                        position: 'relative'
                                    }}>
                                        <div className="loader-ring" style={{
                                            position: 'absolute',
                                            top: '-6px', left: '-6px', right: '-6px', bottom: '-6px',
                                            border: '4px solid var(--accent)',
                                            borderRadius: '50%',
                                            borderTopColor: 'transparent',
                                            animation: 'spin 1.5s linear infinite',
                                            opacity: isConnected ? 0 : 1,
                                            transition: 'opacity 0.3s ease'
                                        }} />
                                        <Plug size={24} />
                                    </div>

                                    <div className="path-line" style={{ flex: 1, height: '2px', background: isConnected ? 'var(--accent)' : 'var(--border)', margin: '0 -2px', transition: 'background 0.5s ease' }} />

                                    <div style={{
                                        width: '44px',
                                        height: '44px',
                                        borderRadius: '50%',
                                        background: isConnected ? 'var(--accent)' : 'var(--hover-surface)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: isConnected ? '#fff' : 'var(--text-secondary)',
                                        zIndex: 2,
                                        border: isConnected ? 'none' : '1px solid var(--border)',
                                        transition: 'all 0.5s ease'
                                    }}>
                                        <IconTerminal size={22} />
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--accent)', fontWeight: 600, fontSize: '16px', marginTop: '10px' }}>
                                    <Loader2 size={20} className="spin" />
                                    {displayStatus}
                                </div>

                                <div className="connection-actions" style={{ width: '100%', display: 'flex', justifyContent: 'flex-start', marginTop: '10px' }}>
                                    {onClose && (
                                        <button
                                            onClick={onClose}
                                            className="btn-secondary"
                                            style={{ padding: '12px 32px', fontSize: '15px' }}
                                        >
                                            {t('common.close')}
                                        </button>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '24px',
                                width: '100%'
                            }}>
                                <div style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '12px',
                                    background: isAuthFailed ? 'rgba(239, 68, 68, 0.1)' : (isClosed ? 'rgba(255, 255, 255, 0.05)' : 'rgba(239, 68, 68, 0.1)'),
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: isAuthFailed ? '#ef4444' : (isClosed ? 'var(--text-primary)' : '#ef4444'),
                                    fontSize: '24px'
                                }}>{isAuthFailed ? '🔒' : (isClosed ? '🔌' : '⚠️')}</div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                                        {getDisplayStatus(status)}
                                    </div>
                                    {countdown !== null && !isAuthFailed && (
                                        <div style={{ fontSize: '14px', opacity: 0.7, fontWeight: 500 }}>
                                            {t('terminal.reconnectIn', { n: countdown.toString() })}
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', width: '100%' }}>
                                    {onClose && (
                                        <button
                                            onClick={onClose}
                                            className="btn-secondary"
                                            style={{ padding: '12px 28px', fontSize: '14px' }}
                                        >
                                            {t('common.close')}
                                        </button>
                                    )}
                                    {onEditConfig && (
                                        <button
                                            onClick={() => onEditConfig(config)}
                                            className="btn-secondary"
                                            style={{ padding: '12px 28px', fontSize: '14px' }}
                                        >
                                            {t('common.edit')}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => {
                                            setCountdown(null);
                                            setRetryKey(prev => prev + 1);
                                        }}
                                        className="btn-primary"
                                        style={{ padding: '12px 28px', fontSize: '14px' }}
                                    >
                                        {isClosed ? t('terminal.reconnect') : t('common.connect')}
                                    </button>
                                </div>
                            </div>
                        )}

                    </div>
                    )}
                </div>
            )}
            <div ref={termRef} key={retryKey}
                style={{
                    flex: 1,
                    minHeight: 0,
                    // До подключения терминал скрыт: иначе в пустом терминале
                    // мигает каретка, а во время ввода логина/пароля — тем более.
                    // Без перехода: приветствие сервера должно появляться сразу,
                    // а не проявляться (фон оверлея и терминала одинаковый)
                    opacity: isReady && showTerminal ? 1 : 0
                }} />
        </div>
        {loginPrompt && (
            <LoginPromptModal
                server={config}
                willSave={!!config.id}
                appConfig={appConfig}
                onSubmit={handleLoginSubmit}
                onCancel={handleLoginCancel}
            />
        )}
        {authChallenge && (
            <SshAuthModal
                key={`${authChallenge.kind}-${authChallenge.attempt}`}
                challenge={authChallenge}
                server={config}
                willSave={!!config.id}
                isSubmitting={isAuthSubmitting}
                error={authError}
                appConfig={appConfig}
                onSubmitSecret={handleAuthSecretSubmit}
                onSubmitKey={handleAuthKeySubmit}
                onCancel={handleAuthCancel}
            />
        )}
        </div>
    );
};

export const TerminalComponent = React.memo(TerminalComponentBase, (prevProps, nextProps) => {
    // If visibility is false for both, skip re-render unless visible state changed or core identity changed
    if (!prevProps.visible && !nextProps.visible) {
        return (
            prevProps.id === nextProps.id &&
            prevProps.theme === nextProps.theme &&
            prevProps.terminalFontName === nextProps.terminalFontName &&
            prevProps.terminalFontSize === nextProps.terminalFontSize &&
            prevProps.terminalScrollSensitivity === nextProps.terminalScrollSensitivity &&
            prevProps.keywordHighlighting === nextProps.keywordHighlighting &&
            prevProps.config === nextProps.config &&
            prevProps.appConfig?.language === nextProps.appConfig?.language
        );
    }

    return (
        prevProps.id === nextProps.id &&
        prevProps.visible === nextProps.visible &&
        prevProps.theme === nextProps.theme &&
        prevProps.terminalFontName === nextProps.terminalFontName &&
        prevProps.terminalFontSize === nextProps.terminalFontSize &&
        prevProps.terminalScrollSensitivity === nextProps.terminalScrollSensitivity &&
        prevProps.keywordHighlighting === nextProps.keywordHighlighting &&
        prevProps.enableContextMenu === nextProps.enableContextMenu &&
        prevProps.config === nextProps.config &&
        prevProps.appConfig?.language === nextProps.appConfig?.language
    );
});
