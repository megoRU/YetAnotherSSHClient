<script module lang="ts">
    import type { McpAgent } from '../types';

    import { createI18n, type Language } from '../utils/i18n';

    import { agentKey, collectAgents } from '../utils/mcpAgents';

    interface McpAgentsListProps {
        agents?: McpAgent[];
        language: Language;
    }

    const MAX_VISIBLE_AGENTS = 3;
</script>

<script lang="ts">
    let { agents, language }: McpAgentsListProps = $props();

    const { t } = $derived(createI18n(language));

    const visibleAgents = $derived(collectAgents(agents).slice(0, MAX_VISIBLE_AGENTS));
</script>

{#if visibleAgents.length === 0}<div
        style="display: flex; align-items: center; gap: 6px; font-size: var(--ui-font-size); color: var(--text-secondary); background: var(--hover-surface); padding: 0 12px; height: 36px; border-radius: 6px; border: 1px solid var(--border); box-sizing: border-box; white-space: nowrap"
    >
        <span>{t('mcp.waitingForAgent')}</span>
    </div>{:else}<div
        style="display: flex; align-items: center; gap: 6px; max-width: 100%; overflow-x: auto; padding: 2px 0; scrollbar-width: thin; min-width: 0"
    >
        {#each visibleAgents as agent (agentKey(agent))}{@const displayName = agent.name
                .replace(/\s*\(.*$/, '')
                .trim()}
            <div
                style="display: inline-flex; align-items: center; gap: 6px; font-size: var(--ui-font-size); font-weight: 500; color: var(--text-primary); background: var(--hover-surface); border: 1px solid var(--border); padding: 4px 10px; border-radius: 6px; white-space: nowrap; height: 36px; box-sizing: border-box; flex-shrink: 0"
            >
                <span
                    style="width: 6px; height: 6px; border-radius: 50%; background-color: #2ea44f; display: inline-block; flex-shrink: 0"
                ></span>
                <span>{displayName}</span>
                {#if agent.version}<span
                        style="font-size: var(--ui-font-size); color: var(--text-secondary); font-weight: 400"
                    >
                        v{agent.version}
                    </span>{/if}
            </div>{/each}
    </div>{/if}
