<script module lang="ts">
    import { ClipboardPaste, Eye, EyeOff, FileKey, KeyRound, Trash2 } from '@lucide/svelte';

    import { createI18n } from '../../utils/i18n';

    import { usePrivateKeyInput } from '../../hooks/usePrivateKeyInput.svelte';

    import ServerInfoBubble from './ServerInfoBubble.svelte';

    import { looksLikePrivateKey } from '../../utils/privateKey';

    import type { AppConfig, SSHConfig } from '../../types';

    import { MAX_AUTH_ATTEMPTS, type SshAuthChallenge } from '../../ipc';

    import { untrack } from 'svelte';

    import { focusOnMount, inlineStyle } from '../../utils/dom';

    type AuthTab = 'password' | 'key';

    interface SshAuthModalProps {
        /** Запрос авторизации, пришедший от main-процесса. */
        challenge: SshAuthChallenge;
        /** Подключаемый сервер: имя, адрес и иконка ОС для «пузыря» в окне. */
        server: SSHConfig;
        /** Сервер сохранён в избранном: введённые данные будут сохранены. */
        willSave: boolean;
        /** Данные отправлены, ожидается ответ сервера. */
        isSubmitting: boolean;
        /** Ошибка применения введённых данных (например, не удалось зашифровать ключ). */
        error?: string | null;
        appConfig?: AppConfig;
        /** Ответ на запрос пароля или парольной фразы. */
        onSubmitSecret: (secret: string) => void;
        /** Ответ содержимым приватного ключа (из файла или вставленный). */
        onSubmitKey: (keyContent: string) => void;
        onCancel: () => void;
    }
</script>

<script lang="ts">
    const fieldId = $props.id();

    let {
        challenge,
        server,
        willSave,
        isSubmitting,
        error,
        appConfig,
        onSubmitSecret,
        onSubmitKey,
        onCancel,
    }: SshAuthModalProps = $props();

    const { t } = $derived(createI18n(appConfig?.language || 'ru'));

    let tab = $state.raw<AuthTab>('password');

    let secret = $state.raw('');

    let showSecret = $state.raw(false);

    const privateKeyInput = usePrivateKeyInput(() => appConfig);

    $effect(() => {
        void [onCancel, isSubmitting];
        return untrack(() => {
            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'Escape' && !isSubmitting) {
                    e.preventDefault();
                    onCancel();
                }
            };
            window.addEventListener('keydown', handleKeyDown);
            return () => window.removeEventListener('keydown', handleKeyDown);
        });
    });

    const isPassphrase = $derived(challenge.kind === 'passphrase');

    const secretLabel = $derived(
        challenge.prompt || (isPassphrase ? t('terminal.authPassphrase') : t('terminal.authPassword')),
    );

    const canSubmit = $derived(tab === 'password' ? secret !== '' : looksLikePrivateKey(privateKeyInput.keyDraft));

    const handleSubmit = (e: SubmitEvent) => {
        e.preventDefault();
        if (isSubmitting || !canSubmit) return;

        if (tab === 'password') {
            onSubmitSecret(secret);
            return;
        }

        if (!looksLikePrivateKey(privateKeyInput.keyDraft)) {
            privateKeyInput.setKeyError(t('errors.invalidPrivateKey'));
            return;
        }
        onSubmitKey(privateKeyInput.keyDraft);
    };
</script>

<div
    style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; z-index: 2000"
