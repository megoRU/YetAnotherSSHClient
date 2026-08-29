import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Power, Terminal, AlertTriangle, Clock, CheckCircle2, XCircle, Loader2, Sparkles } from 'lucide-react';
import type { AppConfig, SSHConfig } from '../types';
import { useI18n } from '../utils/i18n';

const { ipcRenderer } = window;

interface McpLogItem {
    id: string;
    timestamp: number;
    connectionId: string;
    action: string;
    command?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    error?: string;
    status: 'pending' | 'approved' | 'rejected' | 'running' | 'success' | 'failed';
}

interface McpTabProps {
    config: SSHConfig;
    appConfig: AppConfig;
    onClose: () => void;
    onAppConfigUpdate: (config: AppConfig) => void;
}

interface McpStatus {
    enabled: boolean;
    running: boolean;
    port: number;
    connectedAgents: number;
    token: string;
    requireConfirmation: boolean;
    allowedServerIds: string[];
    pendingConfirmations?: McpConfirmationRequest[];
}

interface McpConfirmationRequest {
    id: string;
    connectionId: string;
    serverName: string;
    command: string;
}

export const McpTab: React.FC<McpTabProps> = ({ config, appConfig, onClose, onAppConfigUpdate }) => {
    const { t } = useI18n(appConfig.language);
    const [mcpStatus, setMcpStatus] = useState<McpStatus>({
        enabled: appConfig.mcpEnabled || false,
        running: false,
        port: appConfig.mcpPort || 3000,
        connectedAgents: 0,
        token: appConfig.mcpToken || '',
        requireConfirmation: appConfig.mcpRequireConfirmation ?? true,
        allowedServerIds: appConfig.mcpAllowedServerIds || []
    });

    const [logs, setLogs] = useState<McpLogItem[]>([]);
    const [pendingConfirmations, setPendingConfirmations] = useState<McpConfirmationRequest[]>([]);
    const isServerAllowed = mcpStatus.allowedServerIds?.includes(config.id || '');

    const fetchStatus = useCallback(async () => {
        if (!ipcRenderer?.mcpGetStatus) return;
        try {
            const status = (await ipcRenderer.mcpGetStatus()) as McpStatus;
            setMcpStatus(status);
            if (Array.isArray(status.pendingConfirmations)) {
                setPendingConfirmations(
                    status.pendingConfirmations.filter(req => req.connectionId === config.id)
                );
            }
        } catch (e) {
            console.error('[MCP] Failed to get MCP status in tab:', e);
        }
    }, [config.id]);

    useEffect(() => {
        Promise.resolve().then(() => {
            void fetchStatus();

            // Register server as allowed for MCP if not already
            if (config.id && ipcRenderer?.mcpOpenServer) {
                ipcRenderer.mcpOpenServer(config.id).then((status: McpStatus) => {
                    setMcpStatus(status);
                    if (Array.isArray(status.pendingConfirmations)) {
                        setPendingConfirmations(
                            status.pendingConfirmations.filter(req => req.connectionId === config.id)
                        );
                    }
                });
            }
        });

        const unsubStatus = ipcRenderer?.onMcpStatusChanged?.((status: McpStatus) => {
            setMcpStatus(status);
            if (Array.isArray(status.pendingConfirmations)) {
                setPendingConfirmations(
                    status.pendingConfirmations.filter(req => req.connectionId === config.id)
                );
            }
        });

        const unsubLog = ipcRenderer?.onMcpLog?.((log: McpLogItem) => {
            if (log.connectionId === config.id) {
                setLogs(prev => {
                    const existingIndex = prev.findIndex(item => item.id === log.id);
                    if (existingIndex > -1) {
                        const updated = [...prev];
                        updated[existingIndex] = log;
                        return updated;
                    }
                    return [log, ...prev];
                });
            }
        });

        const unsubReq = ipcRenderer?.onMcpRequestConfirmation?.((req: McpConfirmationRequest) => {
            if (req.connectionId === config.id) {
                setPendingConfirmations(prev => [...prev.filter(r => r.id !== req.id), req]);
            }
        });

        return () => {
            if (typeof unsubStatus === 'function') unsubStatus();
            if (typeof unsubLog === 'function') unsubLog();
            if (typeof unsubReq === 'function') unsubReq();
        };
    }, [config.id, fetchStatus]);

    const handleCloseAccess = async () => {
        if (config.id && ipcRenderer?.mcpCloseServer) {
            const status = (await ipcRenderer.mcpCloseServer(config.id)) as McpStatus;
            setMcpStatus(status);
            if (appConfig.mcpAllowedServerIds) {
                onAppConfigUpdate({
                    ...appConfig,
                    mcpAllowedServerIds: appConfig.mcpAllowedServerIds.filter(id => id !== config.id)
                });
            }
        }
        onClose();
    };

    const handleEnableMcpGlobally = async () => {
        if (ipcRenderer?.mcpToggle) {
            const status = (await ipcRenderer.mcpToggle(true)) as McpStatus;
            setMcpStatus(status);
            onAppConfigUpdate({ ...appConfig, mcpEnabled: true });
        }
    };

    const handleConfirm = async (reqId: string, approved: boolean) => {
        if (ipcRenderer?.mcpConfirmCommand) {
            await ipcRenderer.mcpConfirmCommand({ id: reqId, approved });
        }
        setPendingConfirmations(prev => prev.filter(r => r.id !== reqId));
    };


    if (!mcpStatus.enabled) {
        return (
            <div style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px',
                background: 'var(--background)',
                textAlign: 'center'
            }}>
                <div style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '16px',
                    background: 'rgba(217, 130, 43, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#d9822b',
                    marginBottom: '20px'
                }}>
                    <AlertTriangle size={32} />
                </div>
                <h2 style={{ color: 'var(--text-primary)', margin: '0 0 8px 0' }}>
                    {t('mcp.disabledTitle')}
                </h2>
                <p style={{ color: 'var(--text-secondary)', maxWidth: '460px', margin: '0 0 24px 0', lineHeight: 1.5 }}>
                    {t('mcp.disabledDesc')}
                </p>
                <button
                    className="btn-primary"
                    onClick={handleEnableMcpGlobally}
                    style={{ padding: '10px 20px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                    <Power size={18} />
                    {t('mcp.enableNow')}
                </button>
            </div>
        );
    }

    return (
        <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--background)',
            color: 'var(--text-primary)',
            fontSize: 'var(--ui-font-size, 13px)',
            overflow: 'hidden'
        }}>
            {/* Top Control Bar */}
            <div style={{
                padding: '16px 24px',
                background: 'var(--surface)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                flexWrap: 'wrap',
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>

                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                MCP: {config.name || config.host}
                            </span>
                            <span style={{
                                fontSize: '0.90rem',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                background: isServerAllowed ? 'rgba(46, 160, 67, 0.15)' : 'rgba(217, 130, 43, 0.15)',
                                color: isServerAllowed ? '#2ea44f' : '#d9822b',
                                fontWeight: 500,
                                flexShrink: 0
                            }}>
                                {isServerAllowed ? t('mcp.serverAllowed') : t('mcp.serverRevoked')}
                            </span>
                        </div>
                        <div style={{ fontSize: 'var(--ui-font-size)', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {config.user}@{config.host}:{config.port || 22}
                        </div>
                        {config.id && (
                            <div style={{ fontSize: 'var(--ui-font-size)', color: 'var(--text-secondary)', fontFamily: 'var(--mono-font-family)', marginTop: '2px' }}>
                                {config.id}
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: 'var(--ui-font-size)',
                        color: 'var(--text-secondary)',
                        background: 'var(--hover-surface)',
                        padding: '0 16px',
                        height: '36px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        boxSizing: 'border-box'
                    }}>
                        <Sparkles size={16} style={{ color: 'var(--accent)' }} />
                        {mcpStatus.connectedAgents > 0
                            ? `${mcpStatus.connectedAgents} ${t('mcp.activeAgents')}`
                            : t('mcp.waitingForAgent')}
                    </div>

                    <button
                        className="btn-danger"
                        onClick={handleCloseAccess}
                        style={{
                            height: '36px',
                            padding: '0 16px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            fontSize: 'var(--ui-font-size)',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            boxSizing: 'border-box'
                        }}
                    >
                        <Power size={16} />
                        {t('mcp.closeAccess')}
                    </button>
                </div>
            </div>

            {/* Pending Confirmations Bar */}
            {pendingConfirmations.length > 0 && (
                <div style={{
                    padding: '16px 24px',
                    background: 'rgba(217, 130, 43, 0.12)',
                    borderBottom: '1px solid rgba(217, 130, 43, 0.3)',
                    flexShrink: 0
                }}>
                    {pendingConfirmations.map(req => (
                        <div key={req.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                                <Shield size={20} style={{ color: '#d9822b', flexShrink: 0 }} />
                                <div style={{ overflow: 'hidden' }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                        {t('mcp.commandApprovalRequired')}
                                    </div>
                                    <code style={{
                                        display: 'block',
                                        fontSize: 'var(--ui-font-size)',
                                        color: '#e6e6e6',
                                        background: '#1a1a1a',
                                        padding: '4px 8px',
                                        borderRadius: '4px',
                                        marginTop: '4px',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                    }}>
                                        {req.command}
                                    </code>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                                <button
                                    className="btn-primary"
                                    onClick={() => handleConfirm(req.id, true)}
                                    style={{ padding: '6px 14px', background: '#2ea44f', borderColor: '#2ea44f', fontSize: 'var(--ui-font-size)' }}
                                >
                                    {t('common.confirm')}
                                </button>
                                <button
                                    className="btn-secondary"
                                    onClick={() => handleConfirm(req.id, false)}
                                    style={{ padding: '6px 14px', fontSize: 'var(--ui-font-size)' }}
                                >
                                    {t('common.cancel')}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Main Area: Live Activity Log */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexShrink: 0 }}>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Terminal size={18} style={{ color: 'var(--accent)' }} />
                            {t('mcp.agentActivityLog')}
                        </h3>
                        <span style={{ fontSize: 'var(--ui-font-size)', color: 'var(--text-secondary)' }}>
                            {logs.length} {t('mcp.eventsRecorded')}
                        </span>
                    </div>

                    <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        paddingRight: '4px'
                    }}>
                        {logs.length === 0 ? (
                            <div style={{
                                height: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--text-secondary)',
                                gap: '12px',
                                border: '2px dashed var(--border)',
                                borderRadius: '12px',
                                padding: '40px'
                            }}>
                                <Clock size={36} style={{ opacity: 0.5 }} />
                                <div style={{ fontSize: 'var(--ui-font-size)', fontWeight: 500 }}>
                                    {t('mcp.noLogYet')}
                                </div>
                                <div style={{ fontSize: 'var(--ui-font-size)', textAlign: 'center', maxWidth: '360px' }}>
                                    {t('mcp.noLogDesc')}
                                </div>
                            </div>
                        ) : (
                            logs.map(log => (
                                <div key={log.id} style={{
                                    padding: '14px',
                                    borderRadius: '8px',
                                    background: 'var(--surface)',
                                    border: '1px solid var(--border)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {log.status === 'running' && <Loader2 size={16} className="spin" style={{ color: 'var(--accent)' }} />}
                                            {log.status === 'success' && <CheckCircle2 size={16} style={{ color: '#2ea44f' }} />}
                                            {(log.status === 'failed' || log.status === 'rejected') && <XCircle size={16} style={{ color: '#ef4444' }} />}
                                            {log.status === 'pending' && <Clock size={16} style={{ color: '#d9822b' }} />}

                                            <span style={{ fontWeight: 600, fontSize: 'var(--text-secondary)' }}>{log.action}</span>
                                            <span style={{
                                                fontSize: 'var(--ui-font-size)',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                background: log.status === 'success' ? 'rgba(46,160,67,0.15)' : (log.status === 'running' ? 'rgba(var(--accent-rgb),0.15)' : 'var(--hover-surface)'),
                                                color: log.status === 'success' ? '#2ea44f' : 'var(--text-primary)'
                                            }}>
                                                {log.status === 'success' && t('mcp.statusSuccess')}
                                                {log.status === 'running' && t('mcp.statusExecRunning')}
                                                {log.status === 'failed' && t('mcp.statusFailed')}
                                                {log.status === 'pending' && t('mcp.statusPending')}
                                                {log.status === 'approved' && t('mcp.statusApproved')}
                                                {log.status === 'rejected' && t('mcp.statusRejected')}
                                                {!['success', 'running', 'failed', 'pending', 'approved', 'rejected'].includes(log.status) && log.status}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 'var(--ui-font-size)', color: 'var(--text-secondary)' }}>
                                            {new Date(log.timestamp).toLocaleTimeString()}
                                        </div>
                                    </div>

                                    {log.command && (
                                        <pre style={{
                                            margin: 0,
                                            padding: '8px 12px',
                                            borderRadius: '6px',
                                            background: '#1a1a1a',
                                            color: '#e6e6e6',
                                            fontFamily: 'var(--mono-font-family)',
                                            fontSize: 'var(--ui-font-size)',
                                            overflowX: 'auto'
                                        }}>
                                            <code>$ {log.command}</code>
                                        </pre>
                                    )}

                                    {log.stdout && (
                                        <pre style={{
                                            margin: 0,
                                            padding: '8px 12px',
                                            borderRadius: '6px',
                                            background: 'rgba(0,0,0,0.3)',
                                            color: '#a3e635',
                                            fontFamily: 'var(--mono-font-family)',
                                            fontSize: 'var(--ui-font-size)',
                                            maxHeight: '150px',
                                            overflowY: 'auto'
                                        }}>
                                            <code>{log.stdout}</code>
                                        </pre>
                                    )}

                                    {log.stderr && (
                                        <pre style={{
                                            margin: 0,
                                            padding: '8px 12px',
                                            borderRadius: '6px',
                                            background: 'rgba(239,68,68,0.1)',
                                            color: '#f87171',
                                            fontFamily: 'var(--mono-font-family)',
                                            fontSize: 'var(--ui-font-size)',
                                            maxHeight: '150px',
                                            overflowY: 'auto'
                                        }}>
                                            <code>{log.stderr}</code>
                                        </pre>
                                    )}

                                    {log.error && (
                                        <div style={{ fontSize: 'var(--ui-font-size)', color: '#f87171' }}>
                                            {t('mcp.errorLabel')}: {log.error}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
        </div>
    );
};
