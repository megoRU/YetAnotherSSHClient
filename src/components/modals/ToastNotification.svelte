<script module lang="ts">
    import { CircleCheck, CircleAlert, TriangleAlert, Info, X } from '@lucide/svelte';

    import type { NotificationType } from '../../types';

    import { untrack } from 'svelte';

    import { type RefObject } from '../../utils/dom';

    interface ToastNotificationProps {
        message: string;
        closeLabel: string;
        type?: NotificationType;
        duration?: number;
        onClose: () => void;
    }
</script>

<script lang="ts">
    let { message, closeLabel, type = 'success', duration = 5000, onClose }: ToastNotificationProps = $props();

    let isExiting = $state.raw(false);

    const isClosingRef = { current: false };

    const timerRef: RefObject<ReturnType<typeof setTimeout> | null> = { current: null };

    const exitTimerRef: RefObject<ReturnType<typeof setTimeout> | null> = { current: null };

    const remainingRef: RefObject<number> = { current: untrack(() => duration) };

    const startTimeRef: RefObject<number> = { current: 0 };

    const clearAllTimers = () => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (exitTimerRef.current !== null) {
            clearTimeout(exitTimerRef.current);
            exitTimerRef.current = null;
        }
    };

    const handleClose = () => {
        if (isClosingRef.current) return;
        isClosingRef.current = true;

        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }

        isExiting = true;
        exitTimerRef.current = setTimeout(() => {
            onClose();
        }, 300);
    };

    const startTimer = (time: number) => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
        }
        startTimeRef.current = Date.now();
        timerRef.current = setTimeout(() => {
            handleClose();
        }, time);
    };

    $effect(() => {
        void [startTimer, clearAllTimers];
        return untrack(() => {
            startTimer(remainingRef.current);
            return () => {
                clearAllTimers();
            };
        });
    });

    const handleMouseEnter = () => {
        if (isClosingRef.current) return;
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        const elapsed = Date.now() - startTimeRef.current;
        remainingRef.current = Math.max(1000, remainingRef.current - elapsed);
    };

    const handleMouseLeave = () => {
        if (isClosingRef.current) return;
        startTimer(remainingRef.current);
    };
</script>

<div
    class={`toast-notification ${isExiting ? 'toast-exit' : 'toast-enter'}`}
    onmouseenter={handleMouseEnter}
    onmouseleave={handleMouseLeave}
    role="status"
    aria-live="polite"
>
    {#if type === 'error'}<CircleAlert size={20} class="toast-icon toast-icon-error" />{/if}
    {#if type === 'warning'}<TriangleAlert size={20} class="toast-icon toast-icon-warning" />{/if}
    {#if type === 'info'}<Info size={20} class="toast-icon toast-icon-info" />{/if}
    {#if type === 'success'}<CircleCheck size={20} class="toast-icon toast-icon-success" />{/if}
    <span class="toast-message">
        {message}
    </span>
    <button type="button" class="toast-close-btn" onclick={handleClose} aria-label={closeLabel}>
        <X size={16} />
    </button>
</div>