>
    <form
        onsubmit={handleSubmit}
        style="padding: 20px 24px 24px; width: 480px; max-width: 90%; box-sizing: border-box; color: var(--text-primary); position: relative; display: flex; flex-direction: column; gap: 16px"
    >
        <h3 style="margin: 0; font-size: 1.2rem; font-weight: 600">
            {t('terminal.authTitle')}
        </h3>

        <ServerInfoBubble {server} />

        {#if challenge.instructions}<div style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.4">
                {challenge.instructions}
            </div>{/if}

        {#if error}<div
                style="padding: 10px 12px; border-radius: 10px; background: var(--danger-color, #ef4444); color: #fff; font-size: 0.9rem"
            >
                {error}
            </div>{/if}

        {#if challenge.failed && challenge.attempt > 1}<div
                style="padding: 10px 12px; border-radius: 10px; background: var(--danger-color, #ef4444); color: #fff; font-size: 0.9rem"
            >
                {t('terminal.authRetryHint', { n: String(challenge.attempt), max: String(MAX_AUTH_ATTEMPTS) })}
            </div>{/if}

        <div class="auth-tabs">
            <button
                type="button"
                class={`auth-tab${tab === 'password' ? ' active' : ''}`}
                onclick={() => (tab = 'password')}
            >
                {#if isPassphrase}{t('terminal.authPassphraseTab')}{:else}{t('terminal.authPasswordTab')}{/if}
            </button>
            <button
                type="button"
                class={`auth-tab${tab === 'key' ? ' active' : ''}`}
                onclick={() => (tab = 'key')}
            >
                <KeyRound size={15} />
                {t('terminal.authKeyTab')}
            </button>
        </div>

        {#if tab === 'password'}<div style="display: flex; flex-direction: column; gap: 6px">
                <label for={fieldId + '-secretLabel'} style="font-size: 0.93rem; color: var(--text-primary)">
                    {secretLabel}
                </label>
                <div style="position: relative">
                    <input
                        id={fieldId + '-secretLabel'}
                        use:focusOnMount
                        type={showSecret ? 'text' : 'password'}
                        value={secret}
                        oninput={(e) => (secret = e.currentTarget.value)}
                        placeholder="••••••••"
                        style="width: 100%; padding: 10px; padding-right: 40px; box-sizing: border-box"
                    />
                    <button
                        type="button"
                        aria-label={t('connection.showSecret')}
                        aria-pressed={showSecret}
                        class="plain-button"
                        onclick={() => (showSecret = !showSecret)}
                        style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; display: flex; align-items: center; opacity: 0.5"
                    >
                        {#if showSecret}<EyeOff size={18} />{:else}<Eye size={18} />{/if}
                    </button>
                </div>
            </div>{:else}<div style="display: flex; flex-direction: column; gap: 6px">
                <span class="settings-label" style="font-size: 0.93rem; color: var(--text-primary)">
                    {t('terminal.authPrivateKey')}
                </span>
                {#if privateKeyInput.hasDraft}
                    <div style="color: #22c55e; font-weight: 600; font-size: var(--font-size-secondary)">
                        {t('connection.keySaved')}
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 4px">
                        <button
                            type="button"
                            class="btn-danger"
                            onclick={privateKeyInput.clearKeyDraft}
                            style="padding: 8px 15px; border-radius: 6px; display: flex; align-items: center; gap: 6px"
                        >
                            <Trash2 size={16} />
                            {t('common.delete')}
                        </button>
                    </div>
                {:else}<div style="display: flex; gap: 10px; margin-top: 4px; justify-content: center">
                        <button
                            type="button"
                            class="btn-secondary"
                            onclick={privateKeyInput.loadFromFile}
                            style="padding: 8px 15px; border-radius: 6px; display: flex; align-items: center; gap: 6px"
                        >
                            <FileKey size={16} />
                            {t('connection.loadFromFile')}
                        </button>
                        <button
                            type="button"
                            class="btn-secondary"
                            onclick={privateKeyInput.pasteFromClipboard}
                            style="padding: 8px 15px; border-radius: 6px; display: flex; align-items: center; gap: 6px"
                        >
                            <ClipboardPaste size={16} />
                            {t('connection.pasteFromClipboard')}
                        </button>
                    </div>{/if}
                {#if privateKeyInput.keyError}<div
                        style="color: var(--danger-color, #ef4444); font-size: var(--ui-font-size); margin-top: 8px"
                    >
                        {privateKeyInput.keyError}
                    </div>{/if}
            </div>{/if}

        <div style="display: flex; gap: 10px">
            <button
                type="button"
                class="btn-secondary"
                onclick={onCancel}
                disabled={isSubmitting}
                style="flex: 1; padding: 10px"
            >
                {t('common.cancel')}
            </button>
            <button
                type="submit"
                class="btn-primary"
                disabled={!canSubmit || isSubmitting}
                style={inlineStyle({
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    fontWeight: 600,
                    opacity: canSubmit && !isSubmitting ? 1 : 0.5,
                    cursor: canSubmit && !isSubmitting ? 'pointer' : 'not-allowed',
                })}
            >
                {#if isSubmitting}{t('terminal.connecting')}{:else if willSave}{t(
                        'terminal.authConnectAndSave',
                    )}{:else}{t('common.connect')}{/if}
            </button>
        </div>
    </form>
</div>
