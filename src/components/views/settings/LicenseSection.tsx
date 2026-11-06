import React, { useCallback, useEffect, useState, type FC } from 'react';
import { ExternalLink, Heart } from 'lucide-react';
import type { IpcRendererApi } from '../../../ipc';

interface LicenseSectionProps {
    ipcRenderer: IpcRendererApi;
    t: (key: string, options?: Record<string, string>) => string;
}

interface ApiUser {
    user_name?: string;
    user_tier?: string;
    user_profile_url_image?: string | null;
}

interface Supporter {
    id: string;
    name: string;
    tier: 'support' | 'premium';
    avatar: string;
}

export const LicenseSection: FC<LicenseSectionProps> = React.memo(({ ipcRenderer, t }) => {
    const [supporters, setSupporters] = useState<Supporter[]>([]);
    const [isLoadingSupporters, setIsLoadingSupporters] = useState(true);

    useEffect(() => {
        let active = true;
        fetch('https://api.megoru.ru/api/premium/users')
            .then(response => {
                if (!response.ok) throw new Error('Failed to fetch supporters');
                return response.json() as Promise<{ users?: ApiUser[] }>;
            })
            .then(data => {
                if (!active) return;
                setSupporters(Array.isArray(data.users) ? data.users.map((user, index) => ({
                    id: `${user.user_name || 'user'}-${index}`,
                    name: user.user_name || 'Anonymous',
                    tier: String(user.user_tier).toUpperCase() === 'PREMIUM' ? 'premium' : 'support',
                    avatar: user.user_profile_url_image || './icons/boosty/Color_avatar.svg'
                })) : []);
            })
            .catch(() => {
                if (active) setSupporters([]);
            })
            .finally(() => {
                if (active) setIsLoadingSupporters(false);
            });
        return () => { active = false; };
    }, []);

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

            <div className="settings-row" style={settingsRowStyle}>
                <div className="settings-label-container">
                    <div style={{ marginBottom: '4px' }}><label style={{ margin: 0 }}>{t('support.title')}</label></div>
                    <div className="settings-description">{t('support.boostyDesc')}</div>
                </div>
                <button
                    className="btn-primary settings-boosty-button"
                    onClick={() => openExternal('https://boosty.to/megoru')}
                >
                    {t('support.boostyButton')} <ExternalLink size={14} />
                </button>
            </div>

            <div className="settings-row flex-column settings-supporters-row" style={settingsRowStyle}>
                <div className="supporters-header">
                    <Heart size={18} className="icon-red" fill="currentColor" />
                    <span className="supporters-header-text">{t('support.supportersTitle')}</span>
                </div>
                <div className="supporters-list">
                    {isLoadingSupporters ? Array.from({ length: 3 }, (_, index) => (
                        <div key={index} className="supporter-item skeleton-item">
                            <div className="supporter-avatar skeleton-box" />
                            <div className="supporter-details">
                                <div className="skeleton-line skeleton-name" />
                                <div className="skeleton-line skeleton-badge" />
                            </div>
                        </div>
                    )) : supporters.length > 0 ? supporters.map(supporter => (
                        <div key={supporter.id} className="supporter-item">
                            <div className="supporter-avatar"><img src={supporter.avatar} alt={supporter.name} /></div>
                            <div className="supporter-details">
                                <span className="supporter-name">{supporter.name}</span>
                                <span className={`supporter-badge tier-${supporter.tier}`}>
                                    {t(supporter.tier === 'premium' ? 'support.tierPremiumBadge' : 'support.tierSupportBadge')}
                                </span>
                            </div>
                        </div>
                    )) : <div className="settings-description">—</div>}
                </div>
            </div>
        </div>
    );
});
