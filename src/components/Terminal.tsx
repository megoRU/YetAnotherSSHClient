import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Terminal as IconTerminal, Plug } from 'lucide-react';
import { getTerminalTheme } from '../utils/theme';
import { getOSIcon } from '../utils';
import type { SSHConfig } from '../types';
import { TerminalCore } from './terminal/TerminalCore';
import { CanvasRenderer } from './terminal/CanvasRenderer';

const { ipcRenderer } = window;

interface Props {
    theme: string;
    config: SSHConfig;
    terminalFontName: string;
    terminalFontSize: number;
    terminalScrollSensitivity: number;
    id: string;
    visible?: boolean;
    onOSInfo?: (osInfo: string) => void;
    enableContextMenu?: boolean;
    onEditConfig?: (config: SSHConfig) => void;
    onClose?: () => void;
}

export const TerminalComponent: React.FC<Props> = ({
    theme,
    config,
    terminalFontName,
    terminalFontSize,
    visible,
    onOSInfo,
    onEditConfig,
    onClose
}) => {
    const termTheme = useMemo(() => getTerminalTheme(theme), [theme]);
    const [terminalCore] = useState(() => new TerminalCore(80, 24, termTheme));

    useEffect(() => {
        terminalCore.updateTheme(termTheme);
    }, [termTheme, terminalCore]);

    const connIdRef = useRef<string | null>(null);
    const [status, setStatus] = useState<string>('Соединение...');
    const [retryKey, setRetryKey] = useState<number>(0);
    const [isReady, setIsReady] = useState(false);
    const [showTerminal, setShowTerminal] = useState(false);
    const isMountedRef = useRef<boolean>(true);
    const wasConnectedRef = useRef<boolean>(false);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [currentSelection, setCurrentSelection] = useState<{ startX: number, startY: number, endX: number, endY: number } | null>(null);

    // Вычисляемые свойства (Derived State)
    const isWaiting = !showTerminal;
    const statusStr = status || '';
    const isAuthFailed = statusStr.startsWith('AUTH_FAILURE:');
    const statusLower = statusStr.toLowerCase();
    const isClosed = statusStr === 'Соединение закрыто';
    const isFailed = statusLower.includes('ошибка') ||
                     statusLower.includes('error') ||
                     statusLower.includes('failed') ||
                     statusLower.includes('timeout') ||
                     isClosed ||
                     isAuthFailed;

    const displayStatus = isAuthFailed
        ? 'Неверный логин или пароль'
        : statusStr;

    // Refs for props to avoid effect re-runs
    const onOSInfoRef = useRef(onOSInfo);
    useEffect(() => { onOSInfoRef.current = onOSInfo; }, [onOSInfo]);

    const connect = useCallback((connId: string, cols?: number, rows?: number) => {
        setStatus('Соединение...');
        const finalCols = cols || terminalCore.cols || 80;
        const finalRows = rows || terminalCore.rows || 24;
        ipcRenderer.send('ssh-connect', { id: connId, config, cols: finalCols, rows: finalRows });
    }, [config, terminalCore]);

    const handleResize = useCallback((cols: number, rows: number) => {
        if (connIdRef.current) {
            ipcRenderer.send('ssh-resize', { id: connIdRef.current, cols, rows });
        }
    }, []);

    useEffect(() => {
        const connId = Math.random().toString(36).substring(2, 15);
        connIdRef.current = connId;
        isMountedRef.current = true;

        terminalCore.clear();
        terminalCore.setInputCallback((data: string) => {
            ipcRenderer.send('ssh-input', { id: connId, data });
        });

        const decoder = new TextDecoder();
        const ipv4Regex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
        const ipv6Regex = /(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}|(?:::(?:[a-fA-F0-9]{1,4}:){0,6}[a-fA-F0-9]{1,4}|(?:[a-fA-F0-9]{1,4}:){1,7}:)/g;

        const onOutput = (data: Uint8Array) => {
            if (isMountedRef.current) {
                // Colorize IPs using SGR foreground color 39 to reset color only
                const text = decoder.decode(data, { stream: true });
                const colorizedText = text.replace(ipv4Regex, (match) => `\x1b[38;2;210;84;154m${match}\x1b[39m`)
                                         .replace(ipv6Regex, (match) => `\x1b[38;2;210;84;154m${match}\x1b[39m`);

                terminalCore.write(colorizedText);
            }
        };

        const onStatus = (data: unknown) => {
            if (!isMountedRef.current) return;
            const msg = (typeof data === 'string' ? data : '') || '';
            setStatus(msg);
            if (msg === 'Установлено соединение') {
                wasConnectedRef.current = true;
                setCountdown(null);
                if (!config.osPrettyName) {
                    ipcRenderer.send('ssh-get-os-info', connId);
                }
            }
        };

        const onError = (data: unknown) => {
            if (isMountedRef.current) {
                const msg = (typeof data === 'string' ? data : '') || 'Unknown error';
                if (msg.startsWith('AUTH_FAILURE:')) {
                    wasConnectedRef.current = false;
                }
                const cleanError = (typeof msg === 'string' && msg.startsWith('AUTH_FAILURE:')) ? msg.replace('AUTH_FAILURE:', '').trim() : msg;
                terminalCore.write(`\r\n\x1b[31mОшибка: ${cleanError}\x1b[0m\r\n`);
                setStatus(msg);
            }
        };

        // Listener registration
        const listeners = [
            ipcRenderer.on(`ssh-output-${connId}`, (_: unknown, data: Uint8Array) => onOutput(data)),
            ipcRenderer.on(`ssh-status-${connId}`, (_: unknown, data: string) => onStatus(data)),
            ipcRenderer.on(`ssh-error-${connId}`, (_: unknown, data: string) => onError(data)),
            ipcRenderer.on(`ssh-os-info-${connId}`, (_: unknown, data: string) => {
                if (isMountedRef.current && onOSInfoRef.current) onOSInfoRef.current(data);
            })
        ];

        const timerId = setTimeout(() => {
            if (isMountedRef.current) {
                setIsReady(true);
                connect(connId);
            }
        }, 0);

        return () => {
            isMountedRef.current = false;
            clearTimeout(timerId);
            ipcRenderer.send('ssh-close', connId);
            listeners.forEach(unsub => {
                if (typeof unsub === 'function') unsub();
            });
        };
    }, [retryKey, config, connect, terminalCore]);

    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | undefined;
        const sLower = status.toLowerCase();
        const isErrorStatus = sLower.includes('ошибка') || sLower.includes('error') || sLower.includes('failed') || sLower.includes('timeout');
        const shouldRetry = (status === 'Соединение закрыто' || isErrorStatus) && wasConnectedRef.current && !isAuthFailed;

        if (shouldRetry) {
            timer = setInterval(() => {
                setCountdown(prev => {
                    if (prev === null) return 5;
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
    }, [status, isAuthFailed]);

    const handlePaste = useCallback(async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text && connIdRef.current && status === 'Установлено соединение') {
                ipcRenderer.send('ssh-input', { id: connIdRef.current, data: text });
            }
        } catch (err) {
            console.error('Failed to paste:', err);
        }
    }, [status]);

    const handleCopy = useCallback(() => {
        if (currentSelection) {
            const text = terminalCore.getSelectionText(currentSelection);
            if (text) {
                navigator.clipboard.writeText(text);
                setCurrentSelection(null);
            }
        }
    }, [currentSelection, terminalCore]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (!connIdRef.current || status !== 'Установлено соединение') return;

        const { key, ctrlKey, shiftKey } = e;

        // Support Ctrl+Shift+C/V for Copy/Paste as requested
        if (ctrlKey && shiftKey) {
            if (key.toLowerCase() === 'c') {
                e.preventDefault();
                handleCopy();
                return;
            }
            if (key.toLowerCase() === 'v') {
                e.preventDefault();
                handlePaste();
                return;
            }
        }

        let data = '';
        if (ctrlKey) {
            const charCode = key.toLowerCase().charCodeAt(0);
            if (charCode >= 97 && charCode <= 122) {
                data = String.fromCharCode(charCode - 96);
            }
        } else {
            switch (key) {
                case 'Enter': data = '\r'; break;
                case 'Backspace': data = '\x7f'; break;
                case 'Tab': e.preventDefault(); data = '\t'; break;
                case 'Escape': data = '\x1b'; break;
                case 'ArrowUp': data = '\x1b[A'; break;
                case 'ArrowDown': data = '\x1b[B'; break;
                case 'ArrowRight': data = '\x1b[C'; break;
                case 'ArrowLeft': data = '\x1b[D'; break;
                case 'Home': data = '\x1b[H'; break;
                case 'End': data = '\x1b[F'; break;
                case 'PageUp': data = '\x1b[5~'; break;
                case 'PageDown': data = '\x1b[6~'; break;
                case 'Insert': data = '\x1b[2~'; break;
                case 'Delete': data = '\x1b[3~'; break;
                case 'F1': data = '\x1bOP'; break;
                case 'F2': data = '\x1bOQ'; break;
                case 'F3': data = '\x1bOR'; break;
                case 'F4': data = '\x1bOS'; break;
                case 'F5': data = '\x1b[15~'; break;
                case 'F6': data = '\x1b[17~'; break;
                case 'F7': data = '\x1b[18~'; break;
                case 'F8': data = '\x1b[19~'; break;
                case 'F9': data = '\x1b[20~'; break;
                case 'F10': data = '\x1b[21~'; break;
                case 'F11': data = '\x1b[23~'; break;
                case 'F12': data = '\x1b[24~'; break;
                default:
                    if (key.length === 1) data = key;
                    break;
            }
        }

        if (data) {
             ipcRenderer.send('ssh-input', { id: connIdRef.current, data });
        }
    }, [status, handleCopy, handlePaste]);

    const isConnected = status === 'Установлено соединение';

    useEffect(() => {
        if (isConnected && isReady) {
            const timer = setTimeout(() => {
                if (isMountedRef.current) {
                    setShowTerminal(true);
                }
            }, 150);
            return () => clearTimeout(timer);
        } else if (isFailed) {
            const timer = setTimeout(() => {
                if (isMountedRef.current) {
                    setShowTerminal(false);
                }
            }, 0);
            return () => clearTimeout(timer);
        }
    }, [isConnected, isReady, isFailed]);

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        if (currentSelection) {
            handleCopy();
        } else {
            handlePaste();
        }
    };

    return (
        <div className="terminal-container"
            onKeyDown={handleKeyDown}
            onContextMenu={handleContextMenu}
            tabIndex={0}
            style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            paddingLeft: '15px',
            paddingTop: '10px',
            paddingBottom: '20px',
            boxSizing: 'border-box',
            backgroundColor: 'var(--bg-color)',
            overflow: 'hidden',
            outline: 'none'
        }}>
            {isWaiting && (
                <div className={`connection-overlay ${!isFailed ? 'loading' : 'failed'}`} style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'var(--bg-color)',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    zIndex: 10, padding: '40px', textAlign: 'center',
                    transition: 'opacity 0.3s ease, visibility 0.3s'
                }}>
                    <div className="connection-container">
                        <div className="server-info-card">
                            <div className="os-icon-wrapper">
                                <img src={getOSIcon(config.osPrettyName)} alt="OS" />
                            </div>
                            <div className="server-details">
                                <div className="server-name">{config.name}</div>
                                <div className="server-address">SSH {config.host}:{config.port}</div>
                            </div>
                        </div>

                        {!isFailed ? (
                            <>
                                <div className="connection-path">
                                    <div className="path-node">
                                        <Plug size={20} />
                                    </div>
                                    <div className="path-line">
                                        <div className="path-progress" />
                                    </div>
                                    <div className="path-node">
                                        <IconTerminal size={20} />
                                    </div>
                                </div>

                                <div className="connection-actions">
                                    {onClose && (
                                        <button onClick={onClose} className="btn-secondary">
                                            Закрыть
                                        </button>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '20px',
                                width: '100%',
                                marginTop: '20px'
                            }}>
                                <div style={{
                                    width: '50px',
                                    height: '50px',
                                    borderRadius: '12px',
                                    background: isAuthFailed ? 'rgba(200, 30, 81, 0.1)' : (isClosed ? 'rgba(232, 17, 35, 0.05)' : 'rgba(232, 17, 35, 0.1)'),
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: isAuthFailed ? '#c81e51' : (isClosed ? 'var(--text-color)' : '#e81123'),
                                    fontSize: '24px',
                                    opacity: isClosed ? 0.7 : 1
                                }}>{isAuthFailed ? '🔒' : (isClosed ? '🔌' : '⚠️')}</div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '1.2em', fontWeight: 'bold', color: 'var(--text-color)' }}>
                                        {displayStatus}
                                    </div>
                                    {countdown !== null && !isAuthFailed && (
                                        <div style={{ fontSize: '1em', opacity: 0.7, fontWeight: 500 }}>
                                            Автоматическое переподключение через <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>{countdown}</span> сек...
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '10px', width: '100%' }}>
                                    {onClose && (
                                        <button onClick={onClose} className="btn-secondary" style={{ padding: '10px 24px', fontSize: '1.05em' }}>
                                            Закрыть
                                        </button>
                                    )}
                                    {onEditConfig && (
                                        <button
                                            onClick={() => onEditConfig(config)}
                                            className="btn-secondary"
                                            style={{
                                                padding: '10px 24px',
                                                fontSize: '1.05em',
                                                background: 'var(--card-bg)',
                                                color: 'var(--text-color)',
                                                border: '1px solid var(--border-color)'
                                            }}
                                        >
                                            Редактировать
                                        </button>
                                    )}
                                    <button
                                        onClick={() => {
                                            setCountdown(null);
                                            setRetryKey(prev => prev + 1);
                                        }}
                                        className="btn-primary"
                                        style={{
                                            padding: '10px 24px',
                                            fontSize: '1.05em'
                                        }}
                                    >
                                        {status === 'Соединение закрыто' ? 'Переподключиться' : 'Попробовать снова'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
            <div style={{
                    flex: 1,
                    minHeight: 0,
                    opacity: isReady ? 1 : 0,
                    transition: 'opacity 0.1s ease'
                }}>
                <CanvasRenderer
                    core={terminalCore}
                    theme={termTheme}
                    fontFamily={terminalFontName}
                    fontSize={terminalFontSize}
                    visible={visible || false}
                    onResize={handleResize}
                    onSelectionChange={setCurrentSelection}
                />
            </div>
        </div>
    );
};
