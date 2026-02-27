import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

const { ipcRenderer } = window as any;

interface Props {
  id: string;
  theme: string;
  config: any;
  terminalFontName: string;
  terminalFontSize: number;
  visible?: boolean;
}

const getXtermTheme = (theme: string) => {
  switch (theme) {
    case 'Dark':
      return {
        background: '#1e1e1e',
        foreground: '#cfcfcf',
        cursor: '#cfcfcf',
      };
    case 'Gruvbox Light':
      return {
        background: '#fbf1c7',
        foreground: '#3c3836',
        cursor: '#3c3836',
      };
    case 'Light':
    default:
      return {
        background: '#ffffff',
        foreground: '#000000',
        cursor: '#000000',
      };
  }
};

export const TerminalComponent: React.FC<Props> = ({ id, theme, config, terminalFontName, terminalFontSize, visible }) => {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<string>('Connecting...');
  const [key, setKey] = useState<number>(0);
  const connectionInitiatedRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  const safeFit = () => {
    if (isMountedRef.current && xtermRef.current && fitAddonRef.current) {
      try {
        fitAddonRef.current.fit();
        ipcRenderer.send('ssh-resize', { id, cols: xtermRef.current.cols, rows: xtermRef.current.rows });
      } catch (e) {
        console.warn('[Terminal] fit() failed:', e);
      }
    }
  };

  const connect = (connId: string) => {
    if (!xtermRef.current || connectionInitiatedRef.current) return;
    connectionInitiatedRef.current = true;
    setStatus('Connecting...');
    console.log(`[SSH] Renderer requesting connection [ConnID: ${connId}]`, {
      user: config.user,
      host: config.host,
      port: config.port
    });
    ipcRenderer.send('ssh-connect', { id: connId, config, cols: xtermRef.current.cols, rows: xtermRef.current.rows });
  };

  useEffect(() => {
    if (!termRef.current) return;
    const connId = Math.random().toString(36).substring(2, 15);
    isMountedRef.current = true;
    let fitTimeout: any = null;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      theme: getXtermTheme(theme),
      fontFamily: terminalFontName,
      fontSize: terminalFontSize,
      allowProposedApi: true,
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

    // Add a small delay to ensure container is properly sized
    fitTimeout = setTimeout(() => {
      if (isMountedRef.current) {
        safeFit();
      }
    }, 250);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const handleResize = () => {
      safeFit();
      if (xtermRef.current) {
        ipcRenderer.send('ssh-resize', { id: connId, cols: xtermRef.current.cols, rows: xtermRef.current.rows });
      }
    };

    window.addEventListener('resize', handleResize);

    term.onData(data => {
      ipcRenderer.send('ssh-input', { id: connId, data });
    });

    term.onKey(e => {
      // Ctrl+Shift+C (67 is the code for 'C')
      if (e.domEvent.ctrlKey && e.domEvent.shiftKey && e.domEvent.keyCode === 67) {
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
        }
        e.domEvent.preventDefault();
      }
    });

    const onOutput = (data: string) => {
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
      }
    };
    const onError = (data: string) => {
      if (isMountedRef.current) {
        console.error(`[SSH Error ID: ${id}] ${data}`);
        try {
          term.write(`\r\n\x1b[31mError: ${data}\x1b[0m\r\n`);
        } catch (e) {
          // ignore
        }
        setStatus(`Error: ${data}`);
      }
    };

    const unsubOutput = ipcRenderer.on(`ssh-output-${connId}`, onOutput);
    const unsubStatus = ipcRenderer.on(`ssh-status-${connId}`, onStatus);
    const unsubError = ipcRenderer.on(`ssh-error-${connId}`, onError);

    connect(connId);

    return () => {
      console.log(`[SSH] Cleaning up Terminal for ConnID: ${connId}`);
      isMountedRef.current = false;
      if (fitTimeout) clearTimeout(fitTimeout);
      window.removeEventListener('resize', handleResize);
      ipcRenderer.send('ssh-close', connId);
      unsubOutput();
      unsubStatus();
      unsubError();
      try {
        term.dispose();
      } catch (e) {
        console.warn('[Terminal] dispose failed:', e);
      }
    };
  }, []);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getXtermTheme(theme);
      xtermRef.current.options.fontFamily = terminalFontName;
      xtermRef.current.options.fontSize = terminalFontSize;
    }
  }, [theme, terminalFontName, terminalFontSize]);

  useEffect(() => {
    if (visible && isMountedRef.current) {
      safeFit();
    }
  }, [visible]);

  return (
    <div className="terminal-container" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {status !== 'SSH Connection Established' && (
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
          {!status.includes('Error') ? (
            <div className="loading-spinner" style={{
              width: '40px',
              height: '40px',
              border: '4px solid var(--border-color)',
              borderTop: '4px solid #c81e51',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
          ) : (
            <div style={{ color: '#e81123', fontSize: '24px', marginBottom: '10px' }}>⚠️</div>
          )}
          <div style={{ fontWeight: 'bold', maxWidth: '80%', wordBreak: 'break-word' }}>{status}</div>
          {status.includes('Error') && (
            <button
              onClick={() => {
                connectionInitiatedRef.current = false;
                setKey(prev => prev + 1);
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
              Попробовать снова
            </button>
          )}
        </div>
      )}
      <div ref={termRef} key={key} style={{ flex: 1, minHeight: 0 }} />
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
