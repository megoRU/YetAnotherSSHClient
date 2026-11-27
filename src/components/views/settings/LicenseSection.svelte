<script module lang="ts">
    import { ExternalLink } from '@lucide/svelte';

    import type { IpcRendererApi } from '../../../ipc';

    import { type CSSProperties, inlineStyle } from '../../../utils/dom';

    interface LicenseSectionProps {
        ipcRenderer: IpcRendererApi;
        t: (key: string, options?: Record<string, string>) => string;
    }
</script>

<script lang="ts">
    let { ipcRenderer, t }: LicenseSectionProps = $props();

    const openExternal = (url: string) => {
        if (ipcRenderer?.openExternal) ipcRenderer.openExternal(url);
        else window.open(url, '_blank', 'noopener,noreferrer');
    };

    const settingsRowStyle: CSSProperties = {
        marginTop: '16px',
        borderBottom: '1px solid var(--border)',
        paddingBottom: '16px',
    };
</script>

<div class="settings-section-page">
    <div class="settings-section-header" style="margin-bottom: 16px">
        <h2 class="settings-section-title">{t('settings.licenseSectionTitle')}</h2>
        <div class="settings-section-subtitle">{t('settings.licenseSectionSubtitle')}</div>
    </div>

    <div class="settings-row" style="border-bottom: 1px solid var(--border); padding-bottom: 16px">
        <div class="settings-label-container">
            <div style="margin-bottom: 4px">
                <span class="settings-label" style="margin: 0">{t('settings.programLicense')}</span>
            </div>
            <div class="settings-description">{t('settings.licenseDesc')}</div>
        </div>
        <button
            class="btn-secondary btn-about-action"
            onclick={() => openExternal('https://github.com/megoRU/YetAnotherSSHClient/blob/main/LICENSE')}
        >
            {t('settings.license')}
            <ExternalLink size={14} />
        </button>
    </div>

    <div class="settings-row" style={inlineStyle(settingsRowStyle)}>
        <div class="settings-label-container">
            <div style="margin-bottom: 4px">
                <span class="settings-label" style="margin: 0">{t('settings.thirdPartyLicenses')}</span>
            </div>
            <div class="settings-description">{t('settings.thirdPartyLicensesDesc')}</div>
        </div>
        <button
            class="btn-secondary btn-about-action"
            onclick={() =>
                openExternal('https://github.com/megoRU/YetAnotherSSHClient/blob/main/THIRD_PARTY_LICENSES.md')}
        >
            {t('settings.thirdPartyLicensesOpen')}
            <ExternalLink size={14} />
        </button>
    </div>

    <div class="settings-row" style={inlineStyle(settingsRowStyle)}>
        <div class="settings-label-container">
            <div style="margin-bottom: 4px">
                <span class="settings-label" style="margin: 0">{t('settings.otherProjects')}</span>
            </div>
            <div class="settings-description">{t('settings.otherProjectsDesc')}</div>
        </div>
        <button class="btn-secondary btn-about-action" onclick={() => openExternal('https://megoru.ru')}>
            megoru.ru <ExternalLink size={14} />
        </button>
    </div>
</div>
