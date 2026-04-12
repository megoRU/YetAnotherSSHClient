import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebglAddon } from '@xterm/addon-webgl';
import { Copy, Clipboard } from 'lucide-react';
import { getXtermTheme } from '../utils/theme';
import type { SSHConfig } from '../types';
import '@xterm/xterm/css/xterm.css';

const { ipcRenderer } = window as any;

interface Props {
    id: string;
    theme: string;
    config: SSHConfig;
    terminalFontName: string;
    terminalFontSize: number;
    visible?: boolean;
    onOSInfo?: (osInfo: string) => void;
    enableContextMenu?: boolean;
    onContextMenu?: (e: React.MouseEvent, options: any[]) => void;
}

export const TerminalComponent: React.FC<Props> = ({
    id,
    theme,
    config,
    terminalFontName,
    terminalFontSize,
    visible,
    onOSInfo,
    enableContextMenu,
    onContextMenu
}) => {
    const termRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const safeFitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const connIdRef = useRef<string | null>(null);
    const [status, setStatus] = useState<string>('Соединение...');
    const [retryKey, setRetryKey] = useState<number>(0);
    const connectionInitiatedRef = useRef<boolean>(false);
    const isMountedRef = useRef<boolean>(true);
    const wasConnectedRef = useRef<boolean>(false);
    const [countdown, setCountdown] = useState<number | null>(null);

    const safeFit = () => {
        if (isMountedRef.current && xtermRef.current && fitAddonRef.current && connIdRef.current && visible) {
            if (safeFitTimeoutRef.current) {
                clearTimeout(safeFitTimeoutRef.current);
            }
            safeFitTimeoutRef.current = setTimeout(() => {
                if (!isMountedRef.current || !xtermRef.current || !fitAddonRef.current || !visible) return;
                try {
                    fitAddonRef.current.fit();
                    const { cols, rows } = xtermRef.current;
                    if (cols > 0 && rows > 0) {
                        ipcRenderer.send('ssh-resize', {
                            id: connIdRef.current,
                            cols,
                            rows
                        });
                    }
                } catch (e) {
                    console.warn('[Terminal] fit() failed:', e);
                }
            }, 50);
        }
    };

    const connect = (connId: string) => {
        if (!xtermRef.current || connectionInitiatedRef.current) return;
        connectionInitiatedRef.current = true;
        setStatus('Соединение...');
        ipcRenderer.send('ssh-connect', { id: connId, config, cols: xtermRef.current.cols, rows: xtermRef.current.rows });
    };

    useEffect(() => {
        if (!termRef.current) return;
        const connId = Math.random().toString(36).substring(2, 15);
        connIdRef.current = connId;
        isMountedRef.current = true;

        const term = new Terminal({
            cursorBlink: true,
            cursorStyle: 'block',
            theme: getXtermTheme(theme),
            fontFamily: "'" + terminalFontName + "', monospace",
            fontSize: terminalFontSize,
            fontWeight: 400,
            fontWeightBold: 700,
            lineHeight: 1.2,
            letterSpacing: 0.5,
            allowProposedApi: true,
            scrollback: 5000,
            scrollSensitivity: 10,
        });

        const fitAddon = new FitAddon();
        const clipboardAddon = new ClipboardAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(clipboardAddon);
        term.open(termRef.current);

        try {
            const webglAddon = new WebglAddon();
            term.loadAddon(webglAddon);
        } catch (e) {
            console.warn('WebGL addon could not be loaded, falling back to standard renderer', e);
        }

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        try {
            fitAddon.fit();
        } catch (e) {
            console.warn('[Terminal] Initial fit failed:', e);
        }

        const resizeObserver = new ResizeObserver(() => {
            if (isMountedRef.current) {
                safeFit();
            }
        });
        resizeObserver.observe(termRef.current);

        term.onData(data => {
            ipcRenderer.send('ssh-input', { id: connId, data });
        });

        // Используем textarea для отслеживания фокуса, так как xterm API может отличаться
        const textarea = term.textarea;
        const handleFocus = () => ipcRenderer.send('terminal-focus-change', true);
        const handleBlur = () => ipcRenderer.send('terminal-focus-change', false);

        if (textarea) {
            textarea.addEventListener('focus', handleFocus);
            textarea.addEventListener('blur', handleBlur);
        }

        term.attachCustomKeyEventHandler((e) => {
            if (e.type === 'keydown') {
                const isMac = ipcRenderer.platform === 'darwin';
                const isCopy = (isMac && e.metaKey && e.code === 'KeyC') || (e.ctrlKey && e.shiftKey && e.code === 'KeyC');
                const isPaste = (isMac && e.metaKey && e.code === 'KeyV') || (e.ctrlKey && e.shiftKey && e.code === 'KeyV');

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

                // Разрешаем Ctrl+R для поиска в истории терминала (reverse-i-search)
                if (e.ctrlKey && e.code === 'KeyR') {
                    return true;
                }
            }
            return true;
        });

        const onOutput = (data: Uint8Array) => {
            if (isMountedRef.current) {
                try {
                    term.write(data);
                } catch (e) {
                    console.warn('[Terminal] write failed:', e);
                }
            }
        };

        const onStatus = (data: string) => {
            if (!isMountedRef.current) return;
            setStatus(data);
            if (data === 'Установлено SSH-соединение') {
                wasConnectedRef.current = true;
                setCountdown(null);
                if (!config.osPrettyName) {
                    ipcRenderer.send('ssh-get-os-info', connId);
                }
                setTimeout(() => {
                    if (isMountedRef.current) {
                        term.focus();
                        safeFit();
                    }
                }, 100);
            }
        };

        const onError = (data: string) => {
            if (isMountedRef.current) {
                try {
                    term.write(`\r\n\x1b[31mОшибка: ${data}\x1b[0m\r\n`);
                } catch (e) { /* ignore */ }
                setStatus(`Ошибка: ${data}`);
            }
        };

        const unsubOutput = ipcRenderer.on(`ssh-output-${connId}`, (data: Uint8Array) => onOutput(data));
        const unsubStatus = ipcRenderer.on(`ssh-status-${connId}`, (data: string) => onStatus(data));
        const unsubError = ipcRenderer.on(`ssh-error-${connId}`, (data: string) => onError(data));
        const unsubOSInfo = ipcRenderer.on(`ssh-os-info-${connId}`, (info: string) => {
            if (isMountedRef.current && onOSInfo) onOSInfo(info);
        });

        const docWithFonts = document as any;
        docWithFonts.fonts?.ready.then(() => {
            if (isMountedRef.current) safeFit();
        });

        connect(connId);

        return () => {
            isMountedRef.current = false;
            connectionInitiatedRef.current = false;
            if (safeFitTimeoutRef.current) clearTimeout(safeFitTimeoutRef.current);
            resizeObserver.disconnect();
            if (textarea) {
                textarea.removeEventListener('focus', handleFocus);
                textarea.removeEventListener('blur', handleBlur);
            }
            ipcRenderer.send('ssh-close', connId);
            if (typeof unsubOutput === 'function') unsubOutput();
            if (typeof unsubStatus === 'function') unsubStatus();
            if (typeof unsubError === 'function') unsubError();
            if (typeof unsubOSInfo === 'function') unsubOSInfo();
            try {
                term.dispose();
            } catch (e) { /* ignore */ }
        };
    }, [retryKey, config]);

    useEffect(() => {
        if (xtermRef.current) {
            xtermRef.current.options.theme = getXtermTheme(theme);
            xtermRef.current.options.fontFamily = "'" + terminalFontName + "', monospace";
            xtermRef.current.options.fontSize = terminalFontSize;
            safeFit();
        }
    }, [theme, terminalFontName, terminalFontSize]);

    useEffect(() => {
        if (visible && isMountedRef.current) {
            safeFit();
            setTimeout(() => {
                if (isMountedRef.current && xtermRef.current) {
                    xtermRef.current.focus();
                }
            }, 50);
        }
    }, [visible]);

    useEffect(() => {
        let timer: any;
        if ((status === 'SSH-соединение закрыто' || status.includes('Ошибка')) && wasConnectedRef.current) {
            setCountdown(5);
            timer = setInterval(() => {
                setCountdown(prev => {
                    if (prev === null) return null;
                    if (prev <= 1) {
                        clearInterval(timer);
                        connectionInitiatedRef.current = false;
                        setRetryKey(k => k + 1);
                        return null;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [status]);

    const handleContextMenu = (e: React.MouseEvent) => {
        if (!enableContextMenu || !xtermRef.current) return;
        e.preventDefault();

        const term = xtermRef.current;
        const selection = term.getSelection();

        if (selection) {
            // Если есть выделение - копируем и снимаем выделение
            navigator.clipboard.writeText(selection);
            term.clearSelection();
        } else {
            // Если выделения нет - вставляем из буфера
            navigator.clipboard.readText().then(text => {
                if (text && isMountedRef.current) {
                    term.paste(text);
                }
            });
        }
    };

    const isWaiting = status !== 'Установлено SSH-соединение';
    const isFailed = status.includes('Ошибка') || status === 'SSH-соединение закрыто';

    return (
        <div className="terminal-container"
            onContextMenu={handleContextMenu}
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
            overflow: 'hidden'
        }}>
            {isWaiting && (
                <div style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'var(--bg-color)',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    zIndex: 10, gap: '20px', padding: '20px', textAlign: 'center'
                }}>
                    {!isFailed ? (
                        <div className="loading-spinner" />
                    ) : (
                        <div style={{ color: '#e81123', fontSize: '24px', marginBottom: '10px' }}>⚠️</div>
                    )}
                    <div style={{ fontWeight: 'bold', maxWidth: '80%', wordBreak: 'break-word' }}>
                        {status}
                        {countdown !== null && (
                            <div style={{ fontSize: '0.9em', opacity: 0.7, marginTop: '5px' }}>
                                Переподключение через {countdown} сек...
                            </div>
                        )}
                    </div>
                    {isFailed && (
                        <button
                            onClick={() => {
                                setCountdown(null);
                                connectionInitiatedRef.current = false;
                                setRetryKey(prev => prev + 1);
                            }}
                            className="btn-primary"
                            style={{ marginTop: '10px' }}
                        >
                            {status === 'SSH-соединение закрыто' ? 'Переподключиться' : 'Попробовать снова'}
                        </button>
                    )}
                </div>
            )}
            <div ref={termRef} key={retryKey} style={{ flex: 1, minHeight: 0 }} />
        </div>
    );
};
