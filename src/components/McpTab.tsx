import React, { useState, useEffect, useCallback } from 'react';
import { Bot, Copy, Check, Shield, Power, Terminal, AlertTriangle, Play, Clock, CheckCircle2, XCircle, Loader2, Sparkles } from 'lucide-react';
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

export const McpTab: React.FC<McpTabProps> = ({ config, appConfig, onClose, onAppConfigUpdate }) => {
    const { t } = useI18n(appConfig.language);
    const [mcpStatus, setMcpStatus] = useState<any>({
        enabled: appConfig.mcpEnabled || false,
        running: false,
        port: appConfig.mcpPort || 3000,
        connectedAgents: 0,
        token: appConfig.mcpToken || '',
        requireConfirmation: appConfig.mcpRequireConfirmation ?? true,
        allowedServerIds: appConfig.mcpAllowedServerIds || []
    });

    const [logs, setLogs] = useState<McpLogItem[]>([]);
    const [pendingConfirmations, setPendingConfirmations] = useState<any[]>([]);
    const [copiedToken, setCopiedToken] = useState(false);
    const [copiedJson, setCopiedJson] = useState(false);

    const isServerAllowed = mcpStatus.allowedServerIds?.includes(config.id || '');

    const fetchStatus = useCallback(async () => {
        if (!ipcRenderer?.mcpGetStatus) return;
        try {
            const status = await ipcRenderer.mcpGetStatus();
            setMcpStatus(status);
        } catch (e) {
            console.error('[MCP] Failed to get MCP status in tab:', e);
        }
    }, []);

    useEffect(() => {
        fetchStatus();

        // Register server as allowed for MCP if not already
        if (config.id && ipcRenderer?.mcpOpenServer) {
            ipcRenderer.mcpOpenServer(config.id).then((status: any) => {
                setMcpStatus(status);
            });
        }

        const unsubStatus = ipcRenderer?.onMcpStatusChanged?.((status: any) => {
            setMcpStatus(status);
        });

        const unsubLog = ipcRenderer?.onMcpLog?.((log: any) => {
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

        const unsubReq = ipcRenderer?.onMcpRequestConfirmation?.((req: any) => {
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
            const status: any = await ipcRenderer.mcpCloseServer(config.id);
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
            const status: any = await ipcRenderer.mcpToggle(true);
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

    const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const mcpEndpoint = `http://127.0.0.1:${mcpStatus.port || 3000}`;
    const clientConfigJson = {
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
                    {t('mcp.disabledTitle') || 'MCP Server is Globally Disabled'}
                </h2>
                <p style={{ color: 'var(--text-secondary)', maxWidth: '460px', margin: '0 0 24px 0', lineHeight: 1.5 }}>
                    {t('mcp.disabledDesc') || 'To allow AI agents access to this SSH server, enable the MCP server in application settings.'}
                </p>
                <button
                    className="btn-primary"
                    onClick={handleEnableMcpGlobally}
                    style={{ padding: '10px 20px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                    <Power size={18} />
                    {t('mcp.enableNow') || 'Enable MCP Server'}
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
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: 'rgba(var(--accent-rgb), 0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--accent)'
                    }}>
                        <Bot size={22} />
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            MCP: {config.name || config.host}
                            <span style={{
                                fontSize: '0.75rem',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                background: isServerAllowed ? 'rgba(46, 160, 67, 0.15)' : 'rgba(217, 130, 43, 0.15)',
                                color: isServerAllowed ? '#2ea44f' : '#d9822b',
                                fontWeight: 500
                            }}>
                                {isServerAllowed ? (t('mcp.serverAllowed') || 'Access Granted') : (t('mcp.serverRevoked') || 'Revoked')}
                            </span>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {config.user}@{config.host}:{config.port || 22}
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)',
                        background: 'var(--hover-surface)',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)'
                    }}>
                        <Sparkles size={14} style={{ color: 'var(--accent)' }} />
                        {mcpStatus.connectedAgents > 0
                            ? `${mcpStatus.connectedAgents} ${t('mcp.activeAgents') || 'Active Agent(s)'}`
                            : (t('mcp.waitingForAgent') || 'Waiting for agent...')}
                    </div>

                    <button
                        className="btn-danger"
                        onClick={handleCloseAccess}
                        style={{
                            padding: '8px 16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '0.88rem',
                            borderRadius: '6px',
                            cursor: 'pointer'
                        }}
                    >
                        <Power size={16} />
                        {t('mcp.closeAccess') || 'Close Access'}
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
                                        {t('mcp.commandApprovalRequired') || 'AI Agent wants to execute command:'}
                                    </div>
                                    <code style={{
                                        display: 'block',
                                        fontSize: '0.85rem',
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
                                    style={{ padding: '6px 14px', background: '#2ea44f', borderColor: '#2ea44f', fontSize: '0.85rem' }}
                                >
                                    {t('common.confirm') || 'Allow'}
                                </button>
                                <button
                                    className="btn-secondary"
                                    onClick={() => handleConfirm(req.id, false)}
                                    style={{ padding: '6px 14px', fontSize: '0.85rem' }}
                                >
                                    {t('common.cancel') || 'Deny'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Main Area: Connection Info + Activity Log */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Left Side: Endpoints & Config Quick Info */}
                <div style={{
                    width: '320px',
                    borderRight: '1px solid var(--border)',
                    padding: '20px',
                    background: 'var(--surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px',
                    overflowY: 'auto',
                    flexShrink: 0
                }}>
                    <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            {t('mcp.connectionInfo') || 'Connection Details'}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ background: 'var(--hover-surface)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>SSE Endpoint</div>
                                <div style={{ fontSize: '0.85rem', fontFamily: 'var(--mono-font-family)', color: 'var(--text-primary)', marginTop: '2px', wordBreak: 'break-all' }}>
                                    {mcpEndpoint}/sse
                                </div>
                            </div>

                            <div style={{ background: 'var(--hover-surface)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Server ID</div>
                                <div style={{ fontSize: '0.85rem', fontFamily: 'var(--mono-font-family)', color: 'var(--text-primary)', marginTop: '2px' }}>
                                    {config.id}
                                </div>
                            </div>
                        </div>
                    </div>

                </div>

                {/* Right Side: Live Activity Log */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexShrink: 0 }}>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Terminal size={18} style={{ color: 'var(--accent)' }} />
                            {t('mcp.agentActivityLog') || 'Agent Action Log'}
                        </h3>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {logs.length} {t('mcp.eventsRecorded') || 'events'}
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
                                <div style={{ fontSize: '0.95rem', fontWeight: 500 }}>
                                    {t('mcp.noLogYet') || 'No actions performed by AI Agent yet.'}
                                </div>
                                <div style={{ fontSize: '0.85rem', textAlign: 'center', maxWidth: '360px' }}>
                                    {t('mcp.noLogDesc') || 'Commands executed by connected agents on this server will appear here in real time.'}
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

                                            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{log.action}</span>
                                            <span style={{
                                                fontSize: '0.75rem',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                background: log.status === 'success' ? 'rgba(46,160,67,0.15)' : (log.status === 'running' ? 'rgba(var(--accent-rgb),0.15)' : 'var(--hover-surface)'),
                                                color: log.status === 'success' ? '#2ea44f' : 'var(--text-primary)'
                                            }}>
                                                {log.status}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
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
                                            fontSize: '0.95em',
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
                                            fontSize: '0.9em',
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
                                            fontSize: '0.9em',
                                            maxHeight: '150px',
                                            overflowY: 'auto'
                                        }}>
                                            <code>{log.stderr}</code>
                                        </pre>
                                    )}

                                    {log.error && (
                                        <div style={{ fontSize: '0.82rem', color: '#f87171' }}>
                                            Error: {log.error}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
