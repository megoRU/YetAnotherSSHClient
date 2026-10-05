import React, { useCallback, useEffect, useState, type FC } from 'react';
import { ExternalLink, Heart, RotateCw } from 'lucide-react';
import type { AppConfig, NotificationAction, NotificationType } from '../../../types';
import type { IpcRendererApi } from '../../../ipc';
import { validateLicense } from '../../../utils/license';

interface LicenseSectionProps {
    config: AppConfig;
    ipcRenderer: IpcRendererApi;
    setConfig: (config: AppConfig) => void;
    showNotification: (title: string, message: string, type?: NotificationType, action?: NotificationAction) => void;
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

function maskLicenseKey(key: string): string {
    const trimmed = key.trim();
    if (trimmed.length <= 10) return '••••••••••••';
    return `${trimmed.slice(0, 6)}••••••••••${trimmed.slice(-6)}`;
}

export const LicenseSection: FC<LicenseSectionProps> = React.memo(({ config, ipcRenderer, setConfig, showNotification, t }) => {
    const [licenseKey, setLicenseKey] = useState('');
    const [isActivating, setIsActivating] = useState(false);
    const [isCheckingStatus, setIsCheckingStatus] = useState(false);
    const [isChangingKey, setIsChangingKey] = useState(!config.licenseKey);
    const [supporters, setSupporters] = useState<Supporter[]>([]);
    const [isLoadingSupporters, setIsLoadingSupporters] = useState(true);
    const isLicensed = !!(config.licenseKey && config.licenseExpiresAt && config.licenseExpiresAt > Date.now());

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

    useEffect(() => {
        const currentKey = config.licenseKey;
        if (!currentKey) return;
        let active = true;
        void validateLicense(currentKey).then(result => {
            if (!active) return;
            if (result.success && result.expiresAt !== undefined && config.licenseExpiresAt !== result.expiresAt) {
                setConfig({ ...config, licenseExpiresAt: result.expiresAt });
            } else if (result.errorType === 'INVALID_KEY' || result.errorType === 'EXPIRED_LICENSE') {
                const updated = { ...config };
                delete updated.licenseKey;
                delete updated.licenseExpiresAt;
                setConfig(updated);
                setIsChangingKey(true);
            }
        }).catch(() => { /* Ignore network errors during background validation. */ });
        return () => { active = false; };
    // Validate when the saved key changes; config updates from this effect must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config.licenseKey]);

    const openExternal = useCallback((url: string) => {
        if (ipcRenderer?.openExternal) ipcRenderer.openExternal(url);
        else window.open(url, '_blank', 'noopener,noreferrer');
    }, [ipcRenderer]);

    const handleChangeKey = useCallback(() => {
        const updated = { ...config };
        delete updated.licenseKey;
        delete updated.licenseExpiresAt;
        setConfig(updated);
        setLicenseKey('');
        setIsChangingKey(true);
    }, [config, setConfig]);

    const handleCheckStatus = useCallback(async () => {
        if (!config.licenseKey || isCheckingStatus) return;
        setIsCheckingStatus(true);
        try {
            const result = await validateLicense(config.licenseKey);
            if (result.success && result.expiresAt && result.expiresAt > Date.now()) {
                setConfig({ ...config, licenseExpiresAt: result.expiresAt });
                showNotification(t('common.success'), t('support.statusUpdated'), 'success');
            } else if (result.errorType === 'INVALID_KEY' || result.errorType === 'EXPIRED_LICENSE') {
                const updated = { ...config };
                delete updated.licenseKey;
                delete updated.licenseExpiresAt;
                setConfig(updated);
                setIsChangingKey(true);
                showNotification(t('common.warning'), t('support.licenseError'), 'error');
            } else {
                showNotification(t('common.error'), result.errorType === 'SERVER_ERROR' ? t('common.serverError') : t('common.networkError'), 'error');
            }
        } catch {
            showNotification(t('common.error'), t('common.networkError'), 'error');
        } finally {
            setIsCheckingStatus(false);
        }
    }, [config, isCheckingStatus, setConfig, showNotification, t]);

    const handleActivate = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const key = licenseKey.trim();
        if (!key || isActivating) return;
        setIsActivating(true);
        try {
            const result = await validateLicense(key);
            if (result.success && result.expiresAt && result.expiresAt > Date.now()) {
                setConfig({ ...config, licenseKey: key, licenseExpiresAt: result.expiresAt });
                showNotification(t('common.success'), t('support.licenseSuccess'), 'success');
                setLicenseKey('');
                setIsChangingKey(false);
            } else {
                const message = result.errorType === 'NETWORK_ERROR' ? t('common.networkError') : result.errorType === 'SERVER_ERROR' ? t('common.serverError') : t('support.licenseError');
                showNotification(t('common.error'), message, 'error');
            }
        } catch {
            showNotification(t('common.error'), t('common.networkError'), 'error');
        } finally {
            setIsActivating(false);
        }
    }, [config, isActivating, licenseKey, setConfig, showNotification, t]);

    const settingsRowStyle: React.CSSProperties = { marginTop: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '16px' };

    return (
        <div className="settings-section-page">
            <div className="settings-section-header" style={{ marginBottom: '16px' }}>
                <h2 className="settings-section-title">{t('settings.licenseSectionTitle')}</h2>
                <div className="settings-section-subtitle">{t('settings.licenseSectionSubtitle')}</div>
            </div>

            <div className="settings-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
                <div className="settings-label-container">
                    <div style={{ marginBottom: '4px' }}><label style={{ margin: 0 }}>{t('settings.userLicense')}</label></div>
                    <div className="settings-description">
                        {isLicensed ? (
                            <span style={{ color: '#22c55e', fontWeight: 600 }}>
                                {t('settings.userLicenseActive', { date: new Date(config.licenseExpiresAt!).toLocaleString() })}
                            </span>
                        ) : <span style={{ color: 'var(--text-secondary)' }}>{t('settings.userLicenseNone')}</span>}
                    </div>
                </div>
                {isLicensed && <div style={{ fontFamily: 'var(--mono-font-family), monospace', fontSize: '0.9rem', color: 'var(--text-primary)', background: 'var(--hover-surface)', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border)' }}>{maskLicenseKey(config.licenseKey!)}</div>}
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

            <div className="settings-row" style={settingsRowStyle}>
                <div className="settings-label-container">
                    <div style={{ marginBottom: '4px' }}><label style={{ margin: 0 }}>{t('support.licenseKeyTitle')}</label></div>
                    <div className="settings-description">{isLicensed ? t('support.licenseExpiresAt', { date: new Date(config.licenseExpiresAt!).toLocaleString() }) : t('settings.userLicenseNone')}</div>
                </div>
                {isLicensed && !isChangingKey ? (
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn-secondary btn-about-action" onClick={() => void handleCheckStatus()} disabled={isCheckingStatus}>
                            <RotateCw size={14} /> {isCheckingStatus ? t('support.checkingStatus') : t('support.checkStatus')}
                        </button>
                        <button className="btn-secondary btn-about-action" onClick={handleChangeKey}>{t('support.changeLicenseKey')}</button>
                    </div>
                ) : (
                    <form onSubmit={event => void handleActivate(event)} style={{ display: 'flex', gap: '8px', width: 'min(100%, 440px)' }}>
                        <input
                            type="text"
                            value={licenseKey}
                            onChange={event => setLicenseKey(event.target.value)}
                            placeholder={t('support.licenseKeyPlaceholder')}
                            disabled={isActivating}
                            style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
                        />
                        <button type="submit" className="btn-primary" disabled={!licenseKey.trim() || isActivating}>
                            {isActivating ? t('support.activatingLicense') : t('support.activateLicense')}
                        </button>
                    </form>
                )}
            </div>

            <div className="settings-row" style={{ marginTop: '16px' }}>
                <div className="settings-label-container">
                    <div style={{ marginBottom: '4px' }}><label style={{ margin: 0 }}>{t('settings.programLicense')}</label></div>
                    <div className="settings-description">{t('settings.licenseDesc')}</div>
                </div>
                <button className="btn-secondary btn-about-action" onClick={() => openExternal('https://github.com/megoRU/YetAnotherSSHClient/blob/main/LICENSE')}>
                    {t('settings.license')}
                </button>
            </div>
        </div>
    );
});
