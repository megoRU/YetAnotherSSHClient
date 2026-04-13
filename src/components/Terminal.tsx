import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebglAddon } from '@xterm/addon-webgl';
import { getXtermTheme } from '../utils/theme';
import type { SSHConfig } from '../types';
import '@xterm/xterm/css/xterm.css';

const { ipcRenderer } = window as any;

interface Props {
    theme: string;
    config: SSHConfig;
    terminalFontName: string;
    terminalFontSize: number;
    visible?: boolean;
    onOSInfo?: (osInfo: string) => void;
    enableContextMenu?: boolean;
}

import { useCallback } from 'react';

export const TerminalComponent: React.FC<Props> = ({
    theme,
    config,
    terminalFontName,
    terminalFontSize,
    visible,
    onOSInfo,
    enableContextMenu
}) => {
    const termRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const safeFitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const connIdRef = useRef<string | null>(null);
    const [status, setStatus] = useState<string>('Соединение...');
    const [retryKey, setRetryKey] = useState<number>(0);
    const isMountedRef = useRef<boolean>(true);
    const wasConnectedRef = useRef<boolean>(false);
    const [countdown, setCountdown] = useState<number | null>(null);

    // Refs for props to avoid effect re-runs
    const onOSInfoRef = useRef(onOSInfo);
    useEffect(() => { onOSInfoRef.current = onOSInfo; }, [onOSInfo]);

    const safeFit = useCallback(() => {
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
                } catch (err) {
                    console.warn('[Terminal] fit() failed:', err);
                }
            }, 50);
        }
    }, [visible]);

    const connect = useCallback((connId: string) => {
        if (!xtermRef.current) return;
        setStatus('Соединение...');
        ipcRenderer.send('ssh-connect', { id: connId, config, cols: xtermRef.current.cols, rows: xtermRef.current.rows });
    }, [config]);

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
        } catch (err) {
            console.warn('[Terminal] Initial fit failed:', err);
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
                } catch (err) {
                    console.warn('[Terminal] write failed:', err);
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
                } catch { /* ignore */ }
                setStatus(`Ошибка: ${data}`);
            }
        };

        const unsubOutput = ipcRenderer.on(`ssh-output-${connId}`, (data: Uint8Array) => onOutput(data));
        const unsubStatus = ipcRenderer.on(`ssh-status-${connId}`, (data: string) => onStatus(data));
        const unsubError = ipcRenderer.on(`ssh-error-${connId}`, (data: string) => onError(data));
        const unsubOSInfo = ipcRenderer.on(`ssh-os-info-${connId}`, (info: string) => {
            if (isMountedRef.current && onOSInfoRef.current) onOSInfoRef.current(info);
        });

        const docWithFonts = document as any;
        docWithFonts.fonts?.ready.then(() => {
            if (isMountedRef.current) safeFit();
        });

        connect(connId);

        return () => {
            isMountedRef.current = false;
            if (safeFitTimeoutRef.current) clearTimeout(safeFitTimeoutRef.current);
            resizeObserver.disconnect();
            ipcRenderer.send('ssh-close', connId);
            if (typeof unsubOutput === 'function') unsubOutput();
            if (typeof unsubStatus === 'function') unsubStatus();
            if (typeof unsubError === 'function') unsubError();
            if (typeof unsubOSInfo === 'function') unsubOSInfo();
            try {
                term.dispose();
            } catch { /* ignore */ }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [retryKey, config.host, config.port, config.user, config.authType, config.privateKeyPath, config.password, connect]);

    useEffect(() => {
        if (xtermRef.current) {
            xtermRef.current.options.theme = getXtermTheme(theme);
            xtermRef.current.options.fontFamily = "'" + terminalFontName + "', monospace";
            xtermRef.current.options.fontSize = terminalFontSize;
            safeFit();
        }
    }, [theme, terminalFontName, terminalFontSize, safeFit]);

    useEffect(() => {
        if (visible && isMountedRef.current) {
            safeFit();
            setTimeout(() => {
                if (isMountedRef.current && xtermRef.current) {
                    xtermRef.current.focus();
                }
            }, 50);
        }
    }, [visible, safeFit]);

    useEffect(() => {
        let timer: any;
        if ((status === 'SSH-соединение закрыто' || status.includes('Ошибка')) && wasConnectedRef.current) {
            setCountdown(5);
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

    useEffect(() => {
        const handleForceCtrlR = () => {
            if (visible && connIdRef.current && status === 'Установлено SSH-соединение') {
                console.log('[Terminal] Force sending Ctrl+R to SSH session');
                ipcRenderer.send('ssh-input', { id: connIdRef.current, data: '\x12' });
            }
        };

        window.addEventListener('terminal-force-ctrl-r', handleForceCtrlR);
        return () => window.removeEventListener('terminal-force-ctrl-r', handleForceCtrlR);
    }, [visible, status]);

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
                    zIndex: 10, padding: '40px', textAlign: 'center'
                }}>
                    <div style={{
                        background: 'var(--card-bg)',
                        padding: '30px 50px',
                        borderRadius: '16px',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '20px',
                        minWidth: '300px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
                    }}>
                        {!isFailed ? (
                            <div className="loading-spinner" />
                        ) : (
                            <div style={{
                                width: '50px',
                                height: '50px',
                                borderRadius: '12px',
                                background: 'rgba(232, 17, 35, 0.1)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#e81123',
                                fontSize: '24px'
                            }}>⚠️</div>
                        )}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ fontSize: '1.1em', fontWeight: 'bold', color: 'var(--text-color)' }}>
                                {status}
                            </div>
                            {countdown !== null && (
                                <div style={{ fontSize: '0.9em', opacity: 0.6, fontWeight: 500 }}>
                                    Автоматическое переподключение через <span style={{ color: '#c81e51', fontWeight: 'bold' }}>{countdown}</span> сек...
                                </div>
                            )}
                        </div>

                        {isFailed && (
                            <button
                                onClick={() => {
                                    setCountdown(null);
                                    setRetryKey(prev => prev + 1);
                                }}
                                className="btn-primary"
                                style={{
                                    padding: '10px 24px',
                                    marginTop: '10px',
                                    fontSize: '0.95em'
                                }}
                            >
                                {status === 'SSH-соединение закрыто' ? 'Переподключиться' : 'Попробовать снова'}
                            </button>
                        )}
                    </div>
                </div>
            )}
            <div ref={termRef} key={retryKey} style={{ flex: 1, minHeight: 0 }} />
        </div>
    );
};
