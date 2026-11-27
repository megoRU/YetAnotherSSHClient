<script module lang="ts">
    import { Minus, Plus } from '@lucide/svelte';

    import CustomSelect from '../../layout/CustomSelect.svelte';

    import type { AppConfig } from '../../../types';

    import type { Language } from '../../../utils/i18n';

    interface InterfaceSectionProps {
        config: AppConfig;
        handleUpdate: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
        languageOptions: { value: string; label: string }[];
        themeOptions: { value: string; label: string }[];
        uiFontOptions: { value: string; label: string }[];
        serverCardSizeOptions: { value: string; label: string }[];
        sidebarPositionOptions: { value: string; label: string }[];
        t: (key: string, options?: Record<string, string>) => string;
    }
</script>

<script lang="ts">
    const fieldId = $props.id();

    let {
        config,
        handleUpdate,
        languageOptions,
        themeOptions,
        uiFontOptions,
        serverCardSizeOptions,
        sidebarPositionOptions,
        t,
    }: InterfaceSectionProps = $props();
</script>

<div class="settings-section-page">
    <div class="settings-section-header">
        <h2 class="settings-section-title">{t('settings.interface')}</h2>
        <div class="settings-section-subtitle">{t('settings.subtitle')}</div>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-language'}>{t('settings.language')}</label>
        </div>
        <CustomSelect
            id={fieldId + '-language'}
            value={config.language}
            onChange={(val) => handleUpdate('language', val as Language)}
            options={languageOptions}
            className="settings-select-fixed"
        />
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-theme'}>{t('settings.theme')}</label>
        </div>
        <CustomSelect
            id={fieldId + '-theme'}
            value={config.theme}
            onChange={(val) => handleUpdate('theme', val)}
            options={themeOptions}
            className="settings-select-fixed"
        />
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-uiFont'}>{t('settings.uiFont')}</label>
            <div class="settings-description">{t('settings.uiFontDesc')}</div>
        </div>
        <CustomSelect
            id={fieldId + '-uiFont'}
            value={config.uiFontName}
            onChange={(val) => handleUpdate('uiFontName', val)}
            options={uiFontOptions}
            className="settings-select-fixed"
        />
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <span class="settings-label">{t('settings.fontSize')}</span>
            <div class="settings-description">{t('settings.fontSizeDesc')}</div>
        </div>
        <div class="settings-font-control-group">
            <button
                class="btn-font-control btn-font-control-icon"
                onclick={() => handleUpdate('uiFontSize', Math.max(8, config.uiFontSize - 1))}
            >
                <Minus size={12} />
            </button>
            <div class="settings-font-display">
                {config.uiFontSize}
            </div>
            <button
                class="btn-font-control btn-font-control-icon"
                onclick={() => handleUpdate('uiFontSize', Math.min(24, config.uiFontSize + 1))}
            >
                <Plus size={12} />
            </button>
        </div>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-serverCardSize'}>{t('settings.serverCardSize')}</label>
        </div>
        <CustomSelect
            id={fieldId + '-serverCardSize'}
            value={config.serverCardSize || 'standard'}
            onChange={(val) => handleUpdate('serverCardSize', val as 'standard' | 'compact' | 'medium')}
            options={serverCardSizeOptions}
            className="settings-select-fixed"
        />
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-sidebarEnabled'}>{t('settings.sidebarEnabled')}</label>
            <div class="settings-description">{t('settings.sidebarEnabledDesc')}</div>
        </div>
        <label class="ui-switch">
            <input
                id={fieldId + '-sidebarEnabled'}
                type="checkbox"
                checked={config.sidebarEnabled || false}
                onchange={(e) => handleUpdate('sidebarEnabled', e.currentTarget.checked)}
            />
            <span class="ui-slider"></span>
        </label>
    </div>

    {#if config.sidebarEnabled}<div class="settings-row">
            <div class="settings-label-container">
                <label for={fieldId + '-sidebarPosition'}>{t('settings.sidebarPosition')}</label>
            </div>
            <CustomSelect
                id={fieldId + '-sidebarPosition'}
                value={config.sidebarPosition || 'left'}
                onChange={(val) => handleUpdate('sidebarPosition', val as 'left' | 'right')}
                options={sidebarPositionOptions}
                className="settings-select-fixed"
            />
        </div>{/if}
</div>
