<script module lang="ts">
    import { Plus, Search, LayoutGrid, LayoutList, Rows2 } from '@lucide/svelte';

    import type { SSHConfig, AppConfig, Tab } from '../../types';

    import { createI18n } from '../../utils/i18n';

    import { useServerReorder } from '../../hooks/useServerReorder.svelte';

    import ServerCard from './ServerCard.svelte';

    import { inlineStyle } from '../../utils/dom';

    interface HomeViewProps {
        config: AppConfig;
        setConfig: (config: AppConfig | ((prev: AppConfig | null) => AppConfig | null)) => void;
        addTab: (type: Tab['type'], title: string, config?: SSHConfig, subType?: string) => void;
        onContextMenu: (e: MouseEvent, fav: SSHConfig) => void;
        searchQuery: string;
        setSearchQuery: (query: string) => void;
    }
</script>

<script lang="ts">
    let { config, setConfig, addTab, onContextMenu, searchQuery, setSearchQuery }: HomeViewProps = $props();

    const { t } = $derived(createI18n(config.language));

    const handleSetStandard = () => setConfig({ ...config, serverCardSize: 'standard' });

    const handleSetMedium = () => setConfig({ ...config, serverCardSize: 'medium' });

    const handleSetCompact = () => setConfig({ ...config, serverCardSize: 'compact' });

    const handleAddServer = () => addTab('connection', t('tabs.connection'));

    const handleReorder = (source: SSHConfig, target: SSHConfig) => {
        setConfig((prev) => {
            if (!prev) return prev;
            const from = prev.favorites.findIndex((fav) => (source.id ? fav.id === source.id : fav === source));
            const to = prev.favorites.findIndex((fav) => (target.id ? fav.id === target.id : fav === target));
            if (from < 0 || to < 0 || from === to) return prev;
            const favorites = [...prev.favorites];
            const [moved] = favorites.splice(from, 1);
            favorites.splice(to, 0, moved);
            return { ...prev, favorites };
        });
    };

    const serverReorder = useServerReorder(() => config.favorites, handleReorder);

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
    bind:this={serverReorder.containerRef.current}
    onpointerdowncapture={serverReorder.resetClickSuppression}
    onclickcapture={serverReorder.suppressDragClick}
    style="padding: 40px; height: 100%; overflow-y: auto; background: var(--background); user-select: none"
>
    <div style="max-width: 1200px; margin: 0 auto">
        <div
            style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; gap: 20px"
        >
            <h1 class="text-title" style="display: flex; align-items: center; gap: 12px; flex-shrink: 0">
                {#if filteredFavorites.length === 1}{t('home.server')}{:else}{t('home.servers')}{/if}
            </h1>

            <div style="display: flex; align-items: center; gap: 12px; flex: 1; justify-content: flex-end">
                <div
                    style="display: flex; align-items: center; gap: 2px; background: var(--surface); padding: 2px; border-radius: 8px; border: 1px solid var(--border); margin-right: 8px; height: 36px; box-sizing: border-box"
                >
                    <button
                        onclick={handleSetStandard}
                        style={inlineStyle({
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '32px',
                            height: '32px',
                            borderRadius: '6px',
                            background:
                                config.serverCardSize === 'standard' ? 'var(--hover-surface)' : 'transparent',
                            border: 'none',
                            color:
                                config.serverCardSize === 'standard' ? 'var(--accent)' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s, color 0.2s',
                        })}
                    >
                        <LayoutGrid size={16} />
                    </button>
                    <button
                        onclick={handleSetMedium}
                        style={inlineStyle({
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '32px',
                            height: '32px',
                            borderRadius: '6px',
                            background:
                                config.serverCardSize === 'medium' ? 'var(--hover-surface)' : 'transparent',
                            border: 'none',
                            color: config.serverCardSize === 'medium' ? 'var(--accent)' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s, color 0.2s',
                        })}
                    >
                        <LayoutList size={16} />
                    </button>
                    <button
                        onclick={handleSetCompact}
                        style={inlineStyle({
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '32px',
                            height: '32px',
                            borderRadius: '6px',
                            background:
                                config.serverCardSize === 'compact' ? 'var(--hover-surface)' : 'transparent',
                            border: 'none',
                            color: config.serverCardSize === 'compact' ? 'var(--accent)' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s, color 0.2s',
                        })}
                    >
                        <Rows2 size={16} />
                    </button>
                </div>

                <div style="position: relative; width: 100%; max-width: 300px">
                    <Search
                        size={16}
                        style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); opacity: 0.5; color: var(--text-secondary)"
                    />
                    <input
                        type="text"
                        placeholder={t('common.search')}
                        value={searchQuery}
                        oninput={(e) => setSearchQuery(e.currentTarget.value)}
                        style="width: 100%; height: 36px; padding: 0 12px 0 36px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); color: var(--text-primary); font-size: 1rem; font-weight: 400; outline: none; transition: border-color 0.2s, box-shadow 0.2s"
                    />
                </div>

                <button
                    class="btn-primary"
                    onclick={handleAddServer}
                    style="height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 16px; font-size: 1rem; border-radius: 8px; flex-shrink: 0"
                >
                    <Plus size={18} />
                    {t('home.addServer')}
                </button>
            </div>
        </div>

        <div
            style={inlineStyle({
                display: 'grid',
                gridTemplateColumns:
                    config.serverCardSize === 'compact'
                        ? 'repeat(auto-fill, minmax(240px, 1fr))'
                        : config.serverCardSize === 'medium'
                          ? 'repeat(auto-fill, minmax(320px, 1fr))'
                          : 'repeat(auto-fill, minmax(280px, 1fr))',
                gap:
                    config.serverCardSize === 'compact'
                        ? '12px'
                        : config.serverCardSize === 'medium'
                          ? '16px'
                          : '24px',
            })}
        >
            {#each filteredFavorites as fav, i (fav.id || i)}<ServerCard
                    {fav}
                    size={config.serverCardSize || 'standard'}
                    onClick={() => addTab('ssh', fav.name || fav.host, fav)}
                    onContextMenu={(e) => onContextMenu(e, fav)}
                    index={config.favorites.indexOf(fav)}
                    onPointerDown={(e) => serverReorder.startDrag(e, fav)}
                />{/each}

            <button
                type="button"
                class={`plain-button server-card add-card ${config.serverCardSize || 'standard'}`}
                onclick={handleAddServer}
                style="background: transparent; border-style: dashed"
            >
                <span
                    class="add-icon-circle"
                    style={inlineStyle({
                        width:
                            config.serverCardSize === 'compact'
                                ? '28px'
                                : config.serverCardSize === 'medium'
                                  ? '40px'
                                  : '52px',
                        height:
                            config.serverCardSize === 'compact'
                                ? '28px'
                                : config.serverCardSize === 'medium'
                                  ? '40px'
                                  : '52px',
                        borderRadius: '50%',
                        background: 'var(--hover-surface)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-secondary)',
                        flexShrink: 0,
                    })}
                >
                    <Plus
                        size={config.serverCardSize === 'compact'
                            ? 20
                            : config.serverCardSize === 'medium'
                              ? 22
                              : 26}
                    />
                </span>
                <span
                    class="text-card-title"
                    style={inlineStyle({
                        color: 'var(--text-secondary)',
                        fontSize:
                            config.serverCardSize === 'medium' || config.serverCardSize === 'compact'
                                ? 'calc(var(--ui-font-size-base) * 1.05)'
                                : 'calc(var(--ui-font-size-base) * 1.18)',
                    })}
                >
                    {t('home.addServer')}
                </span>
            </button>
        </div>
    </div>
</div>
