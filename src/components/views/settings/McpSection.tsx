import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { CustomSelect } from '../../layout/CustomSelect';
import type { AppConfig, NotificationAction, NotificationType } from '../../../types';
import { useI18n } from '../../../utils/i18n';

const { ipcRenderer } = window;

interface McpSectionProps {
    config: AppConfig;
    setConfig: (config: AppConfig) => void;
    showNotification: (title: string, message: string, type?: NotificationType, action?: NotificationAction) => void;
}

export const McpSection: React.FC<McpSectionProps> = ({ config, setConfig, showNotification }) => {
    const { t } = useI18n(config.language);
    const [mcpStatus, setMcpStatus] = useState<{
        enabled: boolean;
        running: boolean;
        port: number;
        connectedAgents: number;
        token: string;
        requireConfirmation: boolean;
        allowedServerIds: string[];
    }>({
        enabled: config.mcpEnabled || false,
        running: false,
        port: config.mcpPort || 3000,
        connectedAgents: 0,
        token: config.mcpToken || '',
        requireConfirmation: config.mcpRequireConfirmation ?? true,
        allowedServerIds: config.mcpAllowedServerIds || []
    });

    const [copiedToken, setCopiedToken] = useState(false);
    const [copiedConfig, setCopiedConfig] = useState(false);

    const fetchStatus = useCallback(async () => {
        if (!ipcRenderer?.mcpGetStatus) return;
        try {
            const status = await ipcRenderer.mcpGetStatus();
            setMcpStatus(status);
        } catch (e) {
            console.error('[MCP] Failed to get status:', e);
        }
    }, []);

    useEffect(() => {
        fetchStatus();
        const unsub = ipcRenderer?.onMcpStatusChanged?.((status: any) => {
            setMcpStatus(status);
        });
        return () => {
            if (typeof unsub === 'function') unsub();
        };
    }, [fetchStatus]);

    const handleToggleMcp = async () => {
        const nextState = !mcpStatus.enabled;
        setConfig({ ...config, mcpEnabled: nextState });
        if (ipcRenderer?.mcpToggle) {
            const status: any = await ipcRenderer.mcpToggle(nextState);
            setMcpStatus(status);
        }
    };

    const handleToggleConfirmation = async () => {
        const nextState = !config.mcpRequireConfirmation;
        const newConfig = { ...config, mcpRequireConfirmation: nextState };
        setConfig(newConfig);
        setMcpStatus(prev => ({ ...prev, requireConfirmation: nextState }));
        await ipcRenderer?.saveConfig?.(newConfig);
    };

    const handlePortChange = async (newPortStr: string) => {
        const newPort = parseInt(newPortStr, 10) || 3000;
        const newConfig = { ...config, mcpPort: newPort };
        setConfig(newConfig);
        setMcpStatus(prev => ({ ...prev, port: newPort }));
        await ipcRenderer?.saveConfig?.(newConfig);
        if (mcpStatus.enabled && ipcRenderer?.mcpToggle) {
            const status: any = await ipcRenderer.mcpToggle(true);
            setMcpStatus(status);
        }
    };

    const portOptions = useMemo(() => [
        { value: '3000', label: '3000' },
        { value: '3001', label: '3001' },
        { value: '3002', label: '3002' },
        { value: '8080', label: '8080' },
        { value: '8081', label: '8081' },
        { value: '9000', label: '9000' }
    ], []);

    const handleRegenerateToken = async () => {
        if (!ipcRenderer?.mcpRegenerateToken) return;
        const status: any = await ipcRenderer.mcpRegenerateToken();
        setMcpStatus(status);
        setConfig({ ...config, mcpToken: status.token });
        showNotification(t('common.success'), t('mcp.tokenRegenerated') || 'Token regenerated successfully', 'success');
    };

    const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const mcpEndpoint = `http://127.0.0.1:${mcpStatus.port || 3000}`;

    const jsonClientConfig = {
        mcpServers: {
            "yassh-ssh-bridge": {
                command: "npx",
                args: [
                    "-y",
                    "@modelcontextprotocol/server-fetch",
                    `${mcpEndpoint}/sse`,
                    "--header",
                    `Authorization: Bearer ${mcpStatus.token}`
                ]
            }
        }
    };

    return (
        <div className="settings-section-page">
            <div className="settings-section-header">
                <h2 className="settings-section-title">{t('mcp.title')}</h2>
                <div className="settings-section-subtitle">{t('mcp.subtitle')}</div>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('mcp.enableNow')}</label>
                    <div className="settings-description" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {mcpStatus.enabled && mcpStatus.running && (
                            <span style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: '#2ea44f',
                                boxShadow: '0 0 8px #2ea44f',
                                display: 'inline-block'
                            }} />
                        )}
                        <span>
                            {mcpStatus.enabled
                                ? (mcpStatus.running
                                    ? `${t('mcp.statusRunning') || 'MCP Server Active'} (http://127.0.0.1:${mcpStatus.port})`
                                    : t('mcp.statusStarting') || 'Starting server...')
                                : t('mcp.statusDisabled') || 'MCP Server Disabled'}
                        </span>
                    </div>
                </div>
                <label className="ui-switch">
                    <input
                        type="checkbox"
                        checked={mcpStatus.enabled}
                        onChange={handleToggleMcp}
                    />
                    <span className="ui-slider"></span>
                </label>
            </div>

            {mcpStatus.enabled && (
                <>
                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('mcp.serverPort') || 'MCP Server Port'}</label>
                            <div className="settings-description">
                                {t('mcp.serverPortDesc') || 'HTTP/SSE server port for AI agent connections (3000 default).'}
                            </div>
                        </div>
                        <CustomSelect
                            value={String(mcpStatus.port || 3000)}
                            onChange={handlePortChange}
                            options={portOptions}
                            className="settings-select-fixed"
                        />
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('mcp.requireConfirmation') || 'Require Confirmation for Command Execution'}</label>
                            <div className="settings-description">
                                {t('mcp.requireConfirmationDesc') || 'Prompt user in UI before executing any shell command from AI agent.'}
                            </div>
                        </div>
                        <label className="ui-switch">
                            <input
                                type="checkbox"
                                checked={mcpStatus.requireConfirmation}
                                onChange={handleToggleConfirmation}
                            />
                            <span className="ui-slider"></span>
                        </label>
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('mcp.accessToken') || 'Access Token'}</label>
                            <div className="settings-description">
                                {t('mcp.accessTokenDesc') || 'Bearer Token for request authorization.'}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button
                                className="btn-secondary settings-select-fixed"
                                onClick={() => copyToClipboard(mcpStatus.token, setCopiedToken)}
                                style={{ height: '36px', cursor: 'pointer' }}
                            >
                                {copiedToken ? t('common.copied') : t('common.copy')}
                            </button>
                            <button
                                className="btn-secondary settings-select-fixed"
                                onClick={handleRegenerateToken}
                                title={t('mcp.regenerateToken') || 'Regenerate token'}
                                style={{ height: '36px', cursor: 'pointer' }}
                            >
                                {t('mcp.regenerate') || 'Reset'}
                            </button>
                        </div>
                    </div>

                    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div className="settings-label-container">
                                <label>{t('mcp.clientConfigTitle') || 'External MCP Client Configuration'}</label>
                                <div className="settings-description">
                                    {t('mcp.clientConfigDesc') || 'Paste this configuration into your MCP client (e.g. Claude Desktop claude_desktop_config.json):'}
                                </div>
                            </div>
                            <button
                                className="btn-secondary settings-select-fixed"
                                onClick={() => copyToClipboard(JSON.stringify(jsonClientConfig, null, 2), setCopiedConfig)}
                                style={{ height: '36px', cursor: 'pointer', flexShrink: 0 }}
                            >
                                {copiedConfig ? t('common.copied') : t('mcp.copyConfig') || 'Copy Client JSON'}
                            </button>
                        </div>

                        <pre style={{
                            margin: 0,
                            padding: '12px',
                            borderRadius: '8px',
                            background: 'var(--hover-surface)',
                            color: 'var(--text-primary)',
                            fontFamily: 'var(--mono-font-family)',
                            fontSize: 'var(--ui-font-size)',
                            overflowX: 'auto',
                            border: '1px solid var(--border)'
                        }}>
                            <code>{JSON.stringify(jsonClientConfig, null, 2)}</code>
                        </pre>
                    </div>

                    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                        <div className="settings-label-container">
                            <label>{t('mcp.howToUseTitle') || 'How to allow SSH servers for AI Agent:'}</label>
                            <div className="settings-description" style={{ marginTop: '6px' }}>
                                <ol style={{ margin: 0, paddingLeft: '18px' }}>
                                    <li>{t('mcp.step1') || 'Go to Servers list on Home page or Sidebar.'}</li>
                                    <li>{t('mcp.step2') || 'Right-click on the server and select "Open for MCP".'}</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
