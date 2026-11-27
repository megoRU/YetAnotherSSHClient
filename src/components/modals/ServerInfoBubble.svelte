<script module lang="ts">
    import { onImageError } from '../../utils/dom';
    import { Server } from '@lucide/svelte';

    import { getOSIcon } from '../../utils';

    import type { SSHConfig } from '../../types';

    interface ServerInfoBubbleProps {
        /** Сервер: имя, адрес и иконка ОС. */
        server: SSHConfig;
    }
</script>

<script lang="ts">
    let { server }: ServerInfoBubbleProps = $props();

    let iconError = $state.raw(false);

    const osIconUrl = $derived(server.osPrettyName ? getOSIcon(server.osPrettyName) : null);

    const serverName = $derived(server.name || server.host);

    const address = $derived(`${server.user ? `${server.user}@` : ''}${server.host}:${server.port}`);
</script>

<div
    style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--hover-surface); border: 1px solid var(--border); border-radius: 10px"
>
    {#if osIconUrl && !iconError}<img
            src={osIconUrl}
            alt="OS"
            {@attach onImageError(() => (iconError = true))}
            style="width: 34px; height: 34px; object-fit: contain; flex-shrink: 0"
            draggable="false"
        />{:else}<Server size={34} style="color: var(--text-secondary); flex-shrink: 0" />{/if}
    <div style="display: flex; flex-direction: column; gap: 2px; overflow: hidden">
        <span
            style="font-weight: 600; font-size: var(--ui-font-size); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis"
        >
            {serverName}
        </span>
        <span style="font-size: 0.9rem; color: var(--text-secondary)">
            {address}
        </span>
    </div>
</div>
