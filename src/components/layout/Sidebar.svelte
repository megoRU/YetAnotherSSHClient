<script module lang="ts">
    import { Search } from '@lucide/svelte';

    import type { SSHConfig, AppConfig, Tab } from '../../types';

    import { createI18n } from '../../utils/i18n';

    import SidebarItem from './SidebarItem.svelte';

    import { inlineStyle } from '../../utils/dom';

    interface SidebarProps {
        config: AppConfig;
        addTab: (type: Tab['type'], title: string, config?: SSHConfig, subType?: string) => void;
        onContextMenu: (e: MouseEvent, fav: SSHConfig) => void;
    }
</script>

<script lang="ts">
    let { config, addTab, onContextMenu }: SidebarProps = $props();

    const { t } = $derived(createI18n(config.language));

    let searchQuery = $state.raw('');

    const filteredFavorites = $derived.by(() => {
        if (!searchQuery) return config.favorites;
        const query = searchQuery.toLowerCase();
        return config.favorites.filter(
            (fav) =>
                (fav.name && fav.name.toLowerCase().includes(query)) ||
                fav.host.toLowerCase().includes(query) ||
                fav.user.toLowerCase().includes(query),
        );
    });
</script>

<div
    class="sidebar"
    style={inlineStyle({
        width: '260px',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderRight: config.sidebarPosition === 'left' ? '1px solid var(--border)' : 'none',
        borderLeft: config.sidebarPosition === 'right' ? '1px solid var(--border)' : 'none',
        background: 'var(--background)',
        flexShrink: 0,
        overflow: 'hidden',
    })}
>
    <div style="padding: 16px; border-bottom: 1px solid var(--border)">
        <div style="position: relative">
            <Search
                size={14}
                style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); opacity: 0.5; color: var(--text-secondary)"
            />
            <input
                type="text"
                placeholder={t('common.search')}
                value={searchQuery}
                oninput={(e) => (searchQuery = e.currentTarget.value)}
                style="width: 100%; height: 32px; padding: 0 10px 0 32px; border-radius: 6px; background: var(--surface); border: 1px solid var(--border); color: var(--text-primary); font-size: 0.9rem; outline: none"
            />
        </div>
    </div>

    <div style="flex: 1; overflow-y: auto; padding: 8px" class="no-scrollbar">
        {#each filteredFavorites as fav, i (fav.id || i)}<SidebarItem
                {fav}
                onClick={() => addTab('ssh', fav.name || fav.host, fav)}
                onContextMenu={(e) => onContextMenu(e, fav)}
            />{/each}
    </div>
</div>
