import React, { useEffect, useRef, useState } from 'react';
import { Terminal as IconTerminal, Plug, Loader2 } from 'lucide-react';
import { getXtermTheme } from '../utils/theme';
import { getOSIcon } from '../utils';
import { useI18n } from '../utils/i18n';
import type { SSHConfig, AppConfig } from '../types';
import { TerminalEngine } from '../terminal/core/TerminalEngine';
import type { TerminalOptions } from '../terminal/types';

const { ipcRenderer } = window;
interface Props { theme: string; config: SSHConfig; terminalFontName: string; terminalFontSize: number; terminalScrollSensitivity: number; id: string; visible?: boolean; keywordHighlighting: boolean; onOSInfo?: (osInfo: string) => void; enableContextMenu?: boolean; onEditConfig?: (config: SSHConfig) => void; onClose?: () => void; appConfig?: AppConfig; }

export const TerminalComponent: React.FC<Props> = ({ theme, config, terminalFontName, terminalFontSize, terminalScrollSensitivity, visible, onOSInfo, enableContextMenu, onClose, appConfig }) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    const containerRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<TerminalEngine | null>(null);
    const connIdRef = useRef<string | null>(null);
    const isConnectedRef = useRef<boolean>(false);
    const [status, setStatus] = useState<string>(t('terminal.connecting'));

    useEffect(() => {
        if (!containerRef.current) {
            return;
        }
        const options: TerminalOptions = {
            fontFamily: `'${terminalFontName}', 'JetBrains Mono', monospace`,
            fontSize: terminalFontSize,
            lineHeight: 1,
            letterSpacing: 0,
            scrollback: 50000,
            scrollSensitivity: terminalScrollSensitivity,
            theme: getXtermTheme(theme)
        };
        const id = Math.random().toString(36).slice(2);
        connIdRef.current = id;
        const engine = new TerminalEngine(containerRef.current, options, {
            onInput: (value: string) => { ipcRenderer?.sshInput?.({ id, data: value }); },
            onResize: (columns: number, rows: number) => { ipcRenderer?.sshResize?.({ id, cols: columns, rows }); }
        });
        engineRef.current = engine;

        const resizeObserver = new ResizeObserver(() => {
            if (!containerRef.current || !engineRef.current) {
                return;
            }
            const rect = containerRef.current.getBoundingClientRect();
            const size = engineRef.current.resize(rect.width, rect.height);
            if (!isConnectedRef.current) {
                ipcRenderer?.sshConnect?.({ id, config, cols: size.cols, rows: size.rows });
                isConnectedRef.current = true;
            }
        });
        resizeObserver.observe(containerRef.current);

        const unsubOutput = ipcRenderer?.onSSHOutput?.(id, (data: Uint8Array) => {
            const text = new TextDecoder().decode(data);
            engine.write(text);
        });
        const unsubStatus = ipcRenderer?.onSSHStatus?.(id, (newStatus: string) => { setStatus(newStatus); });
        const unsubError = ipcRenderer?.onSSHError?.(id, (error: string) => { setStatus(error); engine.write(`\r\nERROR: ${error}\r\n`); });
        const unsubOSInfo = ipcRenderer?.onSSHOSInfo?.(id, (info: string) => { if (onOSInfo) { onOSInfo(info); } });

        return () => {
            resizeObserver.disconnect();
            ipcRenderer?.sshClose?.(id);
            isConnectedRef.current = false;
            if (typeof unsubOutput === 'function') { unsubOutput(); }
            if (typeof unsubStatus === 'function') { unsubStatus(); }
            if (typeof unsubError === 'function') { unsubError(); }
            if (typeof unsubOSInfo === 'function') { unsubOSInfo(); }
            engine.destroy();
        };
    }, [config, onOSInfo, terminalFontName, terminalFontSize, terminalScrollSensitivity, theme, t]);

    useEffect(() => {
        if (!engineRef.current) { return; }
        const options: TerminalOptions = { fontFamily: `'${terminalFontName}', 'JetBrains Mono', monospace`, fontSize: terminalFontSize, lineHeight: 1, letterSpacing: 0, scrollback: 50000, scrollSensitivity: terminalScrollSensitivity, theme: getXtermTheme(theme) };
        engineRef.current.updateOptions(options);
    }, [terminalFontName, terminalFontSize, terminalScrollSensitivity, theme]);

    useEffect(() => {
        if (visible) { engineRef.current?.focus(); }
    }, [visible]);

    return <div className="terminal-container" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', paddingLeft: '15px', paddingTop: '10px', paddingBottom: '20px', boxSizing: 'border-box', backgroundColor: getXtermTheme(theme).background, overflow: 'hidden' }} onContextMenu={(event) => { if (!enableContextMenu) { return; } event.preventDefault(); navigator.clipboard.readText().then((value: string) => { if (value.length > 0 && connIdRef.current) { ipcRenderer?.sshInput?.({ id: connIdRef.current, data: value }); } }); }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%', outline: 'none' }} />
        {(status === t('terminal.connecting') || status === 'Connecting...' || status === 'Соединение...') && <div className="connection-overlay loading"><div className="connection-container"><div className="server-info-card"><div className="os-icon-wrapper"><img src={getOSIcon(config.osPrettyName)} alt="OS" /></div><div className="server-details"><div className="server-name">{config.name || config.host}</div></div></div><div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><Loader2 size={20} className="spin" />{t('terminal.connecting')}</div><div>{onClose && <button onClick={onClose}><Plug size={16} />{t('common.close')}</button>}</div></div></div>}
        {(status === t('terminal.connected') || status === 'Connected' || status === 'Установлено соединение') && <div style={{ position: 'absolute', right: 16, top: 16, display: 'flex', alignItems: 'center', gap: 6, opacity: 0.7 }}><IconTerminal size={14} />{t('terminal.connected')}</div>}
    </div>;
};
