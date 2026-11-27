<script module lang="ts">
    import { House, RefreshCw, Upload, ChevronRight, Eye, Bookmark } from '@lucide/svelte';

    import { createI18n } from '../../utils/i18n';

    import type { AppConfig } from '../../types';

    import { inlineStyle } from '../../utils/dom';

    interface SftpToolbarProps {
        path: string;
        loading: boolean;
        refreshing?: boolean;
        showHidden: boolean;
        hasHiddenFiles: boolean;
        onGoHome: () => void;
        onToggleHidden: () => void;
        onRefresh: () => void;
        onUpload: (mode: 'file' | 'folder') => void;
        onNavigate: (path: string) => void;
        defaultDirectory?: string;
        onSetDefaultDirectory: () => void;
        appConfig?: AppConfig;
    }
</script>

<script lang="ts">
    let {
        path,
        loading,
        refreshing,
        showHidden,
        hasHiddenFiles,
        onGoHome,
        onToggleHidden,
        onRefresh,
        onUpload,
        onNavigate,
        defaultDirectory,
        onSetDefaultDirectory,
        appConfig,
    }: SftpToolbarProps = $props();

    const { t } = $derived(createI18n(appConfig?.language || 'ru'));

    let showDefaultTooltip = $state.raw(false);

    let showHiddenTooltip = $state.raw(false);

    const breadcrumbs = $derived.by(() => {
        const parts = path.split('/').filter(Boolean);
        const crumbs = [{ name: '/', path: '/' }];
        let currentPath = '';
        for (const part of parts) {
            currentPath += `/${part}`;
            crumbs.push({ name: part, path: currentPath });
        }
        return crumbs;
    });
</script>

<div
    role="presentation"
    class="sftp-toolbar"
    style="padding: 10.2px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.02)"
    onclick={(e) => e.stopPropagation()}
>
    <button
        onclick={onGoHome}
        disabled={loading}
        class="btn-secondary"
        style="padding: 5px; display: flex; align-items: center"
    >
        <House size={18} />
    </button>
    <div
        role="presentation"
        style="position: relative; display: flex"
        onmouseenter={() => (showDefaultTooltip = true)}
        onmouseleave={() => (showDefaultTooltip = false)}
        onfocusin={() => (showDefaultTooltip = true)}
        onfocusout={() => (showDefaultTooltip = false)}
    >
        <button
            onclick={onSetDefaultDirectory}
            disabled={loading || !path}
            class="btn-secondary"
            aria-label={t('sftp.setDefaultDirectory')}
            style={inlineStyle({
                padding: '5px',
                display: 'flex',
                alignItems: 'center',
                color: defaultDirectory === path ? 'var(--accent)' : 'inherit',
                borderColor: defaultDirectory === path ? 'var(--accent)' : undefined,
            })}
        >
            <Bookmark size={18} fill={defaultDirectory === path ? 'currentColor' : 'none'} />
        </button>
        {#if showDefaultTooltip}<div
                role="tooltip"
                style="position: absolute; top: calc(100% + 10px); left: 0; z-index: 1200; width: max-content; max-width: min(380px, calc(100vw - 50px)); padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 9px; background: var(--bg-color); color: var(--text-color); box-shadow: 0 8px 24px rgba(0,0,0,0.35); pointer-events: none; font-size: var(--font-size-secondary); line-height: 1.4"
            >
                <div style="font-weight: 600; margin-bottom: 3px">
                    {#if defaultDirectory === path}{t('sftp.defaultDirectoryIsSet')}{:else}{t(
                            'sftp.setDefaultDirectory',
                        )}{/if}
                </div>
                <div style="color: var(--text-secondary); overflow-wrap: anywhere">{path}</div>
            </div>{/if}
    </div>
    <div
        role="presentation"
        style="position: relative; display: flex"
        onmouseenter={() => (showHiddenTooltip = true)}
        onmouseleave={() => (showHiddenTooltip = false)}
        onfocusin={() => (showHiddenTooltip = true)}
        onfocusout={() => (showHiddenTooltip = false)}
    >
        <button
            onclick={onToggleHidden}
            class="btn-secondary"
            aria-label={t(showHidden ? 'sftp.hideHidden' : 'sftp.showHidden')}
            style={inlineStyle({
                padding: '5px',
                display: 'flex',
                alignItems: 'center',
                border: showHidden || hasHiddenFiles ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: showHidden ? 'rgba(var(--accent-rgb), 0.15)' : 'transparent',
                color: showHidden ? 'var(--accent)' : 'inherit',
                boxShadow: showHidden
                    ? '0 0 8px rgba(var(--accent-rgb), 0.5)'
                    : hasHiddenFiles
                      ? '0 0 4px rgba(var(--accent-rgb), 0.3)'
                      : 'none',
                transition: 'all 0.2s ease',
            })}
        >
            <Eye size={18} />
        </button>
        {#if showHiddenTooltip}<div
                role="tooltip"
                style="position: absolute; top: calc(100% + 10px); left: 50%; transform: translateX(-50%); z-index: 1200; width: max-content; max-width: 240px; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 9px; background: var(--bg-color); color: var(--text-color); box-shadow: 0 8px 24px rgba(0,0,0,0.35); pointer-events: none; font-size: var(--font-size-secondary); line-height: 1.4"
            >
                {t(showHidden ? 'sftp.hideHidden' : 'sftp.showHidden')}
            </div>{/if}
    </div>
    <button
        onclick={onRefresh}
        disabled={loading || refreshing}
        class="btn-secondary"
        style="padding: 5px; display: flex; align-items: center"
    >
        <RefreshCw size={18} class={loading || refreshing ? 'refresh-icon-spin' : ''} />
    </button>
    <div
        style="flex: 1; padding: 0 10px; height: 32px; font-size: var(--ui-font-size-base); display: flex; align-items: center; overflow-x: auto; overflow-y: hidden; white-space: nowrap; gap: 4px; scrollbar-width: none"
        class="breadcrumb-container"
    >
        {#each breadcrumbs as crumb, idx (crumb.path)}{@const isLast = idx === breadcrumbs.length - 1}
            {@const crumbStyle = inlineStyle({
                padding: '2px 6px',
                borderRadius: '4px',
                cursor: isLast ? 'default' : 'pointer',
                fontWeight: isLast ? 'bold' : 'normal',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                background: 'transparent',
                border: '1px solid transparent',
            })}
            {#if idx > 0}<ChevronRight size={14} style="opacity: 0.5; flex-shrink: 0" />{/if}
            {#if isLast}
                <span aria-current="location" style={crumbStyle}>{crumb.name}</span>
            {:else}
                <button
                    class="plain-button breadcrumb-item"
                    type="button"
                    onclick={() => onNavigate(crumb.path)}
                    style={crumbStyle}>{crumb.name}</button
                >
            {/if}
        {/each}
    </div>
    <button
        onclick={() => onUpload('file')}
        disabled={loading}
        class="btn-primary"
        style="padding: 5px 15px; display: flex; align-items: center; gap: 8px; border-radius: 10px"
    >
        <Upload size={18} />
        {t('sftp.upload')}
    </button>
</div>
