<script module lang="ts">
    import { Server } from '@lucide/svelte';

    import type { SSHConfig } from '../../types';

    import { getOSIcon } from '../../utils';

    interface SidebarItemProps {
        fav: SSHConfig;
        onClick: () => void;
        onContextMenu: (e: MouseEvent) => void;
    }
</script>

<script lang="ts">
    let { fav, onClick, onContextMenu }: SidebarItemProps = $props();
</script>

<button
    type="button"
    class="plain-button plain-button-wide fav-item"
    onclick={onClick}
    oncontextmenu={onContextMenu}
    style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; cursor: pointer; user-select: none"
>
    <span
        style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; flex-shrink: 0"
    >
        {#if fav.osPrettyName}<img
                src={getOSIcon(fav.osPrettyName)}
                alt={fav.osPrettyName}
                style="width: 100%; height: 100%; object-fit: contain"
                draggable="false"
                loading="lazy"
                decoding="async"
            />{:else}<Server size={16} style="color: var(--text-secondary)" />{/if}
    </span>
    <span style="flex: 1; min-width: 0">
        <span
            style="display: block; font-size: 1.05rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-primary); margin-bottom: 2px"
        >
            {fav.name || fav.host}
        </span>
        <span
            style="display: block; font-size: 0.85rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.8"
        >
            {fav.host}
        </span>
    </span>
</button>
