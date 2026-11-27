<script module lang="ts">
    import { Key, Copy, Check, ShieldAlert } from '@lucide/svelte';

    import { createI18n } from '../../utils/i18n';

    import { copyToClipboard } from '../../utils/clipboard';

    import type { AppConfig } from '../../types';

    interface RecoveryKeyModalProps {
        recoveryKey: string;
        onConfirm: () => void;
        appConfig: AppConfig;
        isRegenerated?: boolean;
    }
</script>

<script lang="ts">
    let { recoveryKey, onConfirm, appConfig, isRegenerated }: RecoveryKeyModalProps = $props();

    const { t } = $derived(createI18n(appConfig.language));

    let copied = $state.raw(false);

    const handleCopy = () => {
        copyToClipboard(recoveryKey);
        copied = true;
        setTimeout(() => (copied = false), 2000);
    };
</script>

<div class="modal-overlay" style="z-index: 3000">
    <div class="modal-content" style="max-width: 500px; padding: 32px">
        <div style="display: flex; flex-direction: column; align-items: center; text-align: center; gap: 20px">
            <div
                style="width: 64px; height: 64px; border-radius: 20px; background: rgba(var(--accent-rgb), 0.1); color: var(--accent); display: flex; align-items: center; justify-content: center"
            >
                <Key size={32} />
            </div>

            <div>
                <h2 style="margin: 0 0 8px">
                    {#if isRegenerated}{t('vault.newKeyTitle')}{:else}{t('vault.keyTitle')}{/if}
                </h2>
                <p style="opacity: 0.7; font-size: 0.95rem; line-height: 1.5">
                    {t('vault.keyDesc')}
                </p>
            </div>

            <div
                style="width: 100%; border: 1px solid var(--border); border-radius: 12px; padding: 16px; position: relative; display: flex; flex-direction: column; gap: 12px"
            >
                <div
                    style="font-family: monospace; font-size: 1.1rem; word-break: break-all; color: var(--text-primary); padding: 8px"
                >
                    {recoveryKey}
                </div>
                <button
                    onclick={handleCopy}
                    class="btn-secondary"
                    style="width: 100%; gap: 10px; display: flex; justify-content: center; align-items: center; padding: 12px"
                >
                    {#if copied}<Check size={16} />{:else}<Copy size={16} />{/if}
                    {#if copied}{t('common.copied')}{:else}{t('common.copy')}{/if}
                </button>
            </div>

            <div
                style="display: flex; gap: 12px; padding: 12px; background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; text-align: left"
            >
                <ShieldAlert size={20} style="color: #ef4444; flex-shrink: 0" />
                <div style="font-size: var(--ui-font-size); color: #ef4444; font-weight: 500">
                    {t('vault.keyWarning')}
                </div>
            </div>

            <button onclick={onConfirm} class="btn-primary" style="width: 100%; padding: 14px; margin-top: 10px">
                {t('common.confirm')}
            </button>
        </div>
    </div>
</div>
