<script module lang="ts">
    import { onImageError } from '../../utils/dom';
    import { X, Server } from '@lucide/svelte';

    import type { SSHConfig, AppConfig } from '../../types';

    import { createI18n } from '../../utils/i18n';

    import { getOSIcon } from '../../utils';

    import { untrack } from 'svelte';

    interface DeleteServerModalProps {
        server: SSHConfig;
        onConfirm: () => void;
        onCancel: () => void;
        appConfig?: AppConfig;
    }
</script>

<script lang="ts">
    const titleId = $props.id();
    let { server, onConfirm, onCancel, appConfig }: DeleteServerModalProps = $props();

    const { t } = $derived(createI18n(appConfig?.language || 'ru'));

    let iconError = $state.raw(false);

    $effect(() => {
        void [onCancel];
        return untrack(() => {
            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                }
            };

            window.addEventListener('keydown', handleKeyDown);
            return () => window.removeEventListener('keydown', handleKeyDown);
        });
    });

    const serverName = $derived(server.name || server.host);

    const username = $derived(server.user || 'root');

    const osIconUrl = $derived(server.osPrettyName ? getOSIcon(server.osPrettyName) : null);
</script>

<div
    role="presentation"
    style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 2000"
    onclick={(event) => {
        if (event.target === event.currentTarget) onCancel();
    }}
>
    <div
        style="background: var(--background); padding: 20px 24px 24px; border-radius: 12px; width: 400px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); border: 1px solid var(--border); color: var(--text-primary); position: relative; display: flex; flex-direction: column; gap: 16px"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
    >
        <!-- Header -->
        <div style="display: flex; align-items: center; justify-content: space-between">
            <h3 id={titleId} style="margin: 0; font-size: 1.2rem; font-weight: 600">
                {t('modals.deleteServerTitle')}
            </h3>
            <button
                onclick={onCancel}
                class="modal-close-btn"
                aria-label={t('common.close')}
                style="background: none; border: none; padding: 4px; cursor: pointer; color: var(--text-secondary); display: flex; align-items: center; justify-content: center; border-radius: 6px; transition: all 0.2s"
            >
                <X size={18} />
            </button>
        </div>

        <!-- Confirmation message -->
        <p style="margin: 0; color: var(--text-secondary); font-size: 0.95rem; line-height: 1.4">
            {t('modals.deleteServerConfirm')}
        </p>

        <!-- Server Bubble / Card -->
        <div
            style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--hover-surface); border: 1px solid var(--border); border-radius: 10px"
        >
            {#if osIconUrl && !iconError}<img
                    src={osIconUrl}
                    alt="OS"
                    {@attach onImageError(() => (iconError = true))}
                    style="width: 28px; height: 28px; object-fit: contain; flex-shrink: 0"
                    draggable="false"
                />{:else}<Server size={28} style="color: var(--text-secondary); flex-shrink: 0" />{/if}
            <div style="display: flex; flex-direction: column; gap: 2px; overflow: hidden">
                <span
                    style="font-weight: 600; font-size: 0.95rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis"
                >
                    {serverName}
                </span>
                <span style="font-size: 0.8rem; color: var(--text-secondary)">
                    SSH {username}
                </span>
            </div>
        </div>

        <!-- Action button -->
        <div style="display: flex; justify-content: flex-end; margin-top: 4px">
            <button
                class="btn-danger"
                style="padding: 8px 20px; border-radius: 8px; font-weight: 600; font-size: 0.95rem; cursor: pointer"
                onclick={onConfirm}
            >
                {t('common.delete')}
            </button>
        </div>
    </div>
</div>
