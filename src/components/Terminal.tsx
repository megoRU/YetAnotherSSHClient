import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

const { ipcRenderer } = window as any;

interface Props {
  id: number;
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

  const connect = () => {
    if (!xtermRef.current) return;
    setStatus('Connecting...');
    ipcRenderer.send('ssh-connect', { id, config, cols: xtermRef.current.cols, rows: xtermRef.current.rows });
  };

  useEffect(() => {
    if (!termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
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
    setTimeout(() => {
      fitAddon.fit();
      ipcRenderer.send('ssh-resize', { id, cols: term.cols, rows: term.rows });
    }, 250);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const handleResize = () => {
      fitAddon.fit();
      ipcRenderer.send('ssh-resize', { id, cols: term.cols, rows: term.rows });
    };

    window.addEventListener('resize', handleResize);

    term.onData(data => {
      ipcRenderer.send('ssh-input', { id, data });
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

    const onOutput = (data: string) => term.write(data);
    const onStatus = (data: string) => setStatus(data);
    const onError = (data: string) => {
      term.write(`\r\n\x1b[31mError: ${data}\x1b[0m\r\n`);
      setStatus(`Error: ${data}`);
    };

    const unsubOutput = ipcRenderer.on(`ssh-output-${id}`, onOutput);
    const unsubStatus = ipcRenderer.on(`ssh-status-${id}`, onStatus);
    const unsubError = ipcRenderer.on(`ssh-error-${id}`, onError);

    connect();

    return () => {
      window.removeEventListener('resize', handleResize);
      ipcRenderer.send('ssh-close', id);
      unsubOutput();
      unsubStatus();
      unsubError();
      term.dispose();
    };
  }, []);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getXtermTheme(theme);
      xtermRef.current.options.fontFamily = terminalFontName;
      xtermRef.current.options.fontSize = terminalFontSize;
      if (visible) {
        fitAddonRef.current?.fit();
      }
    }
  }, [theme, terminalFontName, terminalFontSize, visible]);

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
                setKey(prev => prev + 1);
                connect();
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
