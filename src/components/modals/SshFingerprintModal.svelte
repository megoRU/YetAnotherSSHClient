<script module lang="ts">
    import { createI18n } from '../../utils/i18n';

    import ServerInfoBubble from './ServerInfoBubble.svelte';

    import type { AppConfig, SSHConfig } from '../../types';

    import type { SshFingerprintChallenge } from '../../ipc';

    import FingerprintRow from './FingerprintRow.svelte';

    import FingerprintConfirmCard from './FingerprintConfirmCard.svelte';

    import { untrack } from 'svelte';

    import { inlineStyle } from '../../utils/dom';

    interface SshFingerprintModalProps {
        /** Отпечаток, который предъявил сервер. */
        challenge: SshFingerprintChallenge;
        /** Подключаемый сервер: имя, адрес и иконка ОС для «пузыря» в окне. */
        server: SSHConfig;
        /**
         * Ответ уже отправлен, ожидается продолжение подключения.
         *
         * Нужен терминалу, где окно остаётся до статуса «соединение
         * установлено». SFTP и проброс портов окно снимают по нажатию и показывают
         * своё обычное состояние подключения, поэтому передают `false`.
         */
        isSubmitting?: boolean;
        /** Не удалось передать подтверждение подключению. */
        error?: string | null;
        appConfig?: AppConfig;
        /** Пользователь подтвердил отпечаток: он сохраняется и подключение продолжается. */
        onAccept: () => void;
        /** Пользователь отклонил отпечаток: подключение отменяется, сохранённое значение не меняется. */
        onReject: () => void;
    }
</script>

<script lang="ts">
    let {
        challenge,
        server,
        isSubmitting = false,
        error,
        appConfig,
        onAccept,
        onReject,
    }: SshFingerprintModalProps = $props();

    const { t } = $derived(createI18n(appConfig?.language || 'ru'));

    const changed = $derived(!!challenge.previous && challenge.previous !== challenge.fingerprint);

    $effect(() => {
        void [onReject, isSubmitting];
        return untrack(() => {
            const handleKeyDown = (e: KeyboardEvent) => {
                // Escape равнозначно отклонению: подключение без явного согласия
                // продолжаться не должно.
                if (e.key === 'Escape' && !isSubmitting) {
                    e.preventDefault();
                    onReject();
                }
            };
            window.addEventListener('keydown', handleKeyDown);
            return () => window.removeEventListener('keydown', handleKeyDown);
        });
    });
</script>

<div
    style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; z-index: 2000"
>
    <div
        style="padding: 20px 24px 24px; width: 520px; max-width: 90%; box-sizing: border-box; color: var(--text-primary); position: relative; display: flex; flex-direction: column; gap: 16px"
    >
        <h3 style="margin: 0; font-size: 1.2rem; font-weight: 600">
            {t('terminal.fingerprintChangedTitle')}
        </h3>

        <ServerInfoBubble {server} />

        {#if changed}
            <div
                style="padding: 10px 12px; border-radius: 10px; background: var(--danger-color, #ef4444); color: #fff; font-size: 0.9rem; line-height: 1.4"
            >
                {t('terminal.fingerprintChangedWarning')}
            </div>
            <p style="margin: 0; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.4">
                {t('terminal.fingerprintChangedDesc')}
            </p>
        {/if}

        {#if !changed && !challenge.serverId}<div
                style="padding: 10px 12px; border-radius: 10px; background: var(--hover-surface); border: 1px solid var(--border); color: var(--text-secondary); font-size: 0.9rem; line-height: 1.4"
            >
                {t('terminal.fingerprintNotSaved')}
            </div>{/if}

        {#if changed}<FingerprintRow label={t('terminal.fingerprintPrevious')} value={challenge.previous!} />{/if}

        {#if changed}<FingerprintRow
                label={t('terminal.fingerprintNew')}
                value={challenge.fingerprint}
                highlight
            />{:else}<FingerprintConfirmCard
                title={t('terminal.fingerprintTitle')}
                fingerprint={challenge.fingerprint}
            />{/if}

        {#if error}<p role="alert" style="margin: 0; color: var(--danger-color, #ef4444); font-size: 0.9rem">
                {error}
            </p>{/if}

        <div style="display: flex; gap: 10px">
            <button
                type="button"
                class="btn-secondary"
                onclick={onReject}
                disabled={isSubmitting}
                style="flex: 1; padding: 10px; display: flex; align-items: center; justify-content: center; gap: 6px"
            >
                {t('terminal.fingerprintReject')}
            </button>
            <button
                type="button"
                class="btn-primary"
                onclick={onAccept}
                disabled={isSubmitting}
                style={inlineStyle({
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    opacity: isSubmitting ? 0.5 : 1,
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                })}
            >
                {#if isSubmitting}{t('terminal.connecting')}{:else}{t('terminal.fingerprintAccept')}{/if}
            </button>
        </div>
    </div>
</div>
