<script module lang="ts">
    import { createI18n } from '../../utils/i18n';

    import ServerInfoBubble from './ServerInfoBubble.svelte';

    import type { AppConfig, SSHConfig } from '../../types';

    import { onMount, untrack } from 'svelte';

    import { type RefObject, focusOnMount, inlineStyle } from '../../utils/dom';

    interface LoginPromptModalProps {
        /** Подключаемый сервер: имя, адрес и иконка ОС для «пузыря» в окне. */
        server: SSHConfig;
        /** Сервер сохранён в избранном: введённый логин будет сохранён. */
        willSave: boolean;
        appConfig?: AppConfig;
        onSubmit: (user: string) => void;
        onCancel: () => void;
    }
</script>

<script lang="ts">
    const fieldId = $props.id();

    let { server, willSave, appConfig, onSubmit, onCancel }: LoginPromptModalProps = $props();

    const { t } = $derived(createI18n(appConfig?.language || 'ru'));

    let user = $state.raw('');

    const userInputRef: RefObject<HTMLInputElement | null> = $state({ current: null });

    onMount(() => {
        // Терминал может получить фокус в том же кадре, когда сервер запросил
        // логин. Ставим фокус после монтирования окна, чтобы ввод сразу шёл в поле.
        userInputRef.current?.focus();
    });

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

    const handleSubmit = (e: SubmitEvent) => {
        e.preventDefault();
        const value = user.trim();
        if (!value) return;
        onSubmit(value);
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
            {t('terminal.loginRequired')}
        </h3>

        <ServerInfoBubble {server} />

        <div style="display: flex; flex-direction: column; gap: 6px">
            <label for={fieldId + '-user'} style="font-size: 0.93rem; color: var(--text-primary)">
                {t('connection.user')}
            </label>
            <input
                id={fieldId + '-user'}
                bind:this={userInputRef.current}
                use:focusOnMount
                type="text"
                value={user}
                oninput={(e) => (user = e.currentTarget.value)}
                placeholder="root"
                style="width: 100%; padding: 10px; box-sizing: border-box"
            />
        </div>

        <div style="display: flex; gap: 10px">
            <button type="button" class="btn-secondary" onclick={onCancel} style="flex: 1; padding: 10px">
                {t('common.cancel')}
            </button>
            <button
                type="submit"
                class="btn-primary"
                disabled={user.trim() === ''}
                style={inlineStyle({
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    fontWeight: 600,
                    opacity: user.trim() !== '' ? 1 : 0.5,
                    cursor: user.trim() !== '' ? 'pointer' : 'not-allowed',
                })}
            >
                {#if willSave}{t('terminal.loginContinueAndSave')}{:else}{t('terminal.loginContinue')}{/if}
            </button>
        </div>
    </form>
</div>
