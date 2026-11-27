<script lang="ts">
    import App from '../../App.svelte';

    function isRussian() {
        try {
            const lang = localStorage.getItem('last-lang') || 'ru';
            return lang === 'ru' || lang === 'sov';
        } catch {
            return true;
        }
    }
</script>

<svelte:boundary onerror={(error) => console.error('ErrorBoundary caught an error', error)}>
    <App />

    {#snippet failed(error)}
        {@const isRu = isRussian()}
        <div style="padding: 40px; color: #cc241d; background: #fbf1c7; height: 100vh; font-family: monospace">
            <h1 style="margin-bottom: 20px">{isRu ? 'Произошла ошибка' : 'An error occurred'}</h1>
            <div
                style="background: rgba(0,0,0,0.05); padding: 20px; border-radius: 8px; margin-bottom: 20px; overflow: auto; max-height: 60vh"
            >
                <pre style="margin: 0; white-space: pre-wrap; word-break: break-all">{error instanceof Error
                        ? error.stack || error.toString()
                        : String(error)}</pre>
            </div>
            <button
                onclick={() => window.location.reload()}
                style="padding: 10px 20px; background: #af3a03; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold"
            >
                {isRu ? 'Перезагрузить приложение' : 'Reload Application'}
            </button>
        </div>
    {/snippet}
</svelte:boundary>
