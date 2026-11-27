<script module lang="ts">
    import { CircleCheck, CircleAlert, Info, LoaderCircle } from '@lucide/svelte';

    import type { NotificationAction, NotificationType } from '../../types';

    interface NotificationModalProps {
        title: string;
        message: string;
        type?: NotificationType;
        action?: NotificationAction;
        onClose: () => void;
    }
</script>

<script lang="ts">
    const titleId = $props.id();
    let { title, message, type = 'info', action, onClose }: NotificationModalProps = $props();

    let isRunningAction = $state.raw(false);

    const handleAction = async (): Promise<void> => {
        if (!action || isRunningAction) return;

        isRunningAction = true;
        try {
            await action.onClick();
            onClose();
        } catch {
            // Обработчик действия сам показывает сообщение об ошибке.
        } finally {
            isRunningAction = false;
        }
    };
</script>

{#snippet getIcon()}
    {#if type === 'success'}<CircleCheck color="#4caf50" size={32} />{:else if type === 'error'}<CircleAlert
            color="#e81123"
            size={32}
        />{:else}<Info color="var(--primary-color)" size={32} />{/if}
{/snippet}

<svelte:window
    onkeydown={(event) => {
        if (event.key === 'Escape' && !isRunningAction && !event.defaultPrevented) onClose();
    }}
/>

<div
    class="modal-overlay"
    role="presentation"
    style="z-index: 4000"
    onclick={(event) => {
        if (event.target === event.currentTarget && !isRunningAction) onClose();
    }}
>
    <div
        class="modal-content"
        style="width: 400px; padding: 30px; text-align: center"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
    >
        <div style="display: flex; flex-direction: column; align-items: center; gap: 15px; margin-bottom: 20px">
            {@render getIcon()}
            <h3 id={titleId} style="margin: 0; font-size: 1.4em">{title}</h3>
        </div>

        <div
            style="opacity: 0.8; line-height: 1.5; margin-bottom: 25px; white-space: pre-wrap; text-align: left; max-height: 300px; overflow-y: auto; padding: 0 10px"
        >
            {message}
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px">
            {#if action}<div style="display: flex; gap: 10px">
                    <button
                        class="btn-secondary"
                        style="flex: 1; padding: 12px; border-radius: 8px; font-weight: bold"
                        onclick={onClose}
                        disabled={isRunningAction}
                    >
                        {action.cancelLabel || 'Отмена'}
                    </button>
                    <button
                        class="btn-primary"
                        style="flex: 1; padding: 12px; border-radius: 8px; font-weight: bold; background: #ef4444"
                        onclick={() => void handleAction()}
                        disabled={isRunningAction}
                    >
                        {#if isRunningAction}<LoaderCircle size={16} class="spin" />{/if}
                        {action.label}
                    </button>
                </div>{:else}<button
                    class="btn-primary"
                    style="width: 100%; padding: 12px; border-radius: 8px; font-weight: bold"
                    onclick={onClose}
                >
                    OK
                </button>{/if}
        </div>
    </div>
</div>
