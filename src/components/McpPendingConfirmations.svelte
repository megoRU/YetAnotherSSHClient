<script module lang="ts">
    import { Shield } from '@lucide/svelte';

    import type { McpConfirmationRequest } from '../types';

    import { createI18n, type Language } from '../utils/i18n';

    interface McpPendingConfirmationsProps {
        confirmations: McpConfirmationRequest[];
        language: Language;
        onConfirm: (id: string, approved: boolean) => void;
    }
</script>

<script lang="ts">
    let { confirmations, language, onConfirm }: McpPendingConfirmationsProps = $props();

    const { t } = $derived(createI18n(language));
</script>

{#if !(confirmations.length === 0)}<div
        style="padding: 16px 24px; background: rgba(217, 130, 43, 0.12); border-bottom: 1px solid rgba(217, 130, 43, 0.3); flex-shrink: 0"
    >
        {#each confirmations as req (req.id)}<div
                style="display: flex; align-items: center; justify-content: space-between; gap: 16px"
            >
                <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0">
                    <Shield size={20} style="color: #d9822b; flex-shrink: 0" />
                    <div style="overflow: hidden">
                        <div
                            style="font-weight: 600; font-size: var(--font-size-secondary); color: var(--text-primary)"
                        >
                            {t('mcp.commandApprovalRequired')}
                        </div>
                        <code
                            style="display: block; font-size: var(--ui-font-size); color: var(--text-primary); background: var(--hover-surface); padding: 4px 8px; border-radius: 4px; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis"
                        >
                            {req.command}
                        </code>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; flex-shrink: 0">
                    <button
                        class="btn-primary"
                        onclick={() => onConfirm(req.id, true)}
                        style="padding: 6px 14px; background: #2ea44f; border-color: #2ea44f; font-size: var(--ui-font-size)"
                    >
                        {t('common.confirm')}
                    </button>
                    <button
                        class="btn-secondary"
                        onclick={() => onConfirm(req.id, false)}
                        style="padding: 6px 14px; font-size: var(--ui-font-size)"
                    >
                        {t('common.cancel')}
                    </button>
                </div>
            </div>{/each}
    </div>{/if}
