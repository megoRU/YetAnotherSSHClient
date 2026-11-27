<script module lang="ts">
    import { Server, Ellipsis, Globe } from '@lucide/svelte';

    import type { SSHConfig } from '../../types';

    import { getOSIcon } from '../../utils';

    import { type ElementEvent, activateOnKeydown, inlineStyle } from '../../utils/dom';

    interface ServerCardProps {
        fav: SSHConfig;
        size: 'standard' | 'compact' | 'medium';
        onClick: () => void;
        onContextMenu: (e: MouseEvent) => void;
        index: number;
        onPointerDown: (e: ElementEvent<PointerEvent, HTMLDivElement>) => void;
    }
</script>

<script lang="ts">
    let { fav, size, onClick, onContextMenu, index, onPointerDown }: ServerCardProps = $props();

    const isCompact = $derived(size === 'compact');

    const isMedium = $derived(size === 'medium');

    const isStandard = $derived(size === 'standard');
</script>

<div
    class={`server-card ${size}`}
    onclick={onClick}
    oncontextmenu={onContextMenu}
    onpointerdown={onPointerDown}
    role="button"
    tabindex={0}
    onkeydown={(event) => activateOnKeydown(event, onClick)}
    data-server-index={index}
>
    <div class={`server-card-icon-container ${size}`}>
        {#if fav.osPrettyName}<img
                src={getOSIcon(fav.osPrettyName)}
                style="width: 115%; height: 115%; object-fit: contain"
                draggable="false"
                alt={fav.osPrettyName}
            />{:else}<Server
                size={isCompact ? 18 : isMedium ? 36 : 46}
                style="color: var(--text-secondary)"
            />{/if}
    </div>

    <div class="server-card-info">
        <div
            class="text-card-title"
            style={inlineStyle({
                marginBottom: isCompact ? '0px' : isMedium ? '4px' : '8px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontSize: 'var(--ui-font-size-base)',
                fontWeight: 600,
                lineHeight: 1.2,
            })}
        >
            {fav.name || fav.host}
        </div>
        {#if isCompact}<div class="server-card-host-text">
                {fav.host}
            </div>{:else}
            <div class="server-card-tag-list" style={inlineStyle({ marginBottom: isMedium ? '4px' : '0px' })}>
                <div class="server-card-tag">SSH</div>
                {#if fav.user.trim() !== ''}<div class="server-card-tag">{fav.user.toUpperCase()}</div>{/if}
            </div>
            {#if isMedium}<div
                    style="display: flex; align-items: center; gap: 7px; color: var(--text-secondary); font-size: var(--font-size-base); font-family: var(--mono-font-family), monospace"
                >
                    <Globe size={16} />
                    {fav.host}
                </div>{/if}
        {/if}
    </div>

    {#if isStandard}<div class="server-card-meta-container">
            <div style="display: flex; align-items: center; gap: 7px">
                <Globe size={16} />
                {fav.host}
            </div>

            <button
                class="card-menu-btn"
                onclick={(e) => {
                    e.stopPropagation();
                    onContextMenu(e);
                }}
                style="background: transparent; border: none; padding: 4px; border-radius: 6px; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s, color 0.2s; margin-right: -4px"
            >
                <Ellipsis size={20} />
            </button>
        </div>{/if}

    {#if isCompact || isMedium}<button
            class="card-menu-btn"
            onclick={(e) => {
                e.stopPropagation();
                onContextMenu(e);
            }}
            style="background: transparent; border: none; padding: 8px; border-radius: 6px; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s, color 0.2s; flex-shrink: 0; align-self: center"
        >
            <Ellipsis size={20} />
        </button>{/if}
</div>
