import React from 'react';
import type { AppConfig } from '../../../types';
import type { IpcRendererApi } from '../../../global';

interface LicenseSectionProps {
    config: AppConfig;
    ipcRenderer: IpcRendererApi;
    t: (key: string, options?: Record<string, string>) => string;
}

function maskLicenseKey(key: string): string {
    const trimmed = key.trim();
    if (trimmed.length <= 10) {
        return '••••••••••••';
    }
    const prefix = trimmed.slice(0, 6);
    const suffix = trimmed.slice(-6);
    return `${prefix}••••••••••${suffix}`;
}

export const LicenseSection: React.FC<LicenseSectionProps> = React.memo(({
    config,
    ipcRenderer,
    t
}) => {
    return (
        <div className="settings-section-page">
            <div className="settings-section-header" style={{ marginBottom: '16px' }}>
                <h2 className="settings-section-title">{t('settings.licenseSectionTitle')}</h2>
                <div className="settings-section-subtitle">{t('settings.licenseSectionSubtitle')}</div>
            </div>

            <div className="settings-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
                <div className="settings-label-container">
                    <div style={{ marginBottom: '4px' }}>
                        <label style={{ margin: 0 }}>{t('settings.userLicense')}</label>
                    </div>
                    <div className="settings-description">
                        {config.licenseKey ? (
                            <span style={{ color: '#22c55e', fontWeight: 600 }}>
                                {t('settings.userLicenseActive', {
                                    date: config.licenseExpiresAt
                                        ? new Date(config.licenseExpiresAt).toLocaleString()
                                        : '—'
                                })}
                            </span>
                        ) : (
                            <span style={{ color: 'var(--text-secondary)' }}>
                                {t('settings.userLicenseNone')}
                            </span>
                        )}
                    </div>
                </div>
                {config.licenseKey && (
                    <div style={{
                        fontFamily: 'var(--mono-font-family), monospace',
                        fontSize: '0.9rem',
                        color: 'var(--text-primary)',
                        background: 'var(--hover-surface)',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)'
                    }}>
                        {maskLicenseKey(config.licenseKey)}
                    </div>
                )}
            </div>

            <div className="settings-row" style={{ marginTop: '16px' }}>
                <div className="settings-label-container">
                    <div style={{ marginBottom: '4px' }}>
                        <label style={{ margin: 0 }}>{t('settings.programLicense')}</label>
                    </div>
                    <div className="settings-description">{t('settings.licenseDesc')}</div>
                </div>
                <button
                    className="btn-secondary btn-about-action"
                    onClick={() => ipcRenderer?.openExternal?.('https://github.com/megoRU/YetAnotherSSHClient/blob/main/LICENSE')}
                >
                    {t('settings.license')}
                </button>
            </div>
        </div>
    );
});
