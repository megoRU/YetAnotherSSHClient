<script module lang="ts">
    import { formatDuration, ruPlural, L, type ActionCard } from '../utils/mcpActionPresentation';
    import { CircleCheck, CircleX, ChevronDown, ChevronUp, Ban } from '@lucide/svelte';

    import type { McpLogStatus } from '../types';

    import { createI18n, type Language } from '../utils/i18n';

    import { type SetStateAction, inlineStyle } from '../utils/dom';

    const nonEmptyLines = (text: string | undefined): string[] =>
        (text || '')
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);

    const buildResultSummary = (
        status: McpLogStatus,
        stdout: string | undefined,
        stderr: string | undefined,
        exitCode: number | undefined,
        durationMs: number | undefined,
        language: Language,
    ): string => {
        if (status === 'pending') return L('Ожидает подтверждения', 'Waiting for approval', language);
        if (status === 'cancelled') {
            const duration = durationMs !== undefined ? ` · ${formatDuration(durationMs, language)}` : '';
            return `${L('Отменено', 'Cancelled', language)}${duration}`;
        }
        const duration = durationMs !== undefined ? ` · ${formatDuration(durationMs, language)}` : '';
        if (status === 'failed') {
            const exit = exitCode !== undefined ? ` · ${L('Код выхода', 'Exit code', language)} ${exitCode}` : '';
            return `${L('Не удалось выполнить', 'Failed to execute', language)}${duration}${exit}`;
        }
        const count = Math.max(nonEmptyLines(stdout).length, nonEmptyLines(stderr).length);
        let summary = `${L('Готово', 'Done', language)}${duration}`;
        if (count > 0) {
            const word =
                language === 'en'
                    ? count === 1
                        ? 'line'
                        : 'lines'
                    : ruPlural(count, 'строка', 'строки', 'строк');
            summary += ` · ${language === 'en' ? 'Received' : 'Получено'} ${count} ${word}`;
        } else {
            summary += ` · ${L('Пустой вывод', 'No output', language)}`;
        }
        return summary;
    };
</script>

<script lang="ts">
    let { card, language }: { card: ActionCard; language: Language } = $props();

    const { t } = $derived(createI18n(language));

    let show = $state.raw(false);
    function setShow(next: SetStateAction<typeof show>) {
        show = typeof next === 'function' ? next(show) : next;
    }

    const hasOutput = $derived(nonEmptyLines(card.stdout).length > 0 || nonEmptyLines(card.stderr).length > 0);

    const color = $derived(
        card.status === 'success' ? '#2ea44f' : card.status === 'failed' ? '#ef4444' : '#d9822b',
    );

    const Icon = $derived(card.status === 'success' ? CircleCheck : card.status === 'failed' ? CircleX : Ban);

    const summary = $derived(
        buildResultSummary(card.status, card.stdout, card.stderr, card.exitCode, card.durationMs, language),
    );
</script>

{#snippet toggleButton()}
    {#if card.status !== 'cancelled' && hasOutput}<button
            type="button"
            class="mcp-action-control"
            onclick={() => setShow((s) => !s)}
            style="display: inline-flex; align-items: center; gap: 4px; font-size: var(--ui-font-size); padding: 2px 8px; border-radius: 5px; border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); cursor: pointer; white-space: nowrap"
        >
            {#if show}<ChevronUp size={13} />{:else}<ChevronDown size={13} />{/if}
            {#if show}{t('mcp.hideResult')}{:else}{t('mcp.showResult')}{/if}
        </button>{/if}
{/snippet}

<div style="margin-top: 6px; display: flex; flex-direction: column; gap: 4px">
    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
        <span
            style={inlineStyle({
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: 'var(--ui-font-size)',
                fontWeight: 500,
                color,
            })}
        >
            <Icon size={14} style="flex-shrink: 0" />
            {summary}
        </span>
        {#if card.status === 'failed' && card.error}<span
                style="font-size: var(--ui-font-size); color: var(--text-secondary)"
                title={card.error}
            >
                · {#if card.error.length > 120}{`${card.error.slice(0, 120)}…`}{:else}{card.error}{/if}
            </span>{/if}
        {#if card.status === 'cancelled' && card.error}<span style="font-size: var(--ui-font-size); color: #d9822b"
                >{card.error}</span
            >{/if}
        {@render toggleButton?.()}
    </div>
    {#if show && hasOutput && card.status !== 'cancelled'}<pre
            style="margin: 8px 0 0 0; padding: 10px 12px; border-radius: 6px; background: rgba(0,0,0,0.15); border: 1px solid var(--border); color: var(--text-primary); font-family: var(--mono-font-family); font-size: var(--ui-font-size); max-height: 320px; overflow-y: auto; white-space: pre-wrap; word-break: break-all">{(card.stdout ||
                '') +
                (nonEmptyLines(card.stderr).length > 0
                    ? (card.stdout?.trim() ? '\n\n[stderr]\n' : '[stderr]\n') + card.stderr
                    : '')}</pre>{/if}
</div>
