<script module lang="ts">
    import { AppWindow, Terminal } from '@lucide/svelte';

    interface ShortcutItem {
        label: string;
        key: string;
    }

    interface ShortcutsSectionProps {
        appShortcuts: ShortcutItem[];
        terminalShortcuts: ShortcutItem[];
        t: (key: string, options?: Record<string, string>) => string;
    }
</script>

<script lang="ts">
    let { appShortcuts, terminalShortcuts, t }: ShortcutsSectionProps = $props();
</script>

<div class="settings-section-page">
    <div class="settings-section-header">
        <h2 class="settings-section-title">{t('settings.shortcuts')}</h2>
        <div class="settings-section-subtitle">{t('settings.shortcutsSubtitle')}</div>
    </div>

    <!-- Группа: Программа -->
    <div style="margin-top: 20px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px">
        <AppWindow size={18} style="color: var(--accent)" />
        <h3 style="font-size: 1.05rem; font-weight: 600; color: var(--text-primary); margin: 0">
            {t('settings.appShortcutsHeading')}
        </h3>
    </div>

    <div class="shortcuts-list" style="margin-bottom: 24px">
        {#each appShortcuts as s, i (i)}<div class="settings-row">
                <div class="settings-label-container">
                    <span class="settings-label" style="cursor: default">{s.label}</span>
                </div>
                <span class="shortcut-key">{s.key}</span>
            </div>{/each}
    </div>

    <!-- Группа: Терминал -->
    <div style="margin-top: 20px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px">
        <Terminal size={18} style="color: var(--accent)" />
        <h3 style="font-size: 1.05rem; font-weight: 600; color: var(--text-primary); margin: 0">
            {t('settings.terminalShortcutsHeading')}
        </h3>
    </div>

    <div class="shortcuts-list">
        {#each terminalShortcuts as s, i (i)}<div class="settings-row">
                <div class="settings-label-container">
                    <span class="settings-label" style="cursor: default">{s.label}</span>
                </div>
                <span class="shortcut-key">{s.key}</span>
            </div>{/each}
    </div>
</div>
