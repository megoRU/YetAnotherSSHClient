<script module lang="ts">
    import { Power, Check, Copy } from '@lucide/svelte';

    import type { SSHConfig, McpAgent } from '../types';

    import { createI18n, type Language } from '../utils/i18n';

    import { writeClipboardText } from '../utils/clipboard';

    import McpAgentsList from './McpAgentsList.svelte';

    interface McpTabHeaderProps {
        config: SSHConfig;
        isServerAllowed: boolean;
        agents?: McpAgent[];
        language: Language;
        onGrantAccess: () => void;
        onCloseAccess: () => void;
    }
</script>

<script lang="ts">
    let { config, isServerAllowed, agents, language, onGrantAccess, onCloseAccess }: McpTabHeaderProps = $props();

    const { t } = $derived(createI18n(language));

    let copiedServerContext = $state.raw(false);

    const handleCopyServerContext = async (): Promise<void> => {
        const serverName = config.name || config.host;
        const serverContext = [
            `${t('mcp.copyContextTitle')}:`,
            '',
            `- ${t('mcp.copyContextName')}: \`${serverName}\``,
            `- ${t('mcp.copyContextSsh')}: \`${config.user}@${config.host}:${config.port || 22}\``,
            `- ${t('mcp.copyContextId')}: \`${config.id || 'unknown'}\``,
            '',
            t('mcp.copyContextInstruction'),
        ].join('\n');

        try {
            await writeClipboardText(serverContext);
            copiedServerContext = true;
            window.setTimeout(() => (copiedServerContext = false), 2000);
        } catch (error) {
            console.error('[MCP] Failed to copy server context:', error);
        }
    };
</script>

<div
    style="padding: 16px 24px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; flex-shrink: 0"
>
    <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1">
        <div style="min-width: 0">
            <div
                style="font-weight: 600; font-size: calc(var(--font-size-base) * 1.05); display: flex; align-items: center; gap: 8px; flex-wrap: wrap"
            >
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                    {config.name || config.host}
                </span>
            </div>
            <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin-top: 4px">
                <div style="font-size: var(--ui-font-size); color: var(--text-secondary)">
                    {config.user}@{config.host}:{config.port || 22}
                </div>
                <button
                    type="button"
                    class="btn-secondary"
                    onclick={() => void handleCopyServerContext()}
                    style="display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; font-size: var(--font-size-secondary)"
                >
                    {#if copiedServerContext}<Check size={13} />{:else}<Copy size={13} />{/if}
                    {#if copiedServerContext}{t('common.copied')}{:else}{t('mcp.copyServerForAi')}{/if}
                </button>
            </div>
        </div>
    </div>

    <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 1; min-width: 0">
        <McpAgentsList {agents} {language} />

        {#if !isServerAllowed}<button
                class="btn-primary"
                onclick={onGrantAccess}
                style="height: 36px; padding: 0 16px; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: var(--ui-font-size); border-radius: 6px; cursor: pointer; background: #2ea44f; border-color: #2ea44f"
            >
                <Check size={16} />
                {t('mcp.grantAccess')}
            </button>{:else}<button
                class="btn-danger"
                onclick={onCloseAccess}
                style="height: 36px; padding: 0 16px; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: var(--ui-font-size); border-radius: 6px; cursor: pointer; box-sizing: border-box"
            >
                <Power size={16} />
                {t('mcp.closeAccess')}
            </button>{/if}
    </div>
</div>
