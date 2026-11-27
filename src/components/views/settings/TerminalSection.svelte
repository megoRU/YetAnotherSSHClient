<script module lang="ts">
    import { Minus, Plus } from '@lucide/svelte';

    import CustomSelect from '../../layout/CustomSelect.svelte';

    import type { AppConfig } from '../../../types';

    import { inlineStyle } from '../../../utils/dom';

    interface TerminalSectionProps {
        config: AppConfig;
        handleUpdate: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
        terminalFontOptions: { value: string; label: string }[];
        terminalThemeOptions: { value: string; label: string }[];
        keywordList: { label: string; color: string }[];
        t: (key: string, options?: Record<string, string>) => string;
    }
</script>

<script lang="ts">
    const fieldId = $props.id();

    let { config, handleUpdate, terminalFontOptions, terminalThemeOptions, keywordList, t }: TerminalSectionProps =
        $props();
</script>

<div class="settings-section-page">
    <div class="settings-section-header">
        <h2 class="settings-section-title">{t('settings.terminal')}</h2>
        <div class="settings-section-subtitle">{t('settings.terminalSubtitle')}</div>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-terminalTheme'}>{t('settings.terminalTheme')}</label>
        </div>
        <CustomSelect
            id={fieldId + '-terminalTheme'}
            value={config.terminalTheme}
            onChange={(val) => handleUpdate('terminalTheme', val)}
            options={terminalThemeOptions}
            className="settings-select-fixed"
        />
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-terminalFont'}>{t('settings.terminalFont')}</label>
            <div class="settings-description">{t('settings.terminalFontDesc')}</div>
        </div>
        <CustomSelect
            id={fieldId + '-terminalFont'}
            value={config.terminalFontName}
            onChange={(val) => handleUpdate('terminalFontName', val)}
            options={terminalFontOptions}
            className="settings-select-fixed"
        />
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <span class="settings-label">{t('settings.terminalFontSize')}</span>
            <div class="settings-description">{t('settings.terminalFontSizeDesc')}</div>
        </div>
        <div class="settings-font-control-group">
            <button
                class="btn-font-control btn-font-control-icon"
                onclick={() => handleUpdate('terminalFontSize', Math.max(8, config.terminalFontSize - 1))}
            >
                <Minus size={12} />
            </button>
            <div class="settings-font-display">
                {config.terminalFontSize}
            </div>
            <button
                class="btn-font-control btn-font-control-icon"
                onclick={() => handleUpdate('terminalFontSize', Math.min(32, config.terminalFontSize + 1))}
            >
                <Plus size={12} />
            </button>
        </div>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <span class="settings-label">{t('settings.scrollSensitivity')}</span>
            <div class="settings-description">{t('settings.scrollSensitivityDesc')}</div>
        </div>
        <div class="settings-font-control-group">
            <button
                class="btn-font-control btn-font-control-icon"
                onclick={() =>
                    handleUpdate('terminalScrollSensitivity', Math.max(1, config.terminalScrollSensitivity - 1))}
            >
                <Minus size={12} />
            </button>
            <div class="settings-font-display">
                {config.terminalScrollSensitivity}
            </div>
            <button
                class="btn-font-control btn-font-control-icon"
                onclick={() =>
                    handleUpdate('terminalScrollSensitivity', Math.min(10, config.terminalScrollSensitivity + 1))}
            >
                <Plus size={12} />
            </button>
        </div>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-terminalScrollback'}>{t('settings.terminalScrollback')}</label>
            <div class="settings-description">{t('settings.terminalScrollbackDesc')}</div>
        </div>
        <CustomSelect
            id={fieldId + '-terminalScrollback'}
            value={String(config.terminalScrollback)}
            onChange={(value) => handleUpdate('terminalScrollback', Number(value))}
            options={[
                { value: '5000', label: '5 000' },
                { value: '10000', label: '10 000 ⭐' },
                { value: '20000', label: '20 000' },
                { value: '50000', label: '50 000' },
            ]}
            className="settings-select-fixed"
        />
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-quickCopyPaste'}>{t('settings.quickCopyPaste')}</label>
            <div class="settings-description">{t('settings.quickCopyPasteDesc')}</div>
        </div>
        <label class="ui-switch">
            <input
                id={fieldId + '-quickCopyPaste'}
                type="checkbox"
                checked={config.enableTerminalContextMenu || false}
                onchange={(e) => handleUpdate('enableTerminalContextMenu', e.currentTarget.checked)}
            />
            <span class="ui-slider"></span>
        </label>
    </div>

    <div class="settings-row terminal-row-top">
        <div class="settings-label-container">
            <label for={fieldId + '-keywordHighlighting'}>{t('settings.keywordHighlighting')}</label>
            <div class="settings-description">{t('settings.keywordHighlightingDesc')}</div>

            <div class="keyword-list-container">
                {#each keywordList as kw (kw.label)}<div class="keyword-item">
                        <span class="keyword-label">{kw.label}</span>
                        <div class="keyword-color-preview" style={inlineStyle({ background: kw.color })}></div>
                    </div>{/each}
            </div>
        </div>
        <label class="ui-switch">
            <input
                id={fieldId + '-keywordHighlighting'}
                type="checkbox"
                checked={config.keywordHighlighting}
                onchange={(e) => handleUpdate('keywordHighlighting', e.currentTarget.checked)}
            />
            <span class="ui-slider"></span>
        </label>
    </div>
</div>
