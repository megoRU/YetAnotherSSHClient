import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Server, Power } from 'lucide-react';
import { CustomSelect } from '../../layout/CustomSelect';
import type { AppConfig, NotificationAction, NotificationType } from '../../../types';

interface McpStatus {
    enabled: boolean;
    running: boolean;
    port: number;
    connectedAgents: number;
    token: string;
    requireConfirmation: boolean;
    allowedServerIds: string[];
}
import { useI18n } from '../../../utils/i18n';
import { getOSIcon } from '../../../utils';

const { ipcRenderer } = window;

interface McpSectionProps {
    config: AppConfig;
    setConfig: (config: AppConfig) => void;
    showNotification: (title: string, message: string, type?: NotificationType, action?: NotificationAction) => void;
}

export const McpSection: React.FC<McpSectionProps> = ({ config, setConfig, showNotification }) => {
    const { t } = useI18n(config.language);
    const [mcpStatus, setMcpStatus] = useState<McpStatus>({
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
        const unsub = ipcRenderer?.onMcpStatusChanged?.((status: McpStatus) => {
            setMcpStatus(status);
        });
        Promise.resolve().then(() => {
            void fetchStatus();
        });
        return () => {
            if (typeof unsub === 'function') unsub();
        };
    }, [fetchStatus]);

    const handleToggleMcp = async () => {
        const nextState = !mcpStatus.enabled;
        setConfig({ ...config, mcpEnabled: nextState });
        if (ipcRenderer?.mcpToggle) {
            const status = (await ipcRenderer.mcpToggle(nextState)) as McpStatus;
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
            const status = (await ipcRenderer.mcpToggle(true)) as McpStatus;
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
        const status = (await ipcRenderer.mcpRegenerateToken()) as McpStatus;
        setMcpStatus(status);
        setConfig({ ...config, mcpToken: status.token });
        showNotification(t('common.success'), t('mcp.tokenRegenerated'), 'success');
    };

    const handleCloseServerAccess = async (serverId: string) => {
        if (!serverId) return;
        if (ipcRenderer?.mcpCloseServer) {
            const status = (await ipcRenderer.mcpCloseServer(serverId)) as McpStatus;
            setMcpStatus(status);
        }
        const updatedServerIds = (config.mcpAllowedServerIds || []).filter(id => id !== serverId);
        setConfig({
            ...config,
            mcpAllowedServerIds: updatedServerIds
        });
    };

    const allowedFavorites = useMemo(() => {
        const allowedSet = new Set(mcpStatus.allowedServerIds || config.mcpAllowedServerIds || []);
        return (config.favorites || []).filter(fav => fav.id && allowedSet.has(fav.id));
    }, [config.favorites, config.mcpAllowedServerIds, mcpStatus.allowedServerIds]);

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
                                    ? t('mcp.statusRunning')
                                    : t('mcp.statusStarting'))
                                : t('mcp.statusDisabled')}
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
                            <label>{t('mcp.serverPort')}</label>
                            <div className="settings-description">
                                {t('mcp.serverPortDesc')}
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
                            <label>{t('mcp.requireConfirmation')}</label>
                            <div className="settings-description">
                                {t('mcp.requireConfirmationDesc')}
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
                            <label>{t('mcp.accessToken')}</label>
                            <div className="settings-description">
                                {t('mcp.accessTokenDesc')}
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
                                title={t('mcp.regenerateToken')}
                                style={{ height: '36px', cursor: 'pointer' }}
                            >
                                {t('mcp.regenerate')}
                            </button>
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('mcp.clientConfigTitle')}</label>
                            <div className="settings-description">
                                {t('mcp.clientConfigDesc')}
                            </div>
                        </div>
                        <button
                            className="btn-secondary settings-select-fixed"
                            onClick={() => copyToClipboard(JSON.stringify(jsonClientConfig, null, 2), setCopiedConfig)}
                            style={{ height: '36px', cursor: 'pointer', flexShrink: 0 }}
                        >
                            {copiedConfig ? t('common.copied') : t('mcp.copyConfig')}
                        </button>
                    </div>

                    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
                        <div className="settings-label-container">
                            <label>{t('mcp.allowedServersListTitle')}</label>
                        </div>
                        {allowedFavorites.length === 0 ? (
                            <div className="settings-description" style={{
                                padding: '16px',
                                background: 'var(--surface)',
                                borderRadius: '8px',
                                border: '1px solid var(--border)',
                                color: 'var(--text-secondary)'
                            }}>
                                {t('mcp.noAllowedServers')}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {allowedFavorites.map(fav => (
                                    <div
                                        key={fav.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '12px 16px',
                                            borderRadius: '8px',
                                            background: 'var(--surface)',
                                            border: '1px solid var(--border)',
                                            gap: '12px'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                                            <div style={{ width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                {fav.osPrettyName ? (
                                                    <img
                                                        src={getOSIcon(fav.osPrettyName)}
                                                        alt={fav.osPrettyName}
                                                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                                        draggable="false"
                                                    />
                                                ) : (
                                                    <Server size={18} style={{ color: 'var(--text-secondary)' }} />
                                                )}
                                            </div>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                                                        {fav.name || fav.host}
                                                    </span>
                                                    <span style={{
                                                        fontSize: '0.75rem',
                                                        padding: '2px 8px',
                                                        borderRadius: '12px',
                                                        background: 'rgba(46, 160, 67, 0.15)',
                                                        color: '#2ea44f',
                                                        fontWeight: 500,
                                                        flexShrink: 0
                                                    }}>
                                                        {t('mcp.serverAllowed')}
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                    {fav.user}@{fav.host}:{fav.port || 22}
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            className="btn-danger"
                                            onClick={() => handleCloseServerAccess(fav.id!)}
                                            style={{
                                                height: '34px',
                                                padding: '0 12px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                fontSize: '0.85rem',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                flexShrink: 0
                                            }}
                                        >
                                            <Power size={14} />
                                            {t('mcp.closeAccess')}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                        <div className="settings-label-container">
                            <label>{t('mcp.howToUseTitle')}</label>
                            <div className="settings-description" style={{ marginTop: '6px' }}>
                                <ol style={{ margin: 0, paddingLeft: '18px' }}>
                                    <li>{t('mcp.step1')}</li>
                                    <li>{t('mcp.step2')}</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
