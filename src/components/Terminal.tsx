import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as IconTerminal, Plug } from 'lucide-react';
import { getXtermTheme } from '../utils/theme';
import { getOSIcon } from '../utils';
import type { SSHConfig } from '../types';
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
    terminalScrollSensitivity,
    visible,
    onOSInfo,
    enableContextMenu,
    onEditConfig,
    onClose
}) => {
    const termRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const safeFitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const connIdRef = useRef<string | null>(null);
    const [status, setStatus] = useState<string>('Соединение...');
    const [retryKey, setRetryKey] = useState<number>(0);
    const [isReady, setIsReady] = useState(false);
    const [hasReceivedData, setHasReceivedData] = useState(false);
    const [showTerminal, setShowTerminal] = useState(false);
    const isMountedRef = useRef<boolean>(true);
    const wasConnectedRef = useRef<boolean>(false);
    const [countdown, setCountdown] = useState<number | null>(null);

    // Вычисляемые свойства (Derived State)
    const isWaiting = !showTerminal;
    const isAuthFailed = status.startsWith('AUTH_FAILURE:');
    const statusLower = status.toLowerCase();
    const isFailed = statusLower.includes('ошибка') ||
                     statusLower.includes('error') ||
                     statusLower.includes('failed') ||
                     statusLower.includes('timeout') ||
                     status === 'Соединение закрыто' ||
                     isAuthFailed;

    const displayStatus = isAuthFailed
        ? 'Неверный логин или пароль'
        : status;

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
                        ipcRenderer.send('ssh-resize', {id: connIdRef.current, cols, rows});
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
                        ipcRenderer.send('ssh-resize', {id: connIdRef.current, cols, rows});
                    }
                } catch (err) {
                    console.warn('[Terminal] fit() failed:', err);
                }
            }, delay);
        }
    }, [visible]);

    const connect = useCallback((connId: string, cols?: number, rows?: number) => {
        if (!xtermRef.current) return;
        setStatus('Соединение...');
        setHasReceivedData(false);
        // wasConnectedRef.current НЕ сбрасываем здесь, чтобы сохранить желание переподключаться
        // при временных сбоях (например ECONNREFUSED во время перезагрузки сервера).
        const finalCols = cols || xtermRef.current.cols || 80;
        const finalRows = rows || xtermRef.current.rows || 24;
        ipcRenderer.send('ssh-connect', { id: connId, config, cols: finalCols, rows: finalRows });
    }, [config]);

    useEffect(() => {
        if (!termRef.current) return;

        setIsReady(false);

        const connId = Math.random().toString(36).substring(2, 15);
        connIdRef.current = connId;
        isMountedRef.current = true;

        const term = new Terminal({
            cursorBlink: true,
            cursorStyle: 'block',
            theme: getXtermTheme(theme),
            fontFamily: "'" + terminalFontName + "', 'JetBrains Mono', monospace",
            fontSize: terminalFontSize,
            allowProposedApi: true,
            lineHeight: 1,
            letterSpacing: 0,
            scrollback: 50000,
            scrollSensitivity: terminalScrollSensitivity,
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

        // 🔥 ЕДИНСТВЕННЫЙ pipeline инициализации
        requestAnimationFrame(() => {
            safeFit(0);
            setTimeout(() => {
                if (isMountedRef.current && fitAddonRef.current && xtermRef.current) {
                    try {
                        fitAddonRef.current.fit();
                        const { cols, rows } = xtermRef.current;
                        safeFit(0);
                        setIsReady(true);
                        connect(connId, cols, rows);
                    } catch (e) {
                        console.warn('[Terminal] fit before connect failed', e);
                        connect(connId);
                        setIsReady(true);
                    }
                }
            }, 30);
        });

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
                setHasReceivedData(true);
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
            if (data === 'Установлено соединение') {
                wasConnectedRef.current = true;
                setCountdown(null);
                if (!config.osPrettyName) {
                    ipcRenderer.send('ssh-get-os-info', connId);
                }
                setTimeout(() => {
                    if (isMountedRef.current) {
                        term.focus();
                        safeFit();
                        setTimeout(safeFit, 100);
                    }
                }, 100);
            }
        };

        const onError = (data: string) => {
            if (isMountedRef.current) {
                if (data.startsWith('AUTH_FAILURE:')) {
                    wasConnectedRef.current = false; // При ошибке аутентификации сбрасываем, чтобы не было авто-реконнекта
                }
                try {
                    const cleanError = data.startsWith('AUTH_FAILURE:') ? data.replace('AUTH_FAILURE:', '').trim() : data;
                    term.write(`\r\n\x1b[31mОшибка: ${cleanError}\x1b[0m\r\n`);
                } catch { /* ignore */ }
                setStatus(data);
            }
        };

        const unsubOutput = ipcRenderer.on(`ssh-output-${connId}`, (...args: unknown[]) => onOutput(args[0] as Uint8Array));
        const unsubStatus = ipcRenderer.on(`ssh-status-${connId}`, (...args: unknown[]) => onStatus(args[0] as string));
        const unsubError = ipcRenderer.on(`ssh-error-${connId}`, (...args: unknown[]) => onError(args[0] as string));
        const unsubOSInfo = ipcRenderer.on(`ssh-os-info-${connId}`, (...args: unknown[]) => {
            const info = args[0] as string;
            if (isMountedRef.current && onOSInfoRef.current) onOSInfoRef.current(info);
        });

        const docWithFonts = document as unknown as { fonts?: { ready: Promise<void> } };
        docWithFonts.fonts?.ready.then(() => {
            if (isMountedRef.current) {
                safeFit();
                setTimeout(() => {
                    safeFit();
                    setIsReady(true);
                }, 100);
            }
        });

        // connect(connId); // Теперь вызывается в pipeline выше после fit()

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
            xtermRef.current.options.fontFamily = "'" + terminalFontName + "', 'JetBrains Mono', monospace";
            xtermRef.current.options.fontSize = terminalFontSize;
            xtermRef.current.options.lineHeight = 1;
            xtermRef.current.options.letterSpacing = 0;
            xtermRef.current.options.scrollSensitivity = terminalScrollSensitivity;
            safeFit();
        }
    }, [theme, terminalFontName, terminalFontSize, terminalScrollSensitivity, safeFit]);

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
        let timer: ReturnType<typeof setInterval> | undefined;
        const sLower = status.toLowerCase();
        const isErrorStatus = sLower.includes('ошибка') || sLower.includes('error') || sLower.includes('failed') || sLower.includes('timeout');
        const shouldRetry = (status === 'Соединение закрыто' || isErrorStatus) && wasConnectedRef.current && !isAuthFailed;

        if (shouldRetry) {
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
    }, [status, isAuthFailed]);

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
            if (visible && connIdRef.current && status === 'Установлено соединение') {
                console.log('[Terminal] Force sending Ctrl+R to SSH session');
                ipcRenderer.send('ssh-input', { id: connIdRef.current, data: '\x12' });
            }
        };

        window.addEventListener('terminal-force-ctrl-r', handleForceCtrlR);
        return () => window.removeEventListener('terminal-force-ctrl-r', handleForceCtrlR);
    }, [visible, status]);

    useEffect(() => {
        if (status === 'Установлено соединение' && hasReceivedData && isReady) {
            const timer = setTimeout(() => {
                if (isMountedRef.current) {
                    setShowTerminal(true);
                    // После показа терминала делаем ресайз, так как контейнер мог изменить размеры
                    // из-за исчезновения оверлея
                    setTimeout(() => safeFit(0), 10);
                    setTimeout(() => safeFit(0), 100);
                    setTimeout(safeFit, 400);
                }
            }, 150);
            return () => clearTimeout(timer);
        } else {
            setShowTerminal(false);
        }
    }, [status, hasReceivedData, isReady, safeFit]);

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
                                    background: isAuthFailed ? 'rgba(200, 30, 81, 0.1)' : 'rgba(232, 17, 35, 0.1)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: isAuthFailed ? '#c81e51' : '#e81123',
                                    fontSize: '24px'
                                }}>{isAuthFailed ? '🔒' : '⚠️'}</div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ fontSize: '1.2em', fontWeight: 'bold', color: 'var(--text-color)' }}>
                                        {displayStatus}
                                    </div>
                                    {countdown !== null && !isAuthFailed && (
                                        <div style={{ fontSize: '1em', opacity: 0.7, fontWeight: 500 }}>
                                            Автоматическое переподключение через <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>{countdown}</span> сек...
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                                    <button
                                        onClick={() => {
                                            setCountdown(null);
                                            setRetryKey(prev => prev + 1);
                                        }}
                                        className="btn-primary"
                                        style={{
                                            padding: '10px 24px',
                                            fontSize: '0.95em'
                                        }}
                                    >
                                        {status === 'Соединение закрыто' ? 'Переподключиться' : 'Попробовать снова'}
                                    </button>
                                    {isAuthFailed && onEditConfig && (
                                        <button
                                            onClick={() => onEditConfig(config)}
                                            className="btn-primary"
                                            style={{
                                                padding: '10px 24px',
                                                fontSize: '0.95em',
                                                background: 'var(--card-bg)',
                                                color: 'var(--text-color)',
                                                border: '1px solid var(--border-color)'
                                            }}
                                        >
                                            Настроить сервер
                                        </button>
                                    )}
                                    {onClose && (
                                        <button onClick={onClose} className="btn-secondary" style={{ padding: '10px 24px' }}>
                                            Закрыть
                                        </button>
                                    )}
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
    );
};
