import React, {useEffect, useRef, useState} from 'react';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {ClipboardAddon} from '@xterm/addon-clipboard';
import {WebglAddon} from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

const {ipcRenderer} = window as any;

interface Props {
    id: string;
    theme: string;
    config: any;
    terminalFontName: string;
    terminalFontSize: number;
    visible?: boolean;
    onOSInfo?: (osInfo: string) => void;
}

const getXtermTheme = (theme: string) => {
    switch (theme) {
        case 'Dark':
            return {
                background: '#282828',
                foreground: '#ebdbb2',
                cursor: '#ebdbb2',
                selectionBackground: '#504945',
                black: '#282828',
                red: '#cc241d',
                green: '#98971a',
                yellow: '#d79921',
                blue: '#458588',
                magenta: '#b16286',
                cyan: '#689d6a',
                white: '#a89984',
                brightBlack: '#928374',
                brightRed: '#fb4934',
                brightGreen: '#b8bb26',
                brightYellow: '#fabd2f',
                brightBlue: '#83a598',
                brightMagenta: '#d3869b',
                brightCyan: '#8ec07c',
                brightWhite: '#ebdbb2',
            };
        case 'Gruvbox Light':
            return {
                background: '#fbf1c7',
                foreground: '#282828',
                cursor: '#3c3836',
                selectionBackground: '#d5c4a1',
                black: '#282828',
                red: '#cc241d',
                green: '#98971a',
                yellow: '#d79921',
                blue: '#458588',
                magenta: '#b16286',
                cyan: '#689d6a',
                white: '#7c6f64',
                brightBlack: '#928374',
                brightRed: '#9d0006',
                brightGreen: '#79740e',
                brightYellow: '#b57614',
                brightBlue: '#076678',
                brightMagenta: '#8f3f71',
                brightCyan: '#427b58',
                brightWhite: '#3c3836',
            };
        case 'Light': {
            return {
                background: '#ffffff',
                foreground: '#000000',
                cursor: '#000000',
                selectionBackground: '#add6ff',
                black: '#000000',
                red: '#cd3131',
                green: '#00bc00',
                yellow: '#949800',
                blue: '#0451a5',
                magenta: '#bc05bc',
                cyan: '#0598bc',
                white: '#555555',
                brightBlack: '#666666',
                brightRed: '#cd3131',
                brightGreen: '#14e314',
                brightYellow: '#b5ba00',
                brightBlue: '#0451a5',
                brightMagenta: '#bc05bc',
                brightCyan: '#0598bc',
                brightWhite: '#a5a5a5',
            };
        }
        default:
            return {
                background: '#ffffff',
                foreground: '#000000',
                cursor: '#000000',
                selectionBackground: '#add6ff',
                black: '#000000',
                red: '#cd3131',
                green: '#00bc00',
                yellow: '#949800',
                blue: '#0451a5',
                magenta: '#bc05bc',
                cyan: '#0598bc',
                white: '#555555',
                brightBlack: '#666666',
                brightRed: '#cd3131',
                brightGreen: '#14e314',
                brightYellow: '#b5ba00',
                brightBlue: '#0451a5',
                brightMagenta: '#bc05bc',
                brightCyan: '#0598bc',
                brightWhite: '#a5a5a5',
            };
    }
};

