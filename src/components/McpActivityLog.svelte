<script module lang="ts">
    import { ruPlural, type ActionCard, type ActionStatus } from '../utils/mcpActionPresentation';
    import { Terminal, Clock } from '@lucide/svelte';

    import type { McpLogItem } from '../types';

    import { createI18n, type Language } from '../utils/i18n';

    import McpActionCard from './McpActionCard.svelte';

    import { untrack } from 'svelte';

    interface McpActivityLogProps {
        logs: McpLogItem[];
        language: Language;
        onCancelRun: (runId: string) => void;
    }

    const actionCountWord = (n: number, language: Language): string => {
        if (language === 'en') return n === 1 ? 'action' : 'actions';
        return ruPlural(n, 'действие', 'действия', 'действий');
    };

    const buildActionCard = (events: McpLogItem[]): ActionCard | null => {
        const calls = events.filter((e) => e.kind === 'tool_call');
        if (calls.length === 0) return null;
        const call = calls[calls.length - 1];

        const results = events.filter((e) => e.kind === 'tool_result');
        const result = results.length > 0 ? results[results.length - 1] : undefined;

        let status: ActionStatus;
        if (result) {
            status =
                result.status === 'success' ? 'success' : result.status === 'cancelled' ? 'cancelled' : 'failed';
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
            error: result?.error ?? (status === 'cancelled' && call.error ? call.error : undefined),
        };
    };
</script>

<script lang="ts">
    let { logs, language, onCancelRun }: McpActivityLogProps = $props();

    const { t } = $derived(createI18n(language));

    let now = $state.raw(Date.now());

    const items = $derived.by(() => {
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
            list.push({ start: Math.min(...events.map((e) => e.timestamp)), card });
        }
        list.sort((a, b) => b.start - a.start);
        return list;
    });

    const hasActive = $derived(items.some((i) => i.card.status === 'pending' || i.card.status === 'running'));

    $effect(() => {
        void [hasActive];
        return untrack(() => {
            if (!hasActive) return;
            const id = setInterval(() => (now = Date.now()), 500);
            return () => clearInterval(id);
        });
    });
</script>

<div style="flex: 1; display: flex; flex-direction: column; padding: 20px; overflow: hidden; min-height: 0">
    <div
        style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-shrink: 0"
    >
        <h3
            style="margin: 0; font-size: calc(var(--font-size-base) * 1.1); font-weight: 600; display: flex; align-items: center; gap: 8px"
        >
            <Terminal size={18} style="color: var(--accent)" />
            {t('mcp.agentActivityLog')}
        </h3>
        <span style="font-size: var(--ui-font-size); color: var(--text-secondary)">
            {items.length}
            {actionCountWord(items.length, language)}
        </span>
    </div>

    <div
        style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 4px; min-height: 0"
    >
        {#if items.length === 0}<div
                style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-secondary); gap: 12px; border: 2px dashed var(--border); border-radius: 12px; padding: 40px"
            >
                <Clock size={36} style="opacity: 0.5" />
                <div style="font-size: var(--ui-font-size); font-weight: 500">
                    {t('mcp.noLogYet')}
                </div>
                <div style="font-size: var(--ui-font-size); text-align: center; max-width: 360px">
                    {t('mcp.noLogDesc')}
                </div>
            </div>{:else}{#each items as item (item.card.runId)}<McpActionCard
                    card={item.card}
                    {language}
                    {now}
                    {onCancelRun}
                />{/each}{/if}
    </div>
</div>
