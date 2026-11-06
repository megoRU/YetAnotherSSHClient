import React, { useCallback, type FC } from 'react';
import { ExternalLink } from 'lucide-react';
import type { IpcRendererApi } from '../../../ipc';

interface LicenseSectionProps {
    ipcRenderer: IpcRendererApi;
    t: (key: string, options?: Record<string, string>) => string;
}

export const LicenseSection: FC<LicenseSectionProps> = React.memo(({ ipcRenderer, t }) => {
    const openExternal = useCallback((url: string) => {
        if (ipcRenderer?.openExternal) ipcRenderer.openExternal(url);
        else window.open(url, '_blank', 'noopener,noreferrer');
    }, [ipcRenderer]);

    const settingsRowStyle: React.CSSProperties = { marginTop: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '16px' };

    return (
        <div className="settings-section-page">
            <div className="settings-section-header" style={{ marginBottom: '16px' }}>
                <h2 className="settings-section-title">{t('settings.licenseSectionTitle')}</h2>
                <div className="settings-section-subtitle">{t('settings.licenseSectionSubtitle')}</div>
            </div>

            <div className="settings-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
                <div className="settings-label-container">
                    <div style={{ marginBottom: '4px' }}><label style={{ margin: 0 }}>{t('settings.programLicense')}</label></div>
                    <div className="settings-description">{t('settings.licenseDesc')}</div>
                </div>
                <button className="btn-secondary btn-about-action" onClick={() => openExternal('https://github.com/megoRU/YetAnotherSSHClient/blob/main/LICENSE')}>
                    {t('settings.license')} <ExternalLink size={14} />
                </button>
            </div>

            <div className="settings-row" style={settingsRowStyle}>
                <div className="settings-label-container">
                    <div style={{ marginBottom: '4px' }}><label style={{ margin: 0 }}>{t('settings.thirdPartyLicenses')}</label></div>
                    <div className="settings-description">{t('settings.thirdPartyLicensesDesc')}</div>
                </div>
                <button className="btn-secondary btn-about-action" onClick={() => openExternal('https://github.com/megoRU/YetAnotherSSHClient/blob/main/THIRD_PARTY_LICENSES.md')}>
                    {t('settings.thirdPartyLicensesOpen')} <ExternalLink size={14} />
                </button>
            </div>

            <div className="settings-row" style={settingsRowStyle}>
                <div className="settings-label-container">
                    <div style={{ marginBottom: '4px' }}><label style={{ margin: 0 }}>{t('settings.otherProjects')}</label></div>
                    <div className="settings-description">{t('settings.otherProjectsDesc')}</div>
                </div>
                <button className="btn-secondary btn-about-action" onClick={() => openExternal('https://megoru.ru')}>
                    megoru.ru <ExternalLink size={14} />
                </button>
            </div>
        </div>
    );
});
