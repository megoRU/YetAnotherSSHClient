<script module lang="ts">
    import { Terminal } from '@xterm/xterm';

    import { FitAddon } from '@xterm/addon-fit';

    import { ClipboardAddon } from '@xterm/addon-clipboard';

    import { WebLinksAddon } from '@xterm/addon-web-links';

    import { WebglAddon } from '@xterm/addon-webgl';

    import { LoaderCircle, Plug, Terminal as IconTerminal } from '@lucide/svelte';

    import { getXtermTheme } from '../utils/theme';

    import { getOSIcon } from '../utils';

    import { ensureTerminalFont } from '../utils/fontLoader';

    import { createI18n } from '../utils/i18n';

    import { useTerminalFit } from '../hooks/useTerminalFit.svelte';

    import { createTerminalKeyHandler } from '../utils/terminalKeys';

    import { createInputQueue } from '../utils/inputQueue';

    import { copyToClipboard, createTerminalClipboardProvider, readClipboardText } from '../utils/clipboard';

    import LoginPromptModal from './modals/LoginPromptModal.svelte';

    import SshAuthModal from './modals/SshAuthModal.svelte';

    import SshFingerprintModal from './modals/SshFingerprintModal.svelte';

    import TerminalLinkTooltip from './TerminalLinkTooltip.svelte';
    import type { TerminalLinkTooltipPosition } from './TerminalLinkTooltip.svelte';

    import {
        isLoginRequiredStatus,
        type SessionCredentials,
        type SshAuthChallenge,
        type SshFingerprintChallenge,
    } from '../ipc';

    import type { AppConfig, EncryptedSecret, SSHConfig, SshErrorEvent, SshStatusEvent } from '../types';

    import '@xterm/xterm/css/xterm.css';

    import { onMount, untrack } from 'svelte';

    import { type RefObject, type SetStateAction, inlineStyle } from '../utils/dom';

    const { ipcRenderer } = window;

    interface Props {
        theme: string;
        config: SSHConfig;
        terminalFontName: string;
        terminalFontSize: number;
        terminalScrollSensitivity: number;
        terminalScrollback: number;
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

    const IPV6_REGEX =
        /(?<![0-9A-Fa-f:])((?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|:(?::[0-9A-Fa-f]{1,4}){1,7}|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4})(?![0-9A-Fa-f:])/g;

    const IP_HIGHLIGHT_SOURCE = `${IPV4_REGEX.source}|${IPV6_REGEX.source}`;

    const IP_HIGHLIGHT_REGEX = new RegExp(IP_HIGHLIGHT_SOURCE, 'g');

    const KEYWORD_COLORS: Record<string, string> = {
        ERROR: '\x1b[38;2;239;68;68m',
        WARNING: '\x1b[38;2;251;191;36m',
        WARN: '\x1b[38;2;251;191;36m',
        OK: '\x1b[38;2;74;222;128m',
        INFO: '\x1b[38;2;96;165;250m',
        DEBUG: '\x1b[38;2;192;132;252m',
    };

    const KEYWORD_CANDIDATE_REGEX = /\b(?:ERROR|WARNING|WARN|OK|INFO|DEBUG)\b/i;

    const IP_AND_KEYWORD_HIGHLIGHT_REGEX = new RegExp(
        `${IP_HIGHLIGHT_SOURCE}|\\b(?:ERROR|WARNING|WARN|OK|INFO|DEBUG)\\b`,
        'gi',
    );

    const OUTPUT_WRITE_CHUNK_SIZE = 16 * 1024;
</script>

<script lang="ts">
    let {
        theme,
        config,
        terminalFontName,
        terminalFontSize,
        terminalScrollSensitivity,
        terminalScrollback,
        visible,
        keywordHighlighting,
        onOSInfo,
        onCredentialsEntered,
        onPrivateKeyEntered,
        enableContextMenu,
        onEditConfig,
        onClose,
        appConfig,
        onAlternateScreenChange,
    }: Props = $props();

    const { t } = $derived(createI18n(appConfig?.language || 'ru'));

    const tRef = {
        get current() {
            return t;
        },
    };

    const keywordHighlightingRef = {
        get current() {
            return keywordHighlighting;
        },
    };

    const configRef = {
        get current() {
            return config;
        },
    };

    const themeRef = {
        get current() {
            return theme;
        },
    };

    const terminalFontNameRef = {
        get current() {
            return terminalFontName;
        },
    };

    const terminalFontSizeRef = {
        get current() {
            return terminalFontSize;
        },
    };

    const terminalScrollSensitivityRef = {
        get current() {
            return terminalScrollSensitivity;
        },
    };

    const terminalScrollbackRef = {
        get current() {
            return terminalScrollback;
        },
    };

    const termRef: RefObject<HTMLDivElement | null> = $state({ current: null });

    const xtermRef: RefObject<Terminal | null> = { current: null };

    const fitAddonRef: RefObject<FitAddon | null> = { current: null };

    const webglAddonRef: RefObject<WebglAddon | null> = { current: null };

    const connIdRef: RefObject<string | null> = { current: null };

    const lastColsRef: RefObject<number> = { current: 0 };

    const lastRowsRef: RefObject<number> = { current: 0 };

    const hasReceivedDataRef: RefObject<boolean> = { current: false };

    let status = $state.raw<string>(untrack(() => t('terminal.connecting')));

    let statusKind = $state.raw<SshStatusEvent['kind'] | null>(null);

    let errorKind = $state.raw<SshErrorEvent['kind'] | null>(null);

    let retryKey = $state.raw<number>(0);
    function setRetryKey(next: SetStateAction<number>) {
        retryKey = typeof next === 'function' ? next(retryKey) : next;
    }

    let isReady = $state.raw(false);

    let hasReceivedData = $state.raw(false);

    let showTerminal = $state.raw(false);

    let linkTooltipPosition = $state.raw<TerminalLinkTooltipPosition | null>(null);

    const isMountedRef: RefObject<boolean> = { current: true };

    const wasConnectedRef: RefObject<boolean> = { current: false };

    let countdown = $state.raw<number | null>(null);
    function setCountdown(next: SetStateAction<number | null>) {
        countdown = typeof next === 'function' ? next(countdown) : next;
    }

    const sessionCredentialsRef: RefObject<SessionCredentials> = { current: {} };

    const sessionPrivateKeyRef: RefObject<EncryptedSecret | undefined> = { current: undefined };

    const pendingSaveRef: RefObject<SessionCredentials | null> = { current: null };

    let loginPrompt = $state.raw(false);

    let authChallenge = $state.raw<SshAuthChallenge | null>(null);
    function setAuthChallenge(next: SetStateAction<SshAuthChallenge | null>) {
        authChallenge = typeof next === 'function' ? next(authChallenge) : next;
    }

    let fingerprintChallenge = $state.raw<SshFingerprintChallenge | null>(null);
    function setFingerprintChallenge(next: SetStateAction<SshFingerprintChallenge | null>) {
        fingerprintChallenge = typeof next === 'function' ? next(fingerprintChallenge) : next;
    }

    let fingerprintError = $state.raw<string | null>(null);

    let isAuthSubmitting = $state.raw(false);

    let authError = $state.raw<string | null>(null);

    const outputDecoderRef: RefObject<TextDecoder> = { current: new TextDecoder('utf-8') };

    const outputFlushRafIdRef: RefObject<number | null> = { current: null };

    const outputFlushIsTimeoutRef: RefObject<boolean> = { current: false };

    const outputHandlerRef: RefObject<((data: Uint8Array) => void) | null> = { current: null };

    const isWaiting = $derived(!showTerminal);

    const isAuthFailed = $derived(errorKind === 'auth-failure');

    const isClosed = $derived(statusKind === 'closed');

    const isConnected = $derived(statusKind === 'connected');

    const isFailed = $derived(errorKind !== null || isClosed);

    const getDisplayStatus = (s: string) => {
        if (isAuthFailed) return t('terminal.authFailed');
        if (statusKind === 'connected') return t('terminal.connected');
        if (statusKind === 'closed') return t('terminal.closed');
        if (statusKind === 'auth-cancelled') return t('terminal.authCancelled');
        if (statusKind === null && errorKind === null) return t('terminal.connecting');
        return s;
    };

    const displayStatus = $derived(getDisplayStatus(status));

    const onOSInfoRef = {
        get current() {
            return onOSInfo;
        },
    };

    const onCredentialsEnteredRef = {
        get current() {
            return onCredentialsEntered;
        },
    };

    const onPrivateKeyEnteredRef = {
        get current() {
            return onPrivateKeyEntered;
        },
    };

    const onCloseRef = {
        get current() {
            return onClose;
        },
    };

    const onAlternateScreenChangeRef = {
        get current() {
            return onAlternateScreenChange;
        },
    };

    const visibleRef = {
        get current() {
            return visible;
        },
    };

    const terminalFit = useTerminalFit({
        get visible() {
            return !!visible;
        },
        get isMountedRef() {
            return isMountedRef;
        },
        get xtermRef() {
            return xtermRef;
        },
        get fitAddonRef() {
            return fitAddonRef;
        },
        get termRef() {
            return termRef;
        },
        get lastColsRef() {
            return lastColsRef;
        },
        get lastRowsRef() {
            return lastRowsRef;
        },
        get canResize() {
            return () => !!connIdRef.current;
        },
        get onResize() {
            return (cols: number, rows: number) => {
                const connId = connIdRef.current;
                if (connId) ipcRenderer?.sshResize?.({ id: connId, cols, rows });
            };
        },
        get logPrefix() {
            return '[Terminal]';
        },
    });

    const safeFitRef = { current: terminalFit.safeFit };

    $effect(() => {
        void [terminalFit.safeFit];
        return untrack(() => {
            safeFitRef.current = terminalFit.safeFit;
        });
    });

    onMount(() =>
        ipcRenderer?.onMcpTerminalRead?.((request) => {
            const term = xtermRef.current;
            if (!term || request.terminalId !== connIdRef.current) return;
            // Снимок следует за выводом, уже поставленным в очередь xterm.
            term.write('', () => {
                if (xtermRef.current !== term) return;
                const buffer = request.mode === 'history' ? term.buffer.normal : term.buffer.active;
                const end =
                    request.mode === 'history' ? buffer.length : Math.min(buffer.length, buffer.baseY + term.rows);
                const start = request.mode === 'history' ? Math.max(0, end - request.maxLines) : buffer.baseY;
                const lines: string[] = [];
                let length = 0;
                let truncated = request.mode === 'history' && start > 0;
                // Ограничиваем ответ, сохраняя последние строки истории.
                for (let row = end - 1; row >= start; row--) {
                    const line = buffer.getLine(row)?.translateToString(true) ?? '';
                    if (length + line.length + 1 > 256 * 1024) {
                        truncated = true;
                        break;
                    }
                    lines.push(line);
                    length += line.length + 1;
                }
                void ipcRenderer
                    ?.mcpTerminalSnapshot?.(request.requestId, request.terminalId, {
                        text: lines.reverse().join('\n'),
                        cols: term.cols,
                        rows: term.rows,
                        truncated,
                    })
                    .catch((error: Error) => console.error('[Terminal] MCP snapshot failed', error));
            });
        }),
    );

    const connect = (connId: string, cols?: number, rows?: number) => {
        if (!xtermRef.current) return;
        status = tRef.current('terminal.connecting');
        statusKind = null;
        errorKind = null;
        hasReceivedDataRef.current = false;
        hasReceivedData = false;
        isAuthSubmitting = false;
        // Новое подключение: несохранённые данные предыдущей попытки больше не актуальны
        pendingSaveRef.current = null;
        const finalCols = cols || xtermRef.current.cols || 80;
        const finalRows = rows || xtermRef.current.rows || 24;
        const sessionCredentials = sessionCredentialsRef.current;
        const sessionKey = sessionPrivateKeyRef.current;
        const connectConfig: SSHConfig = {
            ...configRef.current,
            ...(sessionCredentials.user ? { user: sessionCredentials.user } : {}),
            ...(sessionCredentials.password ? { password: sessionCredentials.password } : {}),
            ...(sessionCredentials.keyPassphrase ? { keyPassphrase: sessionCredentials.keyPassphrase } : {}),
            ...(sessionKey ? { authType: 'key' as const, privateKey: sessionKey } : {}),
        };
        const onOutput = outputHandlerRef.current;
        if (!onOutput) {
            const message = tRef.current('terminal.outputChannelMissing');
            console.error(`[Terminal] ${message}`);
            errorKind = 'ssh-error';
            status = `${tRef.current('common.error')}: ${message}`;
            return;
        }
        ipcRenderer?.sshConnect?.(
            { id: connId, config: connectConfig, cols: finalCols, rows: finalRows },
            onOutput,
        );
    };

    const handleLoginSubmit = (user: string) => {
        sessionCredentialsRef.current = { ...sessionCredentialsRef.current, user };
        loginPrompt = false;
        const connId = connIdRef.current;
        if (!connId) return;
        connect(connId, xtermRef.current?.cols, xtermRef.current?.rows);
        // `connect` сбрасывает данные предыдущей попытки, поэтому фиксируем
        // логин после его вызова. Он сохранится вместе с паролем только после
        // успешной авторизации.
        pendingSaveRef.current = { user };
    };

    const handleLoginCancel = () => {
        loginPrompt = false;
        // Отказ от ввода логина закрывает вкладку целиком
        onCloseRef.current?.();
    };

    const handleAuthSecretSubmit = (secret: string) => {
        const connId = connIdRef.current;
        if (!connId || !authChallenge) return;

        const isPassphrase = authChallenge.kind === 'passphrase';
        sessionCredentialsRef.current = isPassphrase
            ? { ...sessionCredentialsRef.current, keyPassphrase: secret }
            : { ...sessionCredentialsRef.current, password: secret };
        // Введённые данные сохраняются только после успешного подключения (см. onStatus):
        // неверный пароль или парольная фраза в конфиг попадать не должны. Если сервер
        // запросил именно пароль при ключевом методе — значит, ключ не подошёл, и после
        // успеха сервер переводится на парольную авторизацию.
        pendingSaveRef.current = {
            ...pendingSaveRef.current,
            ...(isPassphrase ? { keyPassphrase: secret } : { password: secret, replaceKeyAuth: true }),
        };

        isAuthSubmitting = true;
        statusKind = null;
        errorKind = null;
        status = tRef.current('terminal.connecting');
        ipcRenderer?.sshAuthResponse?.({
            id: connId,
            response: 'secret',
            kind: authChallenge.kind,
            secret,
        });
    };

    const handleAuthKeySubmit = async (keyContent: string) => {
        const connId = connIdRef.current;
        if (!connId || !authChallenge || isAuthSubmitting) return;

        isAuthSubmitting = true;
        try {
            const privateKey = await ipcRenderer?.encryptPrivateKey?.(keyContent);
            if (!privateKey) throw new Error(tRef.current('errors.privateKeyEncryptFailed'));
            sessionPrivateKeyRef.current = privateKey;
            // Логин сохраняем: подключение пойдёт ключом, но пользователь нужен серверу
            sessionCredentialsRef.current = { user: sessionCredentialsRef.current.user };
            // Ключ сохраняется для этого сервера и используется вместо пароля
            onPrivateKeyEnteredRef.current?.(configRef.current, privateKey);
            statusKind = null;
            errorKind = null;
            status = tRef.current('terminal.connecting');
            ipcRenderer?.sshAuthResponse?.({ id: connId, response: 'privateKey', privateKey });
        } catch (err) {
            console.error('[Terminal] Failed to apply private key:', err);
            isAuthSubmitting = false;
            authError = tRef.current('errors.privateKeyEncryptFailed');
        }
    };

    const handleFingerprintAccept = async () => {
        const connId = connIdRef.current;
        if (!connId || isAuthSubmitting) return;

        fingerprintError = null;
        isAuthSubmitting = true;
        statusKind = null;
        errorKind = null;
        status = tRef.current('terminal.connecting');
        try {
            const accepted = await ipcRenderer?.sshFingerprintResponse?.({ id: connId, accept: true });
            if (isMountedRef.current && accepted) {
                // Решение уже принято main-процессом и повторное подключение
                // запущено. Закрываем запрос отпечатка сразу: ожидание
                // connected здесь может длиться дольше, чем само подтверждение.
                setFingerprintChallenge(null);
                isAuthSubmitting = false;
            } else if (isMountedRef.current) {
                isAuthSubmitting = false;
                fingerprintError = tRef.current('terminal.fingerprintResponseFailed');
            }
        } catch (error) {
            console.error('[Terminal] Failed to accept host fingerprint:', error);
            if (isMountedRef.current) {
                isAuthSubmitting = false;
                fingerprintError = tRef.current('terminal.fingerprintResponseFailed');
            }
        }
    };

    const handleFingerprintReject = () => {
        const connId = connIdRef.current;
        setFingerprintChallenge(null);
        isAuthSubmitting = false;
        if (connId) {
            ipcRenderer?.sshFingerprintResponse?.({ id: connId, accept: false });
        }
        onCloseRef.current?.();
    };

    const handleAuthCancel = () => {
        const connId = connIdRef.current;
        setAuthChallenge(null);
        isAuthSubmitting = false;
        if (connId) {
            // Сообщаем main, что ввод отменён: попытка авторизации прерывается
            ipcRenderer?.sshAuthResponse?.({ id: connId, response: 'cancel' });
        }
        // Отказ от ввода закрывает вкладку целиком
        onCloseRef.current?.();
    };

    const connectionSignature = $derived(
        JSON.stringify([
            config.id ?? '',
            config.host,
            config.port,
            config.user,
            config.authType,
            config.privateKeyPath ?? '',
            config.privateKey ?? '',
            config.password ?? '',
            config.keyPassphrase ?? '',
            config.initialCommands ?? '',
        ]),
    );

    $effect(() => {
        void [retryKey, connectionSignature, termRef.current];
        return untrack(() => {
            if (!termRef.current) return;
            let active = true;

            Promise.resolve().then(() => {
                if (active) isReady = false;
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
                scrollback: terminalScrollbackRef.current,
                scrollSensitivity: terminalScrollSensitivityRef.current,
            });

            const fitAddon = new FitAddon();
            const clipboardAddon = new ClipboardAddon(undefined, createTerminalClipboardProvider());
            const webLinksAddon = new WebLinksAddon(
                (event, url) => {
                    if (event.button !== 0 || !event.ctrlKey) return;
                    ipcRenderer?.openExternal?.(url);
                },
                {
                    hover: (event) => {
                        const container = termRef.current?.closest('.terminal-container');
                        if (!container) return;
                        const rect = container.getBoundingClientRect();
                        const y = event.clientY - rect.top;
                        linkTooltipPosition = {
                            left: Math.max(128, Math.min(rect.width - 128, event.clientX - rect.left)),
                            top: y,
                            placement: y < 72 ? 'below' : 'above',
                        };
                    },
                    leave: () => {
                        linkTooltipPosition = null;
                    },
                },
            );

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
                        fitAddon.fit();
                        const { cols, rows } = term;
                        isReady = true;
                        lastColsRef.current = cols;
                        lastRowsRef.current = rows;
                        connect(connId, cols, rows);
                        term.element?.classList.add('xterm-ready');
                    } catch (e) {
                        console.warn('[Terminal] Initial fit failed:', e);
                        connect(connId);
                        isReady = true;
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

            const sendInput = createInputQueue((data) => {
                ipcRenderer?.sshInput?.({ id: connId, data });
            });

            term.onData((data) => {
                sendInput(data);
            });

            const updateBufferType = () => {
                const isAlternate = term.buffer.active.type === 'alternate';
                if (visibleRef.current) {
                    onAlternateScreenChangeRef.current?.(isAlternate);
                }
            };

            const updateScrollbackVisibility = () => {
                const hasScrollback = term.buffer.active.type === 'normal' && term.buffer.active.baseY > 0;
                term.element?.classList.toggle('xterm-has-scrollback', hasScrollback);
            };

            const updateBufferState = () => {
                updateBufferType();
                updateScrollbackVisibility();
            };

            const bufferDisposable = term.buffer.onBufferChange(updateBufferState);
            const writeParsedDisposable = term.onWriteParsed(updateScrollbackVisibility);
            updateBufferState();

            term.attachCustomKeyEventHandler(
                createTerminalKeyHandler(term, {
                    isMounted: () => isMountedRef.current,
                    isMac: ipcRenderer?.platform === 'darwin',
                    // В альтернативном экране (vim, nvim, nano, htop, tmux) сочетания с Ctrl
                    // передаются терминалу
                    passCtrlInAlternateScreen: true,
                }),
            );

            // Each SSH connection owns its UTF-8 decoder state. Never carry an
            // incomplete multibyte sequence across retries/reconfigured sessions.
            outputDecoderRef.current = new TextDecoder('utf-8');
            let outputQueue: string[] = [];
            let outputQueueHead = 0;
            let queuedCharacters = 0;
            let writePending = false;

            const enqueueOutput = (text: string) => {
                if (!text) return;
                outputQueue.push(text);
                queuedCharacters += text.length;
            };

            const applyHighlighting = (text: string): string => {
                const hasAddressCandidate = text.includes('.') || text.includes(':');
                const hasKeywordCandidate = keywordHighlightingRef.current && KEYWORD_CANDIDATE_REGEX.test(text);
                if (!hasAddressCandidate && !hasKeywordCandidate) return text;

                const pattern = hasKeywordCandidate ? IP_AND_KEYWORD_HIGHLIGHT_REGEX : IP_HIGHLIGHT_REGEX;
                return text.replace(pattern, (match) => {
                    const color =
                        match.includes('.') || match.includes(':')
                            ? IP_COLOR
                            : KEYWORD_COLORS[match.toUpperCase()];
                    return color ? `${color}${match}${RESET}` : match;
                });
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

                if (!active || !isMountedRef.current || writePending || queuedCharacters === 0) {
                    return;
                }

                // xterm уступает главный поток только между write-порциями.
                // Ограничиваем также работу подсветки, не склеивая весь накопленный лог.
                const parts: string[] = [];
                let remaining = OUTPUT_WRITE_CHUNK_SIZE;
                while (remaining > 0 && outputQueueHead < outputQueue.length) {
                    const chunk = outputQueue[outputQueueHead];
                    const length = Math.min(remaining, chunk.length);
                    parts.push(chunk.slice(0, length));
                    if (length === chunk.length) {
                        outputQueue[outputQueueHead++] = '';
                    } else {
                        outputQueue[outputQueueHead] = chunk.slice(length);
                    }
                    queuedCharacters -= length;
                    remaining -= length;
                }
                if (outputQueueHead >= 256 || outputQueueHead === outputQueue.length) {
                    outputQueue = outputQueue.slice(outputQueueHead);
                    outputQueueHead = 0;
                }
                const joinedOutput = parts.join('');

                try {
                    writePending = true;
                    term.write(visibleRef.current ? applyHighlighting(joinedOutput) : joinedOutput, () => {
                        writePending = false;
                        // Продолжаем по готовности парсера, без ожидания нового кадра.
                        // Сам xterm распределяет эти небольшие порции по тактам.
                        flushOutputQueue();
                    });
                } catch (err) {
                    writePending = false;
                    console.warn('[Terminal] batched write failed:', err);
                }
            };

            const scheduleOutputFlush = () => {
                if (writePending || outputFlushRafIdRef.current !== null) {
                    return;
                }

                if (visibleRef.current) {
                    // Небольшие пакеты объединяем до кадра; накопленный вывод
                    // затем обрабатывается по готовности xterm.
                    outputFlushIsTimeoutRef.current = false;
                    outputFlushRafIdRef.current = window.requestAnimationFrame(flushOutputQueue);
                } else {
                    // In hidden tabs, batch output every 20ms to avoid unnecessary CPU load
                    outputFlushIsTimeoutRef.current = true;
                    outputFlushRafIdRef.current = window.setTimeout(() => {
                        flushOutputQueue();
                    }, 20);
                }
            };

            // Текущий приёмник вывода: его забирает `connect` для канала рендерера.
            outputHandlerRef.current = (data: Uint8Array) => {
                // `active` отсекает поздние чанки канала, доставленные после
                // пересоздания сессии: их писать некуда.
                if (!active || !isMountedRef.current) return;
                if (!hasReceivedDataRef.current) {
                    hasReceivedDataRef.current = true;
                    hasReceivedData = true;
                }
                try {
                    const text = outputDecoderRef.current.decode(data, { stream: true });
                    enqueueOutput(text);

                    // TextDecoder can hold an incomplete UTF-8 character between
                    // chunks. Don't schedule an empty write.
                    if (queuedCharacters === 0) {
                        return;
                    }

                    if (queuedCharacters >= OUTPUT_WRITE_CHUNK_SIZE) {
                        flushOutputQueue();
                        return;
                    }

                    // Small visible chunks share the scheduled frame write instead
                    // of triggering one xterm pass per SSH packet.
                    scheduleOutputFlush();
                } catch (err) {
                    console.warn('[Terminal] write failed:', err);
                }
            };

            const onStatus = (event: SshStatusEvent) => {
                if (!isMountedRef.current) return;
                // В конфигурации нет логина — показываем форму ввода вместо обычного статуса
                if (isLoginRequiredStatus(event)) {
                    console.log('[Terminal] Login required');
                    loginPrompt = true;
                    return;
                }
                statusKind = event.kind;
                errorKind = null;
                if (event.kind === 'closed') {
                    // Остаток вывода приходит до статуса: сбрасываем декодер,
                    // чтобы не потерять последний неполный UTF-8 символ.
                    const tail = outputDecoderRef.current.decode();
                    enqueueOutput(tail);
                    flushOutputQueue();
                }
                status =
                    event.message ??
                    (event.kind === 'connected'
                        ? tRef.current('terminal.connected')
                        : event.kind === 'closed'
                          ? tRef.current('terminal.closed')
                          : tRef.current('terminal.connecting'));
                if (event.kind === 'connected') {
                    loginPrompt = false;
                    setAuthChallenge(null);
                    setFingerprintChallenge(null);
                    isAuthSubmitting = false;
                    authError = null;
                    wasConnectedRef.current = true;
                    setCountdown(null);
                    // Введённые данные подтверждены сервером — сохраняем их для этого сервера
                    if (pendingSaveRef.current) {
                        onCredentialsEnteredRef.current?.(configRef.current, pendingSaveRef.current);
                        pendingSaveRef.current = null;
                    }
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

            const onError = (event: SshErrorEvent) => {
                if (isMountedRef.current) {
                    errorKind = event.kind;
                    statusKind = null;
                    if (event.kind === 'auth-failure') {
                        wasConnectedRef.current = false;
                        // Введённый в этой сессии пароль/парольная фраза не подошли — сбрасываем
                        // их, чтобы следующая попытка снова спросила данные у сервера. Логин оставляем.
                        sessionCredentialsRef.current = { user: sessionCredentialsRef.current.user };
                        // Неверные данные в конфиг не попадут
                        pendingSaveRef.current = null;
                    }
                    // Ошибка подключения закрывает окно ввода: дальше разбирается пользователь
                    setAuthChallenge(null);
                    setFingerprintChallenge(null);
                    isAuthSubmitting = false;
                    try {
                        const cleanError = event.message;
                        enqueueOutput(`\r\n\x1b[31m${tRef.current('common.error')}: ${cleanError}\x1b[0m\r\n`);
                        flushOutputQueue();
                    } catch {
                        /* ignore */
                    }
                    status = event.message;
                }
            };

            const onAuthChallenge = (challenge: SshAuthChallenge) => {
                if (!isMountedRef.current) return;
                console.log(`[Terminal] Auth challenge: ${challenge.kind} (attempt ${challenge.attempt})`);
                loginPrompt = false;
                authError = null;
                isAuthSubmitting = false;
                setAuthChallenge(challenge);
            };

            const onFingerprint = (challenge: SshFingerprintChallenge) => {
                if (!isMountedRef.current) return;
                console.log(
                    `[Terminal] Host fingerprint confirmation required${challenge.previous ? ' (key changed)' : ''}`,
                );
                loginPrompt = false;
                setAuthChallenge(null);
                authError = null;
                isAuthSubmitting = false;
                fingerprintError = null;
                setFingerprintChallenge(challenge);
            };

            const unsubStatus = ipcRenderer?.onSSHStatus?.(connId, onStatus);
            const unsubError = ipcRenderer?.onSSHError?.(connId, onError);
            const unsubAuth = ipcRenderer?.onSSHAuthChallenge?.(connId, (challenge: SshAuthChallenge) =>
                onAuthChallenge(challenge),
            );
            const unsubFingerprint = ipcRenderer?.onSSHFingerprint?.((challenge: SshFingerprintChallenge) => {
                // Событие общее на всё приложение: чужие подключения пропускаем.
                if (challenge.id !== connId) return;
                onFingerprint(challenge);
            });
            const unsubOSInfo = ipcRenderer?.onSSHOSInfo?.(connId, (info: string) => {
                if (isMountedRef.current && onOSInfoRef.current) onOSInfoRef.current(info);
            });

            return () => {
                active = false;
                isMountedRef.current = false;
                terminalFit.clearPendingFit();
                resizeObserver.disconnect();
                ipcRenderer?.sshClose?.(connId);
                outputHandlerRef.current = null;
                if (typeof unsubStatus === 'function') unsubStatus();
                if (typeof unsubError === 'function') unsubError();
                if (typeof unsubAuth === 'function') unsubAuth();
                if (typeof unsubFingerprint === 'function') unsubFingerprint();
                if (typeof unsubOSInfo === 'function') unsubOSInfo();
                bufferDisposable.dispose();
                writeParsedDisposable.dispose();
                onAlternateScreenChangeRef.current?.(false);
                cancelScheduledFlush();
                outputQueue = [];
                queuedCharacters = 0;
                if (webglAddonRef.current) {
                    try {
                        webglAddonRef.current.dispose();
                    } catch {
                        /* ignore */
                    }
                    webglAddonRef.current = null;
                }
                try {
                    term.dispose();
                } catch {
                    /* ignore */
                }
            };
        });
    });

    $effect(() => {
        void [
            theme,
            terminalFontName,
            terminalFontSize,
            terminalScrollSensitivity,
            terminalScrollback,
            terminalFit.safeFit,
        ];
        return untrack(() => {
            if (xtermRef.current) {
                xtermRef.current.options.theme = getXtermTheme(theme);
                xtermRef.current.options.fontFamily = "'" + terminalFontName + "', 'JetBrains Mono', monospace";
                xtermRef.current.options.fontSize = terminalFontSize;
                xtermRef.current.options.lineHeight = 1;
                xtermRef.current.options.letterSpacing = 0;
                xtermRef.current.options.scrollSensitivity = terminalScrollSensitivity;
                xtermRef.current.options.scrollback = terminalScrollback;
                terminalFit.safeFit();
            }
        });
    });

    $effect(() => {
        void [status, isAuthFailed, isClosed, errorKind];
        return untrack(() => {
            let timer: ReturnType<typeof setInterval> | undefined;
            const shouldRetry =
                (isClosed || (errorKind !== null && errorKind !== 'auth-failure')) &&
                wasConnectedRef.current &&
                !isAuthFailed;

            if (shouldRetry) {
                Promise.resolve().then(() => setCountdown(5));
                timer = setInterval(() => {
                    setCountdown((prev) => {
                        if (prev === null) return null;
                        if (prev <= 1) {
                            clearInterval(timer);
                            setRetryKey((k) => k + 1);
                            return null;
                        }
                        return prev - 1;
                    });
                }, 1000);
            }
            return () => clearInterval(timer);
        });
    });

    $effect(() => {
        void [visible, terminalFit.safeFit, loginPrompt, authChallenge, fingerprintChallenge];
        return untrack(() => {
            let focusTimeout: ReturnType<typeof setTimeout> | undefined;
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
                    terminalFit.safeFit();
                    if (!loginPrompt && !authChallenge && !fingerprintChallenge) {
                        focusTimeout = setTimeout(() => {
                            if (isMountedRef.current && xtermRef.current) {
                                xtermRef.current.focus();
                            }
                        }, 50);
                    }
                }
            } else {
                if (webglAddonRef.current) {
                    try {
                        webglAddonRef.current.dispose();
                    } catch {
                        /* ignore */
                    }
                    webglAddonRef.current = null;
                }
            }
            return () => {
                if (focusTimeout !== undefined) clearTimeout(focusTimeout);
            };
        });
    });

    const handleContextMenu = (e: MouseEvent) => {
        if (!enableContextMenu || !xtermRef.current) return;
        e.preventDefault();

        const term = xtermRef.current;
        const selection = term.getSelection();

        if (selection) {
            copyToClipboard(selection);
            term.clearSelection();
        } else {
            readClipboardText()
                .then((text) => {
                    if (text && isMountedRef.current) {
                        term.paste(text);
                    }
                })
                .catch(() => {
                    // Буфер недоступен — вставка невозможна.
                });
        }
    };

    $effect(() => {
        void [visible, isConnected];
        return untrack(() => {
            const handleForceCtrlR = () => {
                if (visible && connIdRef.current && isConnected) {
                    ipcRenderer?.sshInput?.({ id: connIdRef.current, data: '\x12' });
                }
            };

            window.addEventListener('terminal-force-ctrl-r', handleForceCtrlR);
            return () => window.removeEventListener('terminal-force-ctrl-r', handleForceCtrlR);
        });
    });

    $effect(() => {
        void [isConnected, hasReceivedData, isReady, terminalFit.safeFit];
        return untrack(() => {
            if (isConnected && hasReceivedData && isReady) {
                const timer = setTimeout(() => {
                    if (isMountedRef.current) {
                        showTerminal = true;
                        setTimeout(() => terminalFit.safeFit(0), 10);
                        setTimeout(() => terminalFit.safeFit(0), 100);
                        setTimeout(terminalFit.safeFit, 400);
                    }
                }, 300);
                return () => clearTimeout(timer);
            } else {
                Promise.resolve().then(() => {
                    if (isMountedRef.current) showTerminal = false;
                });
            }
        });
    });
</script>

<div class="terminal-layout" data-theme={theme} style="display: flex; width: 100%; height: 100%; overflow: hidden">
    <div
        role="presentation"
        class="terminal-container"
        oncontextmenu={handleContextMenu}
        style={inlineStyle({
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
            minWidth: 0,
        })}
    >
        {#if isWaiting}<div
                class={`connection-overlay ${!isFailed ? 'loading' : 'failed'}`}
                style={inlineStyle({
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: getXtermTheme(theme).background,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10,
                    padding: '40px',
                    textAlign: 'center',
                    transition: 'opacity 0.3s ease, visibility 0.3s',
                })}
            >
                <!-- Пока открыто окно ввода логина, пароля или подтверждения
                        ключа, остаётся только фон -->
                {#if !loginPrompt && !authChallenge && !fingerprintChallenge}<div
                        class="connection-container"
                        style="gap: 40px; padding: 48px; max-width: 550px; width: 95%"
                    >
                        <div
                            style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 20px"
                        >
                            <!-- Иконка ОС слева, название и адрес справа (как в окне удаления сервера) -->
                            <div
                                class="server-info-card"
                                style="display: flex; align-items: center; gap: 16px; border: none; background: transparent; padding: 0; text-align: left"
                            >
                                <div
                                    class="os-icon-wrapper"
                                    style="width: 48px; height: 48px; padding: 0; flex-shrink: 0; background: transparent"
                                >
                                    <img
                                        src={getOSIcon(config.osPrettyName)}
                                        alt="OS"
                                        style="width: 100%; height: 100%; object-fit: contain"
                                        draggable="false"
                                    />
                                </div>
                                <div class="server-details" style="text-align: left">
                                    <div
                                        class="server-name"
                                        style="font-size: var(--font-size-xl); font-weight: 600; color: var(--text-primary)"
                                    >
                                        {config.name || config.host}
                                    </div>
                                    <div class="server-address" style="font-size: var(--font-size-sm)">
                                        SSH {config.host}:{config.port}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {#if !isFailed}
                            <div
                                class="connection-path"
                                style="position: relative; width: 100%; padding: 0 20px; height: 60px; display: flex; align-items: center; justify-content: space-between"
                            >
                                <div
                                    style="width: 44px; height: 44px; border-radius: 50%; background: var(--accent); display: flex; align-items: center; justify-content: center; color: #fff; z-index: 2; position: relative"
                                >
                                    <div
                                        class="loader-ring"
                                        style={inlineStyle({
                                            position: 'absolute',
                                            top: '-6px',
                                            left: '-6px',
                                            right: '-6px',
                                            bottom: '-6px',
                                            border: '4px solid var(--accent)',
                                            borderRadius: '50%',
                                            borderTopColor: 'transparent',
                                            animation: 'spin 1.5s linear infinite',
                                            opacity: isConnected ? 0 : 1,
                                            transition: 'opacity 0.3s ease',
                                        })}
                                    ></div>
                                    <Plug size={24} />
                                </div>

                                <div
                                    class="path-line"
                                    style={inlineStyle({
                                        flex: 1,
                                        height: '2px',
                                        background: isConnected ? 'var(--accent)' : 'var(--border)',
                                        margin: '0 -2px',
                                        transition: 'background 0.5s ease',
                                    })}
                                ></div>

                                <div
                                    style={inlineStyle({
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
                                        transition: 'all 0.5s ease',
                                    })}
                                >
                                    <IconTerminal size={22} />
                                </div>
                            </div>

                            <div
                                style="display: flex; align-items: center; gap: 12px; color: var(--accent); font-weight: 600; font-size: calc(var(--font-size-base) + 2px); margin-top: 10px"
                            >
                                <LoaderCircle size={20} class="spin" />
                                {displayStatus}
                            </div>

                            <div
                                class="connection-actions"
                                style="width: 100%; display: flex; justify-content: flex-start; margin-top: 10px"
                            >
                                {#if onClose}<button
                                        onclick={onClose}
                                        class="btn-secondary"
                                        style="padding: 12px 32px; font-size: var(--font-size-base)"
                                    >
                                        {t('common.close')}
                                    </button>{/if}
                            </div>
                        {:else}<div
                                style="display: flex; flex-direction: column; align-items: center; gap: 24px; width: 100%"
                            >
                                <div
                                    style={inlineStyle({
                                        width: '48px',
                                        height: '48px',
                                        borderRadius: '12px',
                                        background:
                                            isClosed && !isAuthFailed
                                                ? 'var(--hover-surface)'
                                                : 'rgba(239, 68, 68, 0.1)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: isAuthFailed
                                            ? '#ef4444'
                                            : isClosed
                                              ? 'var(--text-primary)'
                                              : '#ef4444',
                                        fontSize: '24px',
                                    })}
                                >
                                    {#if isAuthFailed}🔒{:else if isClosed}🔌{:else}⚠️{/if}
                                </div>

                                <div style="display: flex; flex-direction: column; gap: 8px; text-align: center">
                                    <div
                                        style="font-size: var(--font-size-lg); font-weight: bold; color: var(--text-primary)"
                                    >
                                        {getDisplayStatus(status)}
                                    </div>
                                    {#if countdown !== null && !isAuthFailed}<div
                                            style="font-size: calc(var(--ui-font-size-base) + 1px); opacity: 0.7; font-weight: 500"
                                        >
                                            {t('terminal.reconnectIn', { n: countdown.toString() })}
                                        </div>{/if}
                                </div>

                                <div style="display: flex; justify-content: center; gap: 12px; width: 100%">
                                    {#if onClose}<button
                                            onclick={onClose}
                                            class="btn-secondary"
                                            style="padding: 12px 28px; font-size: var(--ui-font-size-base)"
                                        >
                                            {t('common.close')}
                                        </button>{/if}
                                    {#if onEditConfig}<button
                                            onclick={() => onEditConfig(config)}
                                            class="btn-secondary"
                                            style="padding: 12px 28px; font-size: var(--ui-font-size-base)"
                                        >
                                            {t('common.edit')}
                                        </button>{/if}
                                    <button
                                        onclick={() => {
                                            setCountdown(null);
                                            setRetryKey((prev) => prev + 1);
                                        }}
                                        class="btn-primary"
                                        style="padding: 12px 28px; font-size: var(--ui-font-size-base)"
                                    >
                                        {#if isClosed}{t('terminal.reconnect')}{:else}{t('common.connect')}{/if}
                                    </button>
                                </div>
                            </div>{/if}
                    </div>{/if}
            </div>{/if}
        {#key retryKey}<div
                bind:this={termRef.current}
                style={inlineStyle({
                    flex: 1,
                    minHeight: 0,
                    // До подключения терминал скрыт: иначе в пустом терминале
                    // мигает каретка, а во время ввода логина/пароля — тем более.
                    // Без перехода: приветствие сервера должно появляться сразу,
                    // а не проявляться (фон оверлея и терминала одинаковый)
                    opacity: isReady && showTerminal ? 1 : 0,
                })}
            ></div>{/key}
        {#if linkTooltipPosition}<TerminalLinkTooltip
                position={linkTooltipPosition}
                clickLabel={t('terminal.linkClick')}
                hint={t('terminal.linkOpenHint')}
            />{/if}
    </div>
    {#if loginPrompt && !authChallenge && !fingerprintChallenge}<LoginPromptModal
            server={config}
            willSave={!!config.id}
            {appConfig}
            onSubmit={handleLoginSubmit}
            onCancel={handleLoginCancel}
        />{/if}
    {#if authChallenge && !fingerprintChallenge}{#key `${authChallenge.kind}-${authChallenge.attempt}`}<SshAuthModal
                challenge={authChallenge}
                server={config}
                willSave={!!config.id}
                isSubmitting={isAuthSubmitting}
                error={authError}
                {appConfig}
                onSubmitSecret={handleAuthSecretSubmit}
                onSubmitKey={handleAuthKeySubmit}
                onCancel={handleAuthCancel}
            />{/key}{/if}
    {#if fingerprintChallenge}{#key fingerprintChallenge.fingerprint}<SshFingerprintModal
                challenge={fingerprintChallenge}
                server={config}
                isSubmitting={isAuthSubmitting}
                error={fingerprintError}
                {appConfig}
                onAccept={handleFingerprintAccept}
                onReject={handleFingerprintReject}
            />{/key}{/if}
</div>
