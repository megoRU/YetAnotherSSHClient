<script module lang="ts">
    import type { AppConfig } from '../../../types';

    interface TabsSectionProps {
        config: AppConfig;
        handleUpdate: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
        t: (key: string, options?: Record<string, string>) => string;
    }
</script>

<script lang="ts">
    const fieldId = $props.id();

    let { config, handleUpdate, t }: TabsSectionProps = $props();
</script>

<div class="settings-section-page">
    <div class="settings-section-header">
        <h2 class="settings-section-title">{t('settings.tabs')}</h2>
        <div class="settings-section-subtitle">{t('settings.tabsSubtitle')}</div>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-activeTabColor'}>{t('settings.activeTabColor')}</label>
            <div class="settings-description">{t('settings.activeTabColorDesc')}</div>
        </div>
        <label class="ui-switch">
            <input
                id={fieldId + '-activeTabColor'}
                type="checkbox"
                checked={config.activeTabColorEnabled || false}
                onchange={(e) => handleUpdate('activeTabColorEnabled', e.currentTarget.checked)}
            />
            <span class="ui-slider"></span>
        </label>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-alwaysHover'}>{t('settings.alwaysHover')}</label>
            <div class="settings-description">{t('settings.alwaysHoverDesc')}</div>
        </div>
        <label class="ui-switch">
            <input
                id={fieldId + '-alwaysHover'}
                type="checkbox"
                checked={config.alwaysShowHoverOnInactiveTabs || false}
                onchange={(e) => handleUpdate('alwaysShowHoverOnInactiveTabs', e.currentTarget.checked)}
            />
            <span class="ui-slider"></span>
        </label>
    </div>
</div>