export const TerminalComponent: React.FC<Props> = ({
                                                       id,
                                                       theme,
                                                       config,
                                                       terminalFontName,
                                                       terminalFontSize,
                                                       visible,
                                                       onOSInfo
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
            // Small delay to ensure the container has settled after DOM changes or font loading
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
        console.log(`[SSH] Renderer requesting connection [ConnID: ${connId}]`, {
            user: config.user,
            host: config.host,
            port: config.port
        });
        ipcRenderer.send('ssh-connect', {id: connId, config, cols: xtermRef.current.cols, rows: xtermRef.current.rows});
    };

    useEffect(() => {
        if (!termRef.current) return;
        const connId = Math.random().toString(36).substring(2, 15);
        connIdRef.current = connId;
        isMountedRef.current = true;
        let fitTimeout: any = null;

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
            scrollSensitivity: 2,
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

        // Perform initial fit so that we have correct dimensions before connecting
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
        if (termRef.current) {
            resizeObserver.observe(termRef.current);
        }

        term.onData(data => {
            ipcRenderer.send('ssh-input', {id: connId, data});
        });

        term.attachCustomKeyEventHandler((e) => {
            if (e.type === 'keydown') {
                const isMac = ipcRenderer.platform === 'darwin';
                // Ctrl+Shift+C or Cmd+C (on Mac)
                const isCopy = (isMac && e.metaKey && e.code === 'KeyC') || (e.ctrlKey && e.shiftKey && e.code === 'KeyC');
                // Ctrl+Shift+V or Cmd+V (on Mac)
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
            if (isMountedRef.current) {
                console.log(`[SSH Status ID: ${id}] ${data}`);
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
                    // Secondary fit to ensure full height for htop/nano after layout settles
                    setTimeout(() => {
                        if (isMountedRef.current) {
                            safeFit();
                        }
                    }, 500);
                }
            }
        };
        const onError = (data: string) => {
            if (isMountedRef.current) {
                console.error(`[SSH Error ID: ${id}] ${data}`);
                try {
                    term.write(`\r\n\x1b[31mОшибка: ${data}\x1b[0m\r\n`);
                } catch (e) {
                    // ignore
                }
                setStatus(`Ошибка: ${data}`);
            }
        };

        const onOSInfoReceived = (info: string) => {
            if (isMountedRef.current && onOSInfo) {
                onOSInfo(info);
            }
        };

        const unsubOutput = ipcRenderer.on(`ssh-output-${connId}`, (data: Uint8Array) => onOutput(data));
        const unsubStatus = ipcRenderer.on(`ssh-status-${connId}`, (data: string) => onStatus(data));
        const unsubError = ipcRenderer.on(`ssh-error-${connId}`, (data: string) => onError(data));
        const unsubOSInfo = ipcRenderer.on(`ssh-os-info-${connId}`, onOSInfoReceived);

        // Ensure fit is accurate after fonts are fully loaded
        const docWithFonts = document as unknown as { fonts?: { ready: Promise<void> } };
        docWithFonts.fonts?.ready.then(() => {
            if (isMountedRef.current) {
                safeFit();
            }
        });

        connect(connId);

        return () => {
            console.log(`[SSH] Cleaning up Terminal for ConnID: ${connId}`);
            isMountedRef.current = false;
            connectionInitiatedRef.current = false;
            if (fitTimeout) clearTimeout(fitTimeout);
            resizeObserver.disconnect();
            ipcRenderer.send('ssh-close', connId);
            unsubOutput();
            unsubStatus();
            unsubError();
            unsubOSInfo();
            try {
                term.dispose();
            } catch (e) {
                console.warn('[Terminal] dispose failed:', e);
            }
        };
    }, [retryKey]);

    useEffect(() => {
        if (xtermRef.current) {
            xtermRef.current.options.theme = getXtermTheme(theme);
            xtermRef.current.options.fontFamily = "'" + terminalFontName + "', monospace";
            xtermRef.current.options.fontSize = terminalFontSize;
            xtermRef.current.options.fontWeight = 400;
            xtermRef.current.options.fontWeightBold = 700;
            xtermRef.current.options.lineHeight = 1.2;
            safeFit();
        }
    }, [theme, terminalFontName, terminalFontSize]);

    useEffect(() => {
        if (visible && isMountedRef.current) {
            safeFit();
        }
    }, [visible]);

    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | undefined;
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
        return () => {
            if (timer) clearInterval(timer);
        };
    }, [status]);

    const isWaiting = status !== 'Установлено SSH-соединение';
    const isFailed = status.includes('Ошибка') || status === 'SSH-соединение закрыто';

    return (
        <div className="terminal-container" style={{
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
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'var(--bg-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10,
                    gap: '20px',
                    padding: '20px',
                    textAlign: 'center'
                }}>
                    {!isFailed ? (
                        <div className="loading-spinner" style={{
                            width: '40px',
                            height: '40px',
                            border: '4px solid var(--border-color)',
                            borderTop: '4px solid #c81e51',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                        }}/>
                    ) : (
                        <div style={{color: '#e81123', fontSize: '24px', marginBottom: '10px'}}>⚠️</div>
                    )}
                    <div style={{fontWeight: 'bold', maxWidth: '80%', wordBreak: 'break-word'}}>
                        {status}
                        {countdown !== null && (
                            <div style={{fontSize: '0.9em', opacity: 0.7, marginTop: '5px'}}>
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
                            style={{
                                padding: '10px 20px',
                                background: '#c81e51',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                marginTop: '10px'
                            }}
                        >
                            {status === 'SSH-соединение закрыто' ? 'Переподключиться' : 'Попробовать снова'}
                        </button>
                    )}
                </div>
            )}
            <div ref={termRef} key={retryKey} style={{flex: 1, minHeight: 0}}/>
            <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
        </div>
    );
};
