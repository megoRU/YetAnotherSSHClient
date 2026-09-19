import React, { useState, useEffect } from 'react';
import { Shield, Power, Terminal, AlertTriangle, Clock, CheckCircle2, XCircle, Loader2, Check, ChevronDown, ChevronUp, Ban } from 'lucide-react';
import type { AppConfig, SSHConfig, McpStatus, McpLogItem, McpLogStatus, McpConfirmationRequest, McpAgent } from '../types';
import { useI18n } from '../utils/i18n';

const { ipcRenderer } = window;

interface McpTabProps {
    config: SSHConfig;
    appConfig: AppConfig;
    onClose: () => void;
    onAppConfigUpdate: (config: AppConfig) => void;
}

interface McpAgentsListProps {
    agents?: McpAgent[];
    language: 'ru' | 'en';
    activity?: 'working' | 'done';
}

const McpAgentsList: React.FC<McpAgentsListProps> = ({ agents, language, activity }) => {
    const { t } = useI18n(language);

    const visibleAgents = (agents || []).filter(agent => {
        const rawName = agent.name || '';
        const cleanName = rawName.replace(/\s*\(.*$/, '').trim();
        return cleanName !== 'mcp-remote-fallback-test' && rawName !== 'mcp-remote-fallback-test' && !rawName.includes('mcp-remote-fallback-test');
    });

    if (visibleAgents.length === 0) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: 'var(--ui-font-size)',
                color: 'var(--text-secondary)',
                background: 'var(--hover-surface)',
                padding: '0 12px',
                height: '36px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                boxSizing: 'border-box',
                whiteSpace: 'nowrap'
            }}>
                <span>{t('mcp.waitingForAgent')}</span>
            </div>
        );
    }

    const statusChip = (
        <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: 'var(--ui-font-size)',
            fontWeight: 500,
            color: activity === 'working' ? '#d9822b' : '#2ea44f',
            background: activity === 'working' ? 'rgba(217, 130, 43, 0.12)' : 'rgba(46, 160, 67, 0.12)',
            border: activity === 'working' ? '1px solid rgba(217, 130, 43, 0.4)' : '1px solid rgba(46, 160, 67, 0.4)',
            padding: '0 12px',
            borderRadius: '6px',
            height: '36px',
            boxSizing: 'border-box',
            whiteSpace: 'nowrap',
            flexShrink: 0
        }}>
            {activity === 'working' ? (
                <Loader2 size={14} className="spin" />
            ) : (
                <Check size={14} />
            )}
            <span>{activity === 'working' ? t('mcp.agentWorking') : t('mcp.agentDone')}</span>
        </div>
    );

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            maxWidth: '100%',
            overflowX: 'auto',
            padding: '2px 0',
            scrollbarWidth: 'thin',
            minWidth: 0
        }}>
            {statusChip}
            {visibleAgents.map(agent => {
                const displayName = agent.name.replace(/\s*\(.*$/, '').trim();

                return (
                    <div
                        key={agent.id}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: 'var(--ui-font-size)',
                            fontWeight: 500,
                            color: 'var(--text-primary)',
                            background: 'var(--hover-surface)',
                            border: '1px solid var(--border)',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            whiteSpace: 'nowrap',
                            height: '36px',
                            boxSizing: 'border-box',
                            flexShrink: 0
                        }}
                    >
                        <span style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            backgroundColor: '#2ea44f',
                            display: 'inline-block',
                            flexShrink: 0
                        }} />
                        <span>{displayName}</span>
                        {agent.version && (
                            <span style={{ fontSize: 'var(--ui-font-size)', color: 'var(--text-secondary)', fontWeight: 400 }}>
                                v{agent.version}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

interface McpTabHeaderProps {
    config: SSHConfig;
    isServerAllowed: boolean;
    agents?: McpAgent[];
    language: 'ru' | 'en';
    activity?: 'working' | 'done';
    onGrantAccess: () => void;
    onCloseAccess: () => void;
}

const McpTabHeader: React.FC<McpTabHeaderProps> = ({
    config,
    isServerAllowed,
    agents,
    language,
    activity,
    onGrantAccess,
    onCloseAccess
}) => {
    const { t } = useI18n(language);

    return (
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

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 1, minWidth: 0 }}>
                <McpAgentsList agents={agents} language={language} activity={activity} />

                {!isServerAllowed ? (
                    <button
                        className="btn-primary"
                        onClick={onGrantAccess}
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
                            background: '#2ea44f',
                            borderColor: '#2ea44f'
                        }}
                    >
                        <Check size={16} />
                        {t('mcp.grantAccess')}
                    </button>
                ) : (
                    <button
                        className="btn-danger"
                        onClick={onCloseAccess}
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
                )}
            </div>
        </div>
    );
};

