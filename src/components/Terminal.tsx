import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as IconTerminal, Plug, Loader2 } from 'lucide-react';
import { AIChatPanel } from './ai/AIChatPanel';
import { getXtermTheme } from '../utils/theme';
import { getOSIcon } from '../utils';
import { useI18n } from '../utils/i18n';
import type { SSHConfig, AppConfig, ChatMessage } from '../types';
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
    enableContextMenu?: boolean;
    onEditConfig?: (config: SSHConfig) => void;
    onClose?: () => void;
    appConfig?: AppConfig;
    aiOpen?: boolean;
    aiMessages?: ChatMessage[];
    onToggleAi?: () => void;
    onAiMessagesChange?: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
    aiFocusTrigger?: number;
}

export const TerminalComponent: React.FC<Props> = ({
    theme,
    config,
    terminalFontName,
    terminalFontSize,
    terminalScrollSensitivity,
    visible,
    keywordHighlighting,
    onOSInfo,
    enableContextMenu,
    onEditConfig,
    onClose,
    appConfig,
    aiOpen,
    aiMessages = [],
    onToggleAi,
    onAiMessagesChange,
    aiFocusTrigger
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

    const themeRef = useRef(theme);
    const terminalFontNameRef = useRef(terminalFontName);
    const terminalFontSizeRef = useRef(terminalFontSize);
    const terminalScrollSensitivityRef = useRef(terminalScrollSensitivity);
    useEffect(() => { themeRef.current = theme; }, [theme]);
    useEffect(() => { terminalFontNameRef.current = terminalFontName; }, [terminalFontName]);
    useEffect(() => { terminalFontSizeRef.current = terminalFontSize; }, [terminalFontSize]);
    useEffect(() => { terminalScrollSensitivityRef.current = terminalScrollSensitivity; }, [terminalScrollSensitivity]);

    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const safeFitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const connIdRef = useRef<string | null>(null);
    const [status, setStatus] = useState<string>(t('terminal.connecting'));
    const [retryKey, setRetryKey] = useState<number>(0);
    const [isReady, setIsReady] = useState(false);
    const [hasReceivedData, setHasReceivedData] = useState(false);
    const [showTerminal, setShowTerminal] = useState(false);
    const isMountedRef = useRef<boolean>(true);
    const wasConnectedRef = useRef<boolean>(false);
    const [countdown, setCountdown] = useState<number | null>(null);
    const outputDecoderRef = useRef<TextDecoder>(new TextDecoder('utf-8'));
    const outputQueueRef = useRef<string[]>([]);
    const outputQueueBytesRef = useRef<number>(0);
    const outputFlushRafIdRef = useRef<number | null>(null);

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

    const safeFit = useCallback((delay = 80) => {
        if (isMountedRef.current && xtermRef.current && fitAddonRef.current && connIdRef.current && visible) {
            if (safeFitTimeoutRef.current) {
                clearTimeout(safeFitTimeoutRef.current);
            }
            if (delay === 0) {
                try {
                    fitAddonRef.current.fit();
                    const {cols, rows} = xtermRef.current;
                    if (cols > 0 && rows > 0) {
                        ipcRenderer?.sshResize?.({id: connIdRef.current, cols, rows});
                    }
                } catch (err) {
                    console.warn('[Terminal] fit() failed:', err);
                }
                return;
            }
            safeFitTimeoutRef.current = setTimeout(() => {
                if (!isMountedRef.current || !xtermRef.current || !fitAddonRef.current || !visible) return;
                try {
                    fitAddonRef.current.fit();
                    const {cols, rows} = xtermRef.current;
                    if (cols > 0 && rows > 0) {
                        ipcRenderer?.sshResize?.({id: connIdRef.current, cols, rows});
                    }
                } catch (err) {
                    console.warn('[Terminal] fit() failed:', err);
                }
            }, delay);
        }
    }, [visible]);

    const safeFitRef = useRef(safeFit);
    useEffect(() => { safeFitRef.current = safeFit; }, [safeFit]);

    const connect = useCallback((connId: string, cols?: number, rows?: number) => {
        if (!xtermRef.current) return;
        setStatus(tRef.current('terminal.connecting'));
        setHasReceivedData(false);
        const finalCols = cols || xtermRef.current.cols || 80;
        const finalRows = rows || xtermRef.current.rows || 24;
        ipcRenderer?.sshConnect?.({ id: connId, config, cols: finalCols, rows: finalRows });
    }, [config]);

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
        term.open(termRef.current);

        try {
            const webglAddon = new WebglAddon();
            term.loadAddon(webglAddon);
        } catch (e) {
            console.warn('WebGL addon could not be loaded, falling back to standard renderer', e);
        }

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        const openTerminal = () => {
            if (!active || !termRef.current) return;
            term.open(termRef.current);

            requestAnimationFrame(() => {
                if (!active) return;
                try {
                    fitAddon.fit();
                    const { cols, rows } = term;
                    setIsReady(true);
                    connect(connId, cols, rows);
                    term.element?.classList.add('xterm-ready');
                } catch (e) {
                    console.warn('[Terminal] Initial fit failed:', e);
                    connect(connId);
                    setIsReady(true);
                }
            });
        };

        const docWithFonts = document as unknown as { fonts?: { status: string, ready: Promise<void> } };
        if (docWithFonts.fonts?.status === 'loaded') {
            openTerminal();
        } else if (docWithFonts.fonts) {
            docWithFonts.fonts.ready.then(openTerminal);
        } else {
            openTerminal();
        }

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
            if (containerRef.current) {
                containerRef.current.setAttribute('data-alternate-screen', isAlternate ? 'true' : 'false');
            }
        };

        const bufferDisposable = term.buffer.onBufferChange(updateBufferType);
        updateBufferType();

        term.attachCustomKeyEventHandler((e) => {
            if (e.type === 'keydown') {
                const isMac = ipcRenderer?.platform === 'darwin';
                const isCtrl = isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey;

                // Application navigation shortcuts: Ctrl+Tab and Ctrl+Shift+Tab
                // Must always be handled by app, never passed to terminal SSH stream
                if (isCtrl && !e.altKey && (e.code === 'Tab' || e.key === 'Tab')) {
                    return false;
                }

                const isAlternate = term.buffer.active.type === 'alternate';

                // Ctrl+W (or Cmd+W on Mac)
                const isCloseTabKey = isCtrl && !e.shiftKey && !e.altKey && (e.code === 'KeyW' || e.key.toLowerCase() === 'w');
                if (isCloseTabKey) {
                    if (isAlternate) {
                        // In alternate screen (vim, nvim, nano, htop, less, tmux), pass Ctrl+W to terminal
                        return true;
                    }
                    // In normal shell, let global shortcut handler process Ctrl+W to close tab
                    return false;
                }

                // Copy / Paste shortcuts
                const isCopy = (isMac && e.metaKey && e.code === 'KeyC') || (!isMac && e.ctrlKey && e.shiftKey && e.code === 'KeyC');
                const isPaste = (isMac && e.metaKey && e.code === 'KeyV') || (!isMac && e.ctrlKey && e.shiftKey && e.code === 'KeyV');

                if (isCopy) {
                    e.preventDefault();
                    e.stopPropagation();
                    const selection = term.getSelection();
                    if (selection) {
                        navigator.clipboard.writeText(selection);
                    }
                    return false;
                }

                if (isPaste) {
                    e.preventDefault();
                    e.stopPropagation();
                    navigator.clipboard.readText().then(text => {
                        if (text && isMountedRef.current) {
                            term.paste(text);
                        }
                    });
                    return false;
                }

                // Terminal-native Ctrl-combinations in alternate screen or Ctrl+R in shell
                if (isAlternate || (e.ctrlKey && e.code === 'KeyR')) {
                    return true;
                }
            }
            return true;
        });

        const applyHighlighting = (text: string): string => {
            const reset = '\x1b[0m';
            let result = text;

            const ipColor = '\x1b[38;2;210;84;154m';
            const ipv4 = /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g;
            const ipv6 = /(?<![0-9A-Fa-f:])((?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|:(?::[0-9A-Fa-f]{1,4}){1,7}|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4})(?![0-9A-Fa-f:])/g;

            result = result
                .replace(ipv4, ip => `${ipColor}${ip}${reset}`)
                .replace(ipv6, ip => `${ipColor}${ip}${reset}`);

            if (keywordHighlightingRef.current) {
                const keywords: Record<string, string> = {
                    'ERROR': '\x1b[38;2;239;68;68m',
                    'WARNING': '\x1b[38;2;251;191;36m',
                    'WARN': '\x1b[38;2;251;191;36m',
                    'OK': '\x1b[38;2;74;222;128m',
                    'INFO': '\x1b[38;2;96;165;250m',
                    'DEBUG': '\x1b[38;2;192;132;252m'
                };

                const keywordRegex = /\b(ERROR|WARNING|WARN|OK|INFO|DEBUG)\b/gi;
                result = result.replace(keywordRegex, (match) => {
                    const color = keywords[match.toUpperCase()];
                    return color ? `${color}${match}${reset}` : match;
                });
            }

            return result;
        };

        const flushOutputQueue = () => {
            outputFlushRafIdRef.current = null;
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
                const highlighted = applyHighlighting(joinedOutput);
                term.write(highlighted);
            } catch (err) {
                console.warn('[Terminal] batched write failed:', err);
            }
        };

        const scheduleOutputFlush = () => {
            if (outputFlushRafIdRef.current !== null) {
                return;
            }

            outputFlushRafIdRef.current = window.requestAnimationFrame(() => {
                flushOutputQueue();
            });
        };

        const onOutput = (data: Uint8Array) => {
            if (!isMountedRef.current) return;
            setHasReceivedData(true);
            try {
                const text = outputDecoderRef.current.decode(data, { stream: true });
                if (text.length > 0) {
                    outputQueueRef.current.push(text);
                    outputQueueBytesRef.current += data.byteLength;
                }

                const shouldFlushImmediately = outputQueueBytesRef.current >= 64 * 1024;
                if (shouldFlushImmediately) {
                    flushOutputQueue();
                    return;
                }

                scheduleOutputFlush();
            } catch (err) {
                console.warn('[Terminal] write failed:', err);
            }
        };

        const onStatus = (data: string) => {
            if (!isMountedRef.current) return;
            setStatus(data);
            if (data === tRef.current('terminal.connected')) {
                wasConnectedRef.current = true;
                setCountdown(null);
                if (!config.osPrettyName) {
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
                }
                try {
                    const cleanError = data.startsWith('AUTH_FAILURE:') ? data.replace('AUTH_FAILURE:', '').trim() : data;
                    term.write(`\r\n\x1b[31m${tRef.current('common.error')}: ${cleanError}\x1b[0m\r\n`);
                } catch { /* ignore */ }
                setStatus(data);
            }
        };

        const unsubOutput = ipcRenderer?.onSSHOutput?.(connId, (data: Uint8Array) => onOutput(data));
        const unsubStatus = ipcRenderer?.onSSHStatus?.(connId, (status: string) => onStatus(status));
        const unsubError = ipcRenderer?.onSSHError?.(connId, (error: string) => onError(error));
        const unsubOSInfo = ipcRenderer?.onSSHOSInfo?.(connId, (info: string) => {
            if (isMountedRef.current && onOSInfoRef.current) onOSInfoRef.current(info);
        });

        return () => {
            active = false;
            isMountedRef.current = false;
            if (safeFitTimeoutRef.current) clearTimeout(safeFitTimeoutRef.current);
            resizeObserver.disconnect();
            ipcRenderer?.sshClose?.(connId);
            if (typeof unsubOutput === 'function') unsubOutput();
            if (typeof unsubStatus === 'function') unsubStatus();
            if (typeof unsubError === 'function') unsubError();
            if (typeof unsubOSInfo === 'function') unsubOSInfo();
            bufferDisposable.dispose();
            if (outputFlushRafIdRef.current !== null) {
                window.cancelAnimationFrame(outputFlushRafIdRef.current);
                outputFlushRafIdRef.current = null;
            }
            outputQueueRef.current = [];
            outputQueueBytesRef.current = 0;
            try {
                term.dispose();
            } catch { /* ignore */ }
        };
    }, [retryKey, config, connect]);

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
        if (visible && isMountedRef.current && !aiOpen) {
            safeFit();
            setTimeout(() => {
                if (isMountedRef.current && xtermRef.current && !aiOpen) {
                    xtermRef.current.focus();
                }
            }, 50);
        }
    }, [visible, safeFit, aiOpen]);


    const handleContextMenu = (e: React.MouseEvent) => {
        if (!enableContextMenu || !xtermRef.current) return;
        e.preventDefault();

        const term = xtermRef.current;
        const selection = term.getSelection();

        if (selection) {
            navigator.clipboard.writeText(selection);
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
        <div className="terminal-ai-layout" style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            overflow: 'hidden'
        }}>
        <div className="terminal-container"
            ref={containerRef}
            data-alternate-screen="false"
            onContextMenu={handleContextMenu}
            style={{
            flex: 1,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            paddingLeft: '15px',
            paddingTop: '10px',
            paddingBottom: '20px',
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
                    <div className="connection-container" style={{ gap: '40px', padding: '48px', maxWidth: '550px', width: '95%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', gap: '20px' }}>
                            <div className="server-info-card" style={{ gap: '16px', border: 'none', background: 'transparent', padding: 0 }}>
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
                                        <button onClick={onClose} className="btn-secondary" style={{ padding: '12px 32px', fontSize: '15px', background: 'rgba(255,255,255,0.05)', fontWeight: 600 }}>
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
                                        <button onClick={onClose} className="btn-secondary" style={{ padding: '12px 28px', fontSize: '14px' }}>
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
                </div>
            )}
            <div ref={termRef} key={retryKey}
                style={{
                    flex: 1,
                    minHeight: 0,
                    opacity: isReady ? 1 : 0,
                    transition: 'opacity 0.1s ease'
                }} />
        </div>
        {aiOpen && (
            <div className="ai-panel-wrapper" style={{
                width: '35%',
                minWidth: '300px',
                maxWidth: '500px',
                height: '100%',
                overflow: 'hidden',
                flexShrink: 0
            }}>
                <AIChatPanel
                    messages={aiMessages}
                    onMessagesChange={onAiMessagesChange || (() => {})}
                    onClose={onToggleAi || (() => {})}
                    language={appConfig?.language || 'ru'}
                    osPrettyName={config.osPrettyName}
                    focusTrigger={aiFocusTrigger}
                    visible={aiOpen}
                    theme={theme}
                />
            </div>
        )}
        </div>
    );
};
