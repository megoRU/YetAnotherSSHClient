<script module lang="ts">
    import { Lock, LockOpen } from '@lucide/svelte';

    import { createI18n } from '../../utils/i18n';

    import type { AppConfig } from '../../types';

    import { focusOnMount, inlineStyle } from '../../utils/dom';

    interface VaultUnlockModalProps {
        onUnlock: (key: string) => Promise<boolean>;
        onResetPasswords: () => Promise<void>;
        appConfig: AppConfig;
    }
</script>

<script lang="ts">
    let { onUnlock, onResetPasswords, appConfig }: VaultUnlockModalProps = $props();

    const { t } = $derived(createI18n(appConfig.language));

    let key = $state.raw('');

    let loading = $state.raw(false);

    let error = $state.raw(false);

    let confirmReset = $state.raw(false);

    const handleSubmit = async (e: SubmitEvent) => {
        e.preventDefault();
        if (!key.trim()) return;

        loading = true;
        error = false;
        const success = await onUnlock(key.trim());
        loading = false;

        if (!success) {
            error = true;
        }
    };

    const handleResetPasswords = async () => {
        loading = true;
        await onResetPasswords();
        loading = false;
        confirmReset = false;
    };
</script>

<div class="modal-overlay" style="z-index: 4000">
    <div class="modal-content" style="max-width: 450px; padding: 32px">
        <form
            onsubmit={handleSubmit}
            style="display: flex; flex-direction: column; align-items: center; text-align: center; gap: 20px"
        >
            <div
                style="width: 64px; height: 64px; border-radius: 20px; background: var(--accent); color: white; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 16px rgba(var(--accent-rgb), 0.2)"
            >
                <Lock size={32} />
            </div>

            <div>
                <h2 style="margin: 0 0 8px">{t('vault.unlockTitle')}</h2>
                <p style="opacity: 0.7; font-size: 0.95rem">
                    {t('vault.unlockDesc')}
                </p>
            </div>

            <div style="width: 100%">
                <input
                    use:focusOnMount
                    type="password"
                    value={key}
                    oninput={(e) => (key = e.currentTarget.value)}
                    placeholder={t('vault.keyPlaceholder')}
                    style={inlineStyle({
                        width: '100%',
                        padding: '14px',
                        textAlign: 'center',
                        fontSize: 'var(--ui-font-size)',
                        border: error ? '2px solid #ef4444' : '1px solid var(--border)',
                    })}
                />
                {#if error}<div
                        style="color: #ef4444; font-size: var(--ui-font-size); margin-top: 8px; font-weight: 500"
                    >
                        {t('vault.invalidKey')}
                    </div>{/if}
            </div>

            <button
                disabled={loading || !key.trim()}
                class="btn-primary"
                style="width: 100%; padding: 14px; gap: 10px; display: flex; justify-content: center; align-items: center"
            >
                {#if loading}<div
                        class="loading-spinner"
                        style="width: 16px; height: 16px; border-top-color: white"
                    ></div>{:else}<LockOpen size={18} />{/if}
                {t('vault.unlockAction')}
            </button>
            {#if !confirmReset}<button
                    type="button"
                    class="btn-secondary"
                    onclick={() => (confirmReset = true)}
                    style="width: 100%; padding: 12px"
                >
                    {t('vault.resetServerPasswords')}
                </button>{:else}<div
                    style="width: 100%; border: 1px solid var(--border); border-radius: 10px; padding: 12px"
                >
                    <div style="font-size: var(--ui-font-size); margin-bottom: 10px; opacity: 0.85">
                        {t('vault.resetDesc')}
                    </div>
                    <div style="display: flex; gap: 8px">
                        <button
                            type="button"
                            class="btn-danger"
                            disabled={loading}
                            onclick={handleResetPasswords}
                            style="flex: 1; padding: 10px"
                        >
                            {t('vault.resetAction')}
                        </button>
                        <button
                            type="button"
                            class="btn-secondary"
                            disabled={loading}
                            onclick={() => (confirmReset = false)}
                            style="flex: 1; padding: 10px"
                        >
                            {t('common.cancel')}
                        </button>
                    </div>
                </div>{/if}
        </form>
    </div>
</div>
