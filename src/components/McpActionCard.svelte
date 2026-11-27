<script module lang="ts">
    import { formatDuration, L, type ActionCard } from '../utils/mcpActionPresentation';
    import { Clock, CircleCheck, CircleX, LoaderCircle, Ban } from '@lucide/svelte';

    import { createI18n, type Language } from '../utils/i18n';

    import McpActionResult from './McpActionResult.svelte';

    const pad2 = (n: number) => n.toString().padStart(2, '0');

    const formatClock = (ts: number): string => {
        const d = new Date(ts);
        return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    };

    const resolveToolKind = (tool: string | undefined): string => {
        const name = (tool || '').toLowerCase();
        if (!name) return 'other';
        if (/execute_command|run_command|exec_command|shell_exec|_exec|exec_|command/.test(name)) return 'execute';
        if (/git/.test(name)) return 'git';
        if (/system_info|os_info|list_connections?|uname|whoami|uptime|_os\b|\bos_|env\b|endpoint/.test(name))
            return 'system';
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
        other: 'mcp.actFallback',
    };

    const BLOCKED_ARGS_KEYS = [
        'connection_id',
        'connectionId',
        'session_id',
        'sessionId',
        'tool_name',
        'toolName',
        'target',
        'tool_call_id',
        'toolCallId',
        'request_id',
        'requestId',
        'session',
        'connection',
        'agent',
        'client',
        'cwd',
    ];

    const normalizeCommand = (cmd: string): string => {
        let c = cmd
            .trim()
            .replace(/^\$+\s*/, '')
            .toLowerCase();
        c = c.replace(/^sudo\s+/, '');
        c = c.replace(/^nohup\s+/, '');
        c = c.replace(/^command\s+/, '');
        c = c.replace(/^timeout\s+(\d+(\.\d+)?\s*[smhd]?\s+)/, '');
        return c.trim();
    };

    const describeExecuteCommand = (command: string | undefined): string | null => {
        const c = normalizeCommand(command || '');
        if (!c) return null;

        const startsWith = (...toks: string[]) =>
            toks.some(
                (t) =>
                    c === t ||
                    c.startsWith(`${t} `) ||
                    c.startsWith(`${t}\t`) ||
                    c.startsWith(`${t};`) ||
                    c.startsWith(`${t}&&`),
            );
        const has = (...toks: string[]) => toks.some((t) => c.includes(t));

        if (startsWith('systemctl')) {
            return has('is-active', 'is-enabled', 'is-failed', 'status')
                ? 'mcp.actCheckServices'
                : 'mcp.actManageService';
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
        if (startsWith('ping', 'ss', 'netstat', 'ip', 'curl', 'wget', 'dig', 'nslookup', 'whois', 'hostname'))
            return 'mcp.actCheckNetwork';
        if (startsWith('apt', 'apt-get', 'dpkg', 'yum', 'dnf', 'npm', 'pip', 'pip3', 'gem'))
            return 'mcp.actInstallPackages';
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

    const formatArgsSummary = (tool: string | undefined, args: unknown, language: Language): string => {
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
</script>

<script lang="ts">
    let {
        card,
        language,
        now,
        onCancelRun,
    }: {
        card: ActionCard;
        language: Language;
        now: number;
        onCancelRun: (runId: string) => void;
    } = $props();

    const { t } = $derived(createI18n(language));

    const kind = $derived(resolveToolKind(card.toolName));

    const verbKey = $derived(
        kind === 'execute'
            ? (describeExecuteCommand(card.command) ?? 'mcp.actExecute')
            : (ACTION_VERB_KEYS[kind] ?? 'mcp.actFallback'),
    );

    const verb = $derived(t(verbKey));

    const isExec = $derived(kind === 'execute');

    const active = $derived(card.status === 'pending' || card.status === 'running');

    const preview = $derived(
        isExec
            ? card.command || formatArgsSummary(card.toolName, card.args, language)
            : formatArgsSummary(card.toolName, card.args, language),
    );

    const liveElapsed = $derived(
        active && card.startedAt ? formatDuration(now - card.startedAt, language) : undefined,
    );
</script>

{#snippet statusIcon()}
    {#if card.status === 'pending'}<Clock
            size={15}
            style="color: #d9822b; flex-shrink: 0"
        />{:else if card.status === 'running'}<LoaderCircle
            size={15}
            class="spin"
            style="color: var(--accent); flex-shrink: 0"
        />{:else if card.status === 'success'}<CircleCheck
            size={15}
            style="color: #2ea44f; flex-shrink: 0"
        />{:else if card.status === 'failed'}<CircleX
            size={15}
            style="color: #ef4444; flex-shrink: 0"
        />{:else}<Ban size={15} style="color: #d9822b; flex-shrink: 0" />{/if}
{/snippet}

<div
    style="border-radius: 10px; background: var(--surface); border: 1px solid var(--border); overflow: hidden; flex-shrink: 0"
>
    <div style="display: flex; align-items: center; gap: 8px; padding: 12px 14px 4px 14px; flex-wrap: wrap">
        {@render statusIcon?.()}
        <span style="font-weight: 600; font-size: var(--ui-font-size); color: var(--text-primary); min-width: 0">
            {verb}
        </span>
        <span
            style="margin-left: auto; font-size: var(--ui-font-size); color: var(--text-secondary); flex-shrink: 0; white-space: nowrap"
        >
            {formatClock(card.timestamp)}
        </span>
        {#if active}<button
                type="button"
                class="mcp-action-control"
                onclick={() => onCancelRun(card.runId)}
                style="display: inline-flex; align-items: center; gap: 5px; font-size: var(--ui-font-size); padding: 3px 10px; border-radius: 5px; border: 1px solid var(--border); background: var(--surface); color: var(--text-primary); cursor: pointer; white-space: nowrap"
            >
                <Ban size={12} />
                {t('common.cancel')}
            </button>{/if}
    </div>

    {#if preview}<pre
            style="margin: 8px 14px 4px 14px; padding: 8px 12px; border-radius: 6px; background: var(--hover-surface); color: var(--text-primary); font-family: var(--mono-font-family); font-size: var(--ui-font-size); max-height: 180px; overflow-y: auto; white-space: pre-wrap; word-break: break-all">
                    {#if isExec}<span style="color: var(--text-secondary)">$&nbsp;</span>{/if}
                    {preview}
                </pre>{/if}

    <div style="padding: 4px 14px 12px 14px">
        {#if card.status === 'pending'}<div
                style="font-size: var(--ui-font-size); color: #d9822b; display: inline-flex; align-items: center; gap: 5px"
            >
                <Clock size={13} />
                {t('mcp.timelineWaitingApproval')}
            </div>{/if}
        {#if card.status === 'running'}<div
                style="font-size: var(--ui-font-size); color: var(--accent); display: inline-flex; align-items: center; gap: 5px"
            >
                <LoaderCircle size={13} class="spin" />
                {t('mcp.timelineExecuting')}
                {#if liveElapsed}{` · ${liveElapsed}`}{:else}{/if}
            </div>{/if}
        {#if card.status === 'success' || card.status === 'failed' || card.status === 'cancelled'}<McpActionResult
                {card}
                {language}
            />{/if}
    </div>
</div>