interface McpPendingConfirmationsProps {
    confirmations: McpConfirmationRequest[];
    language: 'ru' | 'en';
    onConfirm: (id: string, approved: boolean) => void;
}

const McpPendingConfirmations: React.FC<McpPendingConfirmationsProps> = ({ confirmations, language, onConfirm }) => {
    const { t } = useI18n(language);

    if (confirmations.length === 0) return null;

    return (
        <div style={{
            padding: '16px 24px',
            background: 'rgba(217, 130, 43, 0.12)',
            borderBottom: '1px solid rgba(217, 130, 43, 0.3)',
            flexShrink: 0
        }}>
            {confirmations.map(req => (
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
                                color: 'var(--text-primary)',
                                background: 'var(--hover-surface)',
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
                            onClick={() => onConfirm(req.id, true)}
                            style={{ padding: '6px 14px', background: '#2ea44f', borderColor: '#2ea44f', fontSize: 'var(--ui-font-size)' }}
                        >
                            {t('common.confirm')}
                        </button>
                        <button
                            className="btn-secondary"
                            onClick={() => onConfirm(req.id, false)}
                            style={{ padding: '6px 14px', fontSize: 'var(--ui-font-size)' }}
                        >
                            {t('common.cancel')}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
};

interface McpActivityLogProps {
    logs: McpLogItem[];
    language: 'ru' | 'en';
    onCancelRun: (runId: string) => void;
}

const pad2 = (n: number) => n.toString().padStart(2, '0');

const formatClock = (ts: number): string => {
    const d = new Date(ts);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

const formatDuration = (ms: number, language: 'ru' | 'en'): string => {
    const value = Math.max(0, ms);
    if (value < 1000) return language === 'ru' ? `${Math.round(value)} мс` : `${Math.round(value)} ms`;
    const sec = value / 1000;
    if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)} ${language === 'ru' ? 'сек' : 'sec'}`;
    const minutes = Math.floor(sec / 60);
    const rest = Math.round(sec % 60);
    return language === 'ru' ? `${minutes} мин ${rest} сек` : `${minutes} min ${rest} sec`;
};

const ruPlural = (n: number, one: string, few: string, many: string): string => {
    const abs = Math.abs(n) % 100;
    const d = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (d > 1 && d < 5) return few;
    if (d === 1) return one;
    return many;
};

const actionCountWord = (n: number, language: 'ru' | 'en'): string => {
    if (language === 'en') return n === 1 ? 'action' : 'actions';
    return ruPlural(n, 'действие', 'действия', 'действий');
};

const L = (ru: string, en: string, language: 'ru' | 'en'): string =>
    language === 'ru' ? ru : en;

const nonEmptyLines = (text: string | undefined): string[] =>
    (text || '')
        .split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 0);

const resolveToolKind = (tool: string | undefined): string => {
    const name = (tool || '').toLowerCase();
    if (!name) return 'other';
    if (/execute_command|run_command|exec_command|shell_exec|_exec|exec_|command/.test(name)) return 'execute';
    if (/git/.test(name)) return 'git';
    if (/system_info|os_info|list_connections?|uname|whoami|uptime|_os\b|\bos_|env\b|endpoint/.test(name)) return 'system';
    if (/read|cat\b|view|show/.test(name)) return 'read';
    if (/create|mkdir|touch/.test(name)) return 'create';
    if (/\bwrite|_write|append|put_file|edit_file|patch/.test(name)) return 'write';
    if (/delete|remove|unlink|\brm\b|purge/.test(name)) return 'delete';
    if (/grep|\brg\b|rg_|regex|search_text|text_search|ripgrep/.test(name)) return 'grep';
    if (/\bsearch|_search|find|glob|list_files?|list_dir/.test(name)) return 'search';
    return 'other';
};

const ACTION_VERB_KEYS: Record<string, string> = {
    execute: 'mcp.actExecute',
    read: 'mcp.actReadFile',
    write: 'mcp.actWriteFile',
    create: 'mcp.actCreateFile',
    delete: 'mcp.actDeleteFile',
    search: 'mcp.actSearchFiles',
    grep: 'mcp.actSearchText',
    git: 'mcp.actGit',
    system: 'mcp.actSystemInfo',
    other: 'mcp.actFallback'
};

const BLOCKED_ARGS_KEYS = [
    'connection_id', 'connectionId', 'session_id', 'sessionId', 'tool_name', 'toolName',
    'target', 'tool_call_id', 'toolCallId', 'request_id', 'requestId',
    'session', 'connection', 'agent', 'client', 'cwd'
];

const normalizeCommand = (cmd: string): string => {
    let c = cmd.trim().replace(/^\$+\s*/, '').toLowerCase();
    c = c.replace(/^sudo\s+/, '');
    c = c.replace(/^nohup\s+/, '');
    c = c.replace(/^command\s+/, '');
    c = c.replace(/^timeout\s+(\d+(\.\d+)?\s*[smhd]?\s+)/, '');
    return c.trim();
};

const describeExecuteCommand = (command: string | undefined): string | null => {
    const c = normalizeCommand(command || '');
    if (!c) return null;

    const startsWith = (...toks: string[]) => toks.some(t =>
        c === t || c.startsWith(`${t} `) || c.startsWith(`${t}\t`) || c.startsWith(`${t};`) || c.startsWith(`${t}&&`)
    );
    const has = (...toks: string[]) => toks.some(t => c.includes(t));

    if (startsWith('systemctl')) {
        return has('is-active', 'is-enabled', 'is-failed', 'status') ? 'mcp.actCheckServices' : 'mcp.actManageService';
    }
    if (startsWith('service', 'rc-service')) return 'mcp.actManageService';
    if (startsWith('journalctl')) return has('sshd', 'ssh') ? 'mcp.actCheckSshEvents' : 'mcp.actReadLogs';
    if (startsWith('rm')) return has('/tmp/') ? 'mcp.actRemoveTempFile' : 'mcp.actRemoveFile';
    if (startsWith('mv')) return 'mcp.actMoveFile';
    if (startsWith('cp')) return 'mcp.actCopyFile';
    if (startsWith('ls', 'find', 'glob')) return 'mcp.actListFiles';
    if (startsWith('cat', 'less', 'more', 'head', 'tail', 'wc', 'stat', 'file')) return 'mcp.actReadFile';
    if (startsWith('mkdir', 'touch')) return 'mcp.actCreateFile';
    if (startsWith('ps', 'top', 'pgrep')) return 'mcp.actCheckProcesses';
    if (startsWith('df', 'du', 'free', 'uptime', 'uname', 'whoami', 'id')) return 'mcp.actCheckSystem';
    if (startsWith('ping', 'ss', 'netstat', 'ip', 'curl', 'wget', 'dig', 'nslookup', 'whois', 'hostname')) return 'mcp.actCheckNetwork';
    if (startsWith('apt', 'apt-get', 'dpkg', 'yum', 'dnf', 'npm', 'pip', 'pip3', 'gem')) return 'mcp.actInstallPackages';
    if (startsWith('grep', 'rg', 'findstr')) return 'mcp.actSearchText';
    if (startsWith('git')) return 'mcp.actGit';
    if (startsWith('docker', 'docker-compose', 'podman')) return 'mcp.actDocker';
    return null;
};

const argTake = (a: Record<string, unknown>, keys: string[]): { key: string | null; value: unknown } => {
    for (const k of keys) {
        const v = a[k];
        if (v !== undefined && v !== null && v !== '') return { key: k, value: v };
    }
    return { key: null, value: undefined };
};

const isPrimitive = (v: unknown): v is string | number | boolean =>
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

const formatArgsSummary = (tool: string | undefined, args: unknown, language: 'ru' | 'en'): string => {
    if (typeof args === 'string') return args;
    if (!args || typeof args !== 'object' || Array.isArray(args)) return '';
    const a = args as Record<string, unknown>;
    const kind = resolveToolKind(tool);
    const lines: string[] = [];
    const used = new Set<string>();

    const path = argTake(a, ['path', 'file', 'filePath', 'directory', 'dir', 'repository']);
    const query = argTake(a, ['query', 'pattern', 'search', 'term', 'regex']);
    const cmd = argTake(a, ['command', 'cmd', 'script']);
    const action = argTake(a, ['action', 'operation', 'subcommand']);
    const url = argTake(a, ['url', 'endpoint']);

    const commit = (picked: { key: string | null; value: unknown }, text: string) => {
        if (picked.key) used.add(picked.key);
        if (picked.key && picked.value) lines.push(text);
    };

    if (kind === 'execute') {
        commit(cmd, String(cmd.value ?? ''));
    } else if (kind === 'grep' || kind === 'search') {
        commit(query, `${L('Запрос', 'Query', language)}: ${String(query.value ?? '')}`);
        commit(path, `${L('Путь', 'Path', language)}: ${String(path.value ?? '')}`);
        commit(action, String(action.value ?? ''));
    } else if (kind === 'git') {
        commit(action, String(action.value ?? ''));
        commit(path, `${L('Репозиторий', 'Repository', language)}: ${String(path.value ?? '')}`);
    } else if (kind === 'write' || kind === 'create') {
        commit(action, String(action.value ?? ''));
        commit(path, String(path.value ?? ''));
    } else {
        commit(path, String(path.value ?? ''));
        commit(query, `${L('Запрос', 'Query', language)}: ${String(query.value ?? '')}`);
        commit(action, String(action.value ?? ''));
        commit(url, String(url.value ?? ''));
    }

    if (cmd.key && cmd.value && kind !== 'execute') commit(cmd, String(cmd.value));

    if (lines.length === 0) {
        for (const [key, value] of Object.entries(a)) {
            if (used.has(key) || BLOCKED_ARGS_KEYS.includes(key)) continue;
            if (isPrimitive(value)) lines.push(`${key}: ${String(value)}`);
        }
    }

    return lines.join('\n');
};

const buildResultSummary = (
    status: McpLogStatus,
    stdout: string | undefined,
    stderr: string | undefined,
    exitCode: number | undefined,
    durationMs: number | undefined,
    language: 'ru' | 'en'
): string => {
    if (status === 'pending') return L('Ожидает подтверждения', 'Waiting for approval', language);
    if (status === 'cancelled') {
        const duration = durationMs !== undefined ? ` · ${formatDuration(durationMs, language)}` : '';
        return `${L('Отменено', 'Cancelled', language)}${duration}`;
    }
    const duration = durationMs !== undefined ? ` · ${formatDuration(durationMs, language)}` : '';
    if (status === 'failed') {
        const details: string[] = [];
        if (exitCode !== undefined) details.push(`${L('Код выхода', 'Exit code', language)} ${exitCode}`);
        if (durationMs !== undefined) details.push(formatDuration(durationMs, language));
        return `${L('Не удалось выполнить', 'Failed to execute', language)}\n${details.join(' · ')}`;
    }
    const count = Math.max(nonEmptyLines(stdout).length, nonEmptyLines(stderr).length);
    let summary = `${L('Готово', 'Done', language)}${duration}`;
    if (count > 0) {
        const word = language === 'ru'
            ? ruPlural(count, 'строка', 'строки', 'строк')
            : count === 1 ? 'line' : 'lines';
        summary += ` · ${language === 'ru' ? 'Получено' : 'Received'} ${count} ${word}`;
    } else {
        summary += ` · ${L('Пустой вывод', 'No output', language)}`;
    }
    return summary;
};

type ActionStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

interface ActionCard {
    runId: string;
    toolName?: string;
    command?: string;
    args?: unknown;
    status: ActionStatus;
    timestamp: number;
    startedAt?: number;
    durationMs?: number;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    error?: string;
}

const buildActionCard = (events: McpLogItem[]): ActionCard | null => {
    const calls = events.filter(e => e.kind === 'tool_call');
    if (calls.length === 0) return null;
    const call = calls[calls.length - 1];

    const results = events.filter(e => e.kind === 'tool_result');
    const result = results.length > 0 ? results[results.length - 1] : undefined;

    let status: ActionStatus;
    if (result) {
        status = result.status === 'success' ? 'success' : result.status === 'cancelled' ? 'cancelled' : 'failed';
    } else if (call.status === 'pending') {
        status = 'pending';
    } else if (call.status === 'cancelled') {
        status = 'cancelled';
    } else {
        status = 'running';
    }

    return {
        runId: call.runId || '',
        toolName: call.toolName,
        command: call.command,
        args: call.args,
        status,
        timestamp: result?.timestamp ?? call.timestamp,
        startedAt: call.startedAt,
        durationMs: result?.durationMs,
        stdout: result?.stdout,
        stderr: result?.stderr,
        exitCode: result?.exitCode ?? undefined,
        error: result?.error ?? (status === 'cancelled' && call.error ? call.error : undefined)
    };
};

const McpActionResult: React.FC<{ card: ActionCard; language: 'ru' | 'en' }> = ({ card, language }) => {
    const { t } = useI18n(language);
    const [show, setShow] = useState(false);

    const hasOutput = nonEmptyLines(card.stdout).length > 0 || nonEmptyLines(card.stderr).length > 0;
    const color = card.status === 'success' ? '#2ea44f' : card.status === 'failed' ? '#ef4444' : '#d9822b';
    const Icon = card.status === 'success' ? CheckCircle2 : card.status === 'failed' ? XCircle : Ban;
    const summary = buildResultSummary(card.status, card.stdout, card.stderr, card.exitCode, card.durationMs, language);
    const [head, secondary] = summary.split('\n');

    const toggleButton = card.status !== 'cancelled' && hasOutput ? (
        <button
            type="button"
            onClick={() => setShow(s => !s)}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: 'var(--ui-font-size)',
                padding: '2px 8px',
                borderRadius: '5px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
            }}
        >
            {show ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {show ? t('mcp.hideResult') : t('mcp.showResult')}
        </button>
    ) : null;

    return (
        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: 'var(--ui-font-size)', fontWeight: 500, color }}>
                    <Icon size={14} style={{ flexShrink: 0 }} />
                    {head}
                </span>
                {card.status === 'failed' && card.error && (
                    <span style={{ fontSize: 'var(--ui-font-size)', color: 'var(--text-secondary)' }} title={card.error}>
                        {card.error.length > 120 ? `${card.error.slice(0, 120)}…` : card.error}
                    </span>
                )}
                {card.status === 'cancelled' && card.error && (
                    <span style={{ fontSize: 'var(--ui-font-size)', color: '#d9822b' }}>{card.error}</span>
                )}
                {!secondary && toggleButton}
            </div>
            {secondary && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-secondary)' }}>
                        {secondary}
                    </span>
                    {toggleButton}
                </div>
            )}
            {show && hasOutput && card.status !== 'cancelled' && (
                <pre style={{
                    margin: '8px 0 0 0',
                    padding: '10px 12px',
                    borderRadius: '6px',
                    background: 'rgba(0,0,0,0.15)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--mono-font-family)',
                    fontSize: 'var(--ui-font-size)',
                    maxHeight: '320px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all'
                }}>
                    {card.stdout || ''}
                    {nonEmptyLines(card.stderr).length > 0 && (
                        <>
                            {card.stdout && card.stdout.trim() ? '\n\n[stderr]\n' : '[stderr]\n'}
                            {card.stderr}
                        </>
                    )}
                </pre>
            )}
        </div>
    );
};

const McpActionCard: React.FC<{
    card: ActionCard;
    language: 'ru' | 'en';
    now: number;
    onCancelRun: (runId: string) => void;
}> = ({ card, language, now, onCancelRun }) => {
    const { t } = useI18n(language);

    const kind = resolveToolKind(card.toolName);
    const verbKey = kind === 'execute'
        ? describeExecuteCommand(card.command) ?? 'mcp.actExecute'
        : ACTION_VERB_KEYS[kind] ?? 'mcp.actFallback';
    const verb = t(verbKey);
    const isExec = kind === 'execute';
    const active = card.status === 'pending' || card.status === 'running';

    const preview = isExec
        ? (card.command || formatArgsSummary(card.toolName, card.args, language))
        : formatArgsSummary(card.toolName, card.args, language);

    const statusIcon =
        card.status === 'pending'
            ? <Clock size={15} style={{ color: '#d9822b', flexShrink: 0 }} />
            : card.status === 'running'
                ? <Loader2 size={15} className="spin" style={{ color: 'var(--accent)', flexShrink: 0 }} />
                : card.status === 'success'
                    ? <CheckCircle2 size={15} style={{ color: '#2ea44f', flexShrink: 0 }} />
                    : card.status === 'failed'
                        ? <XCircle size={15} style={{ color: '#ef4444', flexShrink: 0 }} />
                        : <Ban size={15} style={{ color: '#d9822b', flexShrink: 0 }} />;

    const liveElapsed = active && card.startedAt ? formatDuration(now - card.startedAt, language) : undefined;

    return (
        <div style={{
            borderRadius: '10px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            overflow: 'hidden',
            flexShrink: 0
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px 4px 14px', flexWrap: 'wrap' }}>
                {statusIcon}
                <span style={{ fontWeight: 600, fontSize: 'var(--ui-font-size)', color: 'var(--text-primary)', minWidth: 0 }}>
                    {verb}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 'var(--ui-font-size)', color: 'var(--text-secondary)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {formatClock(card.timestamp)}
                </span>
                {active && (
                    <button
                        type="button"
                        onClick={() => onCancelRun(card.runId)}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            fontSize: 'var(--ui-font-size)',
                            padding: '3px 10px',
                            borderRadius: '5px',
                            border: '1px solid var(--border)',
                            background: 'var(--surface)',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        <Ban size={12} />
                        {t('common.cancel')}
                    </button>
                )}
            </div>

            {preview && (
                <pre style={{
                    margin: '8px 14px 4px 14px',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: 'var(--hover-surface)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--mono-font-family)',
                    fontSize: 'var(--ui-font-size)',
                    maxHeight: '180px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all'
                }}>
                    {isExec && <span style={{ color: 'var(--text-secondary)' }}>$&nbsp;</span>}
                    {preview}
                </pre>
            )}

            <div style={{ padding: '4px 14px 12px 14px' }}>
                {card.status === 'pending' && (
                    <div style={{ fontSize: 'var(--ui-font-size)', color: '#d9822b', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <Clock size={13} />
                        {t('mcp.timelineWaitingApproval')}
                    </div>
                )}
                {card.status === 'running' && (
                    <div style={{ fontSize: 'var(--ui-font-size)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <Loader2 size={13} className="spin" />
                        {t('mcp.timelineExecuting')}
                        {liveElapsed ? ` · ${liveElapsed}` : ''}
                    </div>
                )}
                {(card.status === 'success' || card.status === 'failed' || card.status === 'cancelled') && (
                    <McpActionResult card={card} language={language} />
                )}
            </div>
        </div>
    );
};

const McpActivityLog: React.FC<McpActivityLogProps> = ({ logs, language, onCancelRun }) => {
    const { t } = useI18n(language);
    const [now, setNow] = useState(() => Date.now());

    const items = React.useMemo(() => {
        const map = new Map<string, McpLogItem[]>();
        for (const log of logs) {
            const key = log.runId || '__default';
            const arr = map.get(key);
            if (arr) arr.push(log);
            else map.set(key, [log]);
        }
        const list: { start: number; card: ActionCard }[] = [];
        for (const events of Array.from(map.values())) {
            const card = buildActionCard(events);
            if (!card) continue;
            list.push({ start: Math.min(...events.map(e => e.timestamp)), card });
        }
        list.sort((a, b) => b.start - a.start);
        return list;
    }, [logs]);

    const hasActive = items.some(i => i.card.status === 'pending' || i.card.status === 'running');

    useEffect(() => {
        if (!hasActive) return;
        const id = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(id);
    }, [hasActive]);

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', overflow: 'hidden', minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexShrink: 0 }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Terminal size={18} style={{ color: 'var(--accent)' }} />
                    {t('mcp.agentActivityLog')}
                </h3>
                <span style={{ fontSize: 'var(--ui-font-size)', color: 'var(--text-secondary)' }}>
                    {items.length} {actionCountWord(items.length, language)}
                </span>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px', minHeight: 0 }}>
                {items.length === 0 ? (
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
                    items.map(item => (
                        <McpActionCard
                            key={item.card.runId}
                            card={item.card}
                            language={language}
                            now={now}
                            onCancelRun={onCancelRun}
                        />
                    ))
                )}
            </div>
        </div>
    );
};
export const McpTab: React.FC<McpTabProps> = ({ config, appConfig, onClose, onAppConfigUpdate }) => {
    const { t } = useI18n(appConfig.language);
    const [mcpStatus, setMcpStatus] = useState<McpStatus>({
        enabled: appConfig.mcpEnabled || false,
        running: false,
        port: appConfig.mcpPort || 3000,
        connectedAgents: 0,
        requireConfirmation: appConfig.mcpRequireConfirmation ?? true,
        allowedServerIds: appConfig.mcpAllowedServerIds || []
    });

    const [logs, setLogs] = useState<McpLogItem[]>([]);
    const [pendingConfirmations, setPendingConfirmations] = useState<McpConfirmationRequest[]>([]);
    const isServerAllowed = mcpStatus.allowedServerIds?.includes(config.id || '');
    const hasActiveRun = logs.some(l => l.kind === 'tool_call' && (l.status === 'pending' || l.status === 'running'));

    useEffect(() => {
        let isMounted = true;

        const loadInitialStatus = async () => {
            if (!ipcRenderer?.mcpGetStatus) return;
            try {
                const status = await ipcRenderer.mcpGetStatus();
                if (isMounted) {
                    setMcpStatus(status);
                    if (Array.isArray(status.pendingConfirmations)) {
                        setPendingConfirmations(
                            status.pendingConfirmations.filter(req => req.connectionId === config.id)
                        );
                    }
                }
            } catch (e) {
                console.error('[MCP] Failed to get MCP status in tab:', e);
            }
        };

        void loadInitialStatus();

        const unsubStatus = ipcRenderer?.onMcpStatusChanged?.((status: McpStatus) => {
            if (isMounted) {
                setMcpStatus(status);
                if (Array.isArray(status.pendingConfirmations)) {
                    setPendingConfirmations(
                        status.pendingConfirmations.filter(req => req.connectionId === config.id)
                    );
                }
            }
        });

        const unsubLog = ipcRenderer?.onMcpLog?.((log: McpLogItem) => {
            if (isMounted && log.connectionId === config.id) {
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
            if (isMounted && req.connectionId === config.id) {
                setPendingConfirmations(prev => [...prev.filter(r => r.id !== req.id), req]);
            }
        });

        return () => {
            isMounted = false;
            if (typeof unsubStatus === 'function') unsubStatus();
            if (typeof unsubLog === 'function') unsubLog();
            if (typeof unsubReq === 'function') unsubReq();
        };
    }, [config.id]);

    const handleGrantAccess = async () => {
        if (config.id && ipcRenderer?.mcpOpenServer) {
            const status = await ipcRenderer.mcpOpenServer(config.id);
            setMcpStatus(status);
            if (appConfig.mcpAllowedServerIds && !appConfig.mcpAllowedServerIds.includes(config.id)) {
                onAppConfigUpdate({
                    ...appConfig,
                    mcpAllowedServerIds: [...appConfig.mcpAllowedServerIds, config.id]
                });
            }
        }
    };

    const handleCloseAccess = async () => {
        if (config.id && ipcRenderer?.mcpCloseServer) {
            const status = await ipcRenderer.mcpCloseServer(config.id);
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
            const status = await ipcRenderer.mcpToggle(true);
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

    const handleCancelRun = async (runId: string) => {
        if (ipcRenderer?.mcpCancelRun) {
            await ipcRenderer.mcpCancelRun(runId);
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
            <McpTabHeader
                config={config}
                isServerAllowed={isServerAllowed}
                agents={mcpStatus.agents}
                language={appConfig.language}
                activity={hasActiveRun ? 'working' : 'done'}
                onGrantAccess={handleGrantAccess}
                onCloseAccess={handleCloseAccess}
            />

            <McpPendingConfirmations
                confirmations={pendingConfirmations}
                language={appConfig.language}
                onConfirm={handleConfirm}
            />

            <McpActivityLog
                logs={logs}
                language={appConfig.language}
                onCancelRun={handleCancelRun}
            />
        </div>
    );
};
