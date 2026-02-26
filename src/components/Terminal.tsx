import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import '@xterm/xterm/css/xterm.css';

const { ipcRenderer } = window as any;

interface Props {
  id: number;
  theme: string;
  config: any;
  terminalFontName: string;
  terminalFontSize: number;
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

export const TerminalComponent: React.FC<Props> = ({ id, theme, config, terminalFontName, terminalFontSize }) => {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [, setStatus] = useState<string>('Connecting...');

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
    fitAddon.fit();

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

    const onOutput = (data: string) => term.write(data);
    const onStatus = (data: string) => setStatus(data);
    const onError = (data: string) => {
      term.write(`\r\n\x1b[31mError: ${data}\x1b[0m\r\n`);
      setStatus(`Error: ${data}`);
    };

    const unsubOutput = ipcRenderer.on(`ssh-output-${id}`, onOutput);
    const unsubStatus = ipcRenderer.on(`ssh-status-${id}`, onStatus);
    const unsubError = ipcRenderer.on(`ssh-error-${id}`, onError);

    ipcRenderer.send('ssh-connect', { id, config, cols: term.cols, rows: term.rows });

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
      fitAddonRef.current?.fit();
    }
  }, [theme, terminalFontName, terminalFontSize]);

  return (
    <div className="terminal-container" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div ref={termRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
};
