<script module lang="ts">
    import { onMount, untrack } from 'svelte';

    import {
        type MenuIcon,
        type RefObject,
        type SetStateAction,
        inlineStyle,
        portalToBody,
    } from '../../utils/dom';

    interface ContextMenuOption {
        label: string;
        icon?: MenuIcon;
        onClick: () => void;
        danger?: boolean;
    }

    interface ContextMenuProps {
        x: number;
        y: number;
        options: ContextMenuOption[];
        onClose: () => void;
    }
</script>

<script lang="ts">
    let { x, y, options, onClose }: ContextMenuProps = $props();

    const menuRef: RefObject<HTMLDivElement | null> = $state({ current: null });

    let pos = $state.raw({ left: 0, top: 0, ready: false });
    function setPos(next: SetStateAction<typeof pos>) {
        pos = typeof next === 'function' ? next(pos) : next;
    }

    onMount(() => {
        const previousFocus = document.activeElement;

        if (previousFocus?.matches(':focus-visible')) {
            menuRef.current?.querySelector('button')?.focus({ preventScroll: true });
        }

        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
                onClose();
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                const focusInMenu = menuRef.current?.contains(document.activeElement);
                onClose();
                if (focusInMenu && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
                    previousFocus.focus({ preventScroll: true });
                }
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    });

    $effect(() => {
        void [x, y, menuRef.current];
        return untrack(() => {
            if (!menuRef.current) return;

            const { innerWidth, innerHeight } = window;
            const { offsetWidth, offsetHeight } = menuRef.current;

            let left = x + 2;
            let top = y + 2;

            if (left + offsetWidth > innerWidth) {
                left = innerWidth - offsetWidth - 8;
            }

            if (top + offsetHeight > innerHeight) {
                top = innerHeight - offsetHeight - 8;
            }

            setPos((prev) => {
                if (prev.left === left && prev.top === top && prev.ready) return prev;
                return { left, top, ready: true };
            });
        });
    });
</script>

<div
    bind:this={menuRef.current}
    use:portalToBody
    style={inlineStyle({
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        boxShadow: '0 15px 35px rgba(0,0,0,0.2)',
        zIndex: 9999,
        minWidth: '200px',
        padding: '6px',
        opacity: pos.ready ? 1 : 0,
        pointerEvents: pos.ready ? 'auto' : 'none',
        transition: 'opacity 0.1s ease',
    })}
>
    {#each options as option, index (index)}<button
            type="button"
            class="plain-button plain-button-wide menu-dropdown-item"
            style={inlineStyle({
                padding: '10px 16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                color: option.danger ? '#ef4444' : 'var(--text-primary)',
                fontWeight: '500',
                fontSize: 'calc(var(--font-size-base) - 1px)',
                borderRadius: '8px',
                marginBottom: '2px',
                transition: 'background-color 0.15s ease, color 0.15s ease',
            })}
            onclick={(e) => {
                e.stopPropagation();
                option.onClick();
                onClose();
            }}
        >
            {#if option.icon}
                {@const { component: Icon, size } = option.icon}
                <Icon {size} />
            {/if}
            {option.label}
        </button>{/each}
</div>
