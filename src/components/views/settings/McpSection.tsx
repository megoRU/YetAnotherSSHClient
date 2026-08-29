import React, { useState, useEffect, useCallback } from 'react';
import { Server, RefreshCw, Copy, Check, Shield, Bot, Terminal, Globe, AlertCircle } from 'lucide-react';
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

                {/* Status Indicator Bar */}
                <div style={{
                    marginTop: '20px',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    background: mcpStatus.enabled ? (mcpStatus.running ? 'rgba(46, 160, 67, 0.1)' : 'rgba(217, 130, 43, 0.1)') : 'var(--hover-surface)',
                    border: `1px solid ${mcpStatus.enabled ? (mcpStatus.running ? 'rgba(46, 160, 67, 0.3)' : 'rgba(217, 130, 43, 0.3)') : 'var(--border)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            background: mcpStatus.enabled ? (mcpStatus.running ? '#2ea44f' : '#d9822b') : 'var(--text-secondary)'
                        }} />
                        <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                            {mcpStatus.enabled
                                ? (mcpStatus.running
                                    ? `${t('mcp.statusRunning') || 'MCP Server Active'} (http://127.0.0.1:${mcpStatus.port})`
                                    : t('mcp.statusStarting') || 'Starting server...')
                                : t('mcp.statusDisabled') || 'MCP Server Disabled'}
                        </span>
                    </div>

                    {mcpStatus.enabled && mcpStatus.running && (
                        <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            <div>
                                {t('mcp.connectedAgents') || 'Connected Agents'}: <strong style={{ color: 'var(--accent)' }}>{mcpStatus.connectedAgents}</strong>
                            </div>
                            <div>
                                {t('mcp.allowedServersCount') || 'Open SSH Servers'}: <strong style={{ color: 'var(--accent)' }}>{mcpStatus.allowedServerIds.length}</strong>
                            </div>
                        </div>
                    )}
                </div>

            {/* Main Config Cards when Enabled */}
            {mcpStatus.enabled && (
                <>
                    {/* Security & Access Controls */}
                    <div className="setting-card" style={{ padding: '20px', background: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                        <h4 style={{ margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                            <Shield size={18} style={{ color: 'var(--accent)' }} />
                            {t('mcp.securityTitle') || 'Security & Command Approvals'}
                        </h4>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div>
                                    <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                                        {t('mcp.requireConfirmation') || 'Require Confirmation for Command Execution'}
                                    </div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
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

                            {/* Token Box */}
                            <div style={{
                                marginTop: '8px',
                                padding: '12px',
                                borderRadius: '8px',
                                background: 'var(--hover-surface)',
                                border: '1px solid var(--border)'
                            }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                                    {t('mcp.accessToken') || 'Bearer Access Token'}
                                </div>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <input
                                        type="password"
                                        readOnly
                                        value={mcpStatus.token}
                                        style={{
                                            flex: 1,
                                            padding: '6px 12px',
                                            borderRadius: '6px',
                                            border: '1px solid var(--border)',
                                            background: 'var(--background)',
                                            color: 'var(--text-primary)',
                                            fontFamily: 'var(--mono-font-family)',
                                            fontSize: '0.85rem'
                                        }}
                                    />
                                    <button
                                        className="btn-secondary"
                                        onClick={() => copyToClipboard(mcpStatus.token, setCopiedToken)}
                                        style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
                                    >
                                        {copiedToken ? <Check size={14} color="#2ea44f" /> : <Copy size={14} />}
                                        {copiedToken ? t('common.copied') : t('common.copy')}
                                    </button>
                                    <button
                                        className="btn-secondary"
                                        onClick={handleRegenerateToken}
                                        title={t('mcp.regenerateToken') || 'Regenerate token'}
                                        style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
                                    >
                                        <RefreshCw size={14} />
                                        {t('mcp.regenerate') || 'Reset'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Client Configuration Snippet */}
                    <div className="setting-card" style={{ padding: '20px', background: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                                <Terminal size={18} style={{ color: 'var(--accent)' }} />
                                {t('mcp.clientConfigTitle') || 'External MCP Client Configuration'}
                            </h4>
                            <button
                                className="btn-primary"
                                onClick={() => copyToClipboard(JSON.stringify(jsonClientConfig, null, 2), setCopiedConfig)}
                                style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
                            >
                                {copiedConfig ? <Check size={14} /> : <Copy size={14} />}
                                {copiedConfig ? t('common.copied') : t('mcp.copyConfig') || 'Copy Client JSON'}
                            </button>
                        </div>

                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
                            {t('mcp.clientConfigDesc') || 'Paste this configuration into your MCP client (e.g. Claude Desktop claude_desktop_config.json):'}
                        </p>

                        <pre style={{
                            margin: 0,
                            padding: '12px',
                            borderRadius: '8px',
                            background: 'var(--code-block-bg, #1a1a1a)',
                            color: '#e6e6e6',
                            fontFamily: 'var(--mono-font-family)',
                            fontSize: '0.85rem',
                            overflowX: 'auto',
                            border: '1px solid var(--border)'
                        }}>
                            <code>{JSON.stringify(jsonClientConfig, null, 2)}</code>
                        </pre>
                    </div>

                    {/* Instructions Card */}
                    <div style={{
                        padding: '16px',
                        borderRadius: '10px',
                        background: 'rgba(var(--accent-rgb), 0.05)',
                        border: '1px solid rgba(var(--accent-rgb), 0.2)',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px'
                    }}>
                        <AlertCircle size={20} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '2px' }} />
                        <div style={{ fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                            <strong>{t('mcp.howToUseTitle') || 'How to allow SSH servers for AI Agent:'}</strong>
                            <ol style={{ margin: '6px 0 0 0', paddingLeft: '18px' }}>
                                <li>{t('mcp.step1') || 'Go to Servers list on Home page or Sidebar.'}</li>
                                <li>{t('mcp.step2') || 'Right-click on the server and select "Open for MCP".'}</li>
                                <li>{t('mcp.step3') || 'An active MCP session tab will open displaying live command execution logs and agent activities.'}</li>
                            </ol>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
