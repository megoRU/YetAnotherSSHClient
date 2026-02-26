import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface Props {
  theme: 'light' | 'dark' | 'gruvbox-light';
  config: {
    host: string;
    port: number;
    username: string;
    password?: string;
  } | null;
}

const getXtermTheme = (theme: string) => {
  switch (theme) {
    case 'dark':
      return {
        background: '#1e1e1e',
        foreground: '#cfcfcf',
        cursor: '#cfcfcf',
      };
    case 'gruvbox-light':
      return {
        background: '#fbf1c7',
        foreground: '#3c3836',
        cursor: '#3c3836',
      };
    case 'light':
    default:
      return {
        background: '#ffffff',
        foreground: '#000000',
        cursor: '#000000',
      };
  }
};

export const TerminalComponent: React.FC<Props> = ({ theme, config }) => {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<string>('Not Connected');

  useEffect(() => {
    if (!termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      theme: getXtermTheme(theme),
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const handleResize = () => {
      fitAddon.fit();
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows
        }));
      }
    };

    window.addEventListener('resize', handleResize);

    term.onData(data => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }));
      }
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getXtermTheme(theme);
    }
  }, [theme]);

  useEffect(() => {
    if (!config) return;

    if (wsRef.current) {
      wsRef.current.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ssh-ws`;
    console.log('Connecting to WebSocket:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setStatus('Connecting via SSH...');
      ws.send(JSON.stringify({
        type: 'connect',
        ...config,
        cols: xtermRef.current?.cols,
        rows: xtermRef.current?.rows
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output') {
        xtermRef.current?.write(msg.data);
      } else if (msg.type === 'status') {
        setStatus(msg.data);
      } else if (msg.type === 'error') {
        xtermRef.current?.write(`\r\n\x1b[31mError: ${msg.data}\x1b[0m\r\n`);
        setStatus(`Error: ${msg.data}`);
      }
    };

    ws.onclose = () => {
      setStatus('Disconnected');
    };

    return () => {
      ws.close();
    };
  }, [config]);

  return (
    <div className="terminal-container" style={{ width: '100%', height: 'calc(100vh - 200px)', padding: '10px', textAlign: 'left' }}>
      <div style={{ marginBottom: '5px' }}>Status: {status}</div>
      <div ref={termRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};
