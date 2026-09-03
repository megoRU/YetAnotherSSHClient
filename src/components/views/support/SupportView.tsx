import React, { useState, useEffect } from 'react';
import { ExternalLink, Heart, Sparkles, Lightbulb, KeyRound, CheckCircle2 } from 'lucide-react';
import type { AppConfig, NotificationAction, NotificationType } from '../../../types';
import { useI18n } from '../../../utils/i18n';
import { validateLicense } from '../../../utils/license';

const { ipcRenderer } = window;

interface SupportViewProps {
    config: AppConfig;
    setConfig: (config: AppConfig) => void;
    showNotification: (title: string, message: string, type?: NotificationType, action?: NotificationAction) => void;
}

interface Supporter {
    id: string;
    name: string;
    tier: 'support' | 'premium';
    avatar: string;
}

interface ApiUser {
    user_name?: string;
    user_tier?: string;
}

export const SupportView: React.FC<SupportViewProps> = React.memo(({ config, setConfig, showNotification }) => {
    const { t } = useI18n(config.language);
    const boostyUrl = 'https://boosty.to/megoru';
    const [licenseKey, setLicenseKey] = useState('');
    const [isActivating, setIsActivating] = useState(false);
    const [supporters, setSupporters] = useState<Supporter[]>([]);
    const [isLoadingSupporters, setIsLoadingSupporters] = useState(true);

    useEffect(() => {
        let isMounted = true;
        setIsLoadingSupporters(true);
        fetch('https://api.megoru.ru/api/premium/users')
            .then((res) => {
                if (!res.ok) throw new Error('Failed to fetch supporters');
                return res.json();
            })
            .then((data: { users?: ApiUser[] }) => {
                if (!isMounted) return;
                if (Array.isArray(data?.users)) {
                    const list: Supporter[] = data.users.map((u, idx) => ({
                        id: `${u.user_name || 'user'}-${idx}`,
                        name: u.user_name || 'Anonymous',
                        tier: String(u.user_tier).toUpperCase() === 'PREMIUM' ? 'premium' : 'support',
                        avatar: './icons/boosty/Color_avatar.svg',
                    }));
                    setSupporters(list);
                } else {
                    setSupporters([]);
                }
            })
            .catch(() => {
                if (isMounted) {
                    setSupporters([]);
                }
            })
            .finally(() => {
                if (isMounted) {
                    setIsLoadingSupporters(false);
                }
            });

        return () => {
            isMounted = false;
        };
    }, []);

    const handleOpenBoosty = () => {
        if (ipcRenderer?.openExternal) {
            ipcRenderer.openExternal(boostyUrl);
        } else {
            window.open(boostyUrl, '_blank', 'noopener,noreferrer');
        }
    };

    return (
        <div className="settings-view-wrapper support-view">
            <div className="settings-view-content">
                {/* Header */}
                <div className="support-header">
                    <div className="support-icon-large">
                        <Heart size={42} fill="currentColor" />
                    </div>
                    <h1>{t('support.title')}</h1>
                    <p className="support-subtitle">
                        {t('support.subtitle')}
                    </p>
                </div>

                {/* Main Boosty Banner Card */}
                <div className="support-card boosty-card">
                    <div className="boosty-card-left">
                        <div className="boosty-logo-wrapper">
                            <img src="./icons/boosty/Color_avatar.svg" alt="Boosty" className="boosty-avatar-img" />
                        </div>
                        <div className="boosty-info">
                            <div className="boosty-title-row">
                                <span className="boosty-title-text">Boosty</span>
                                <span className="boosty-link-badge">boosty.to/megoru</span>
                            </div>
                            <p style={{ fontSize: 'var(--ui-font-size)' }}>
                                {t('support.boostyDesc')}
                            </p>
                        </div>
                    </div>
                    <button className="btn-primary btn-boosty" onClick={handleOpenBoosty}>
                        {t('support.boostyButton')}
                        <ExternalLink size={16} />
                    </button>
                </div>

                {/* Tiers Row */}
                <div className="support-tiers-grid">
                    {/* Tier 1: Support */}
                    <div className="support-card tier-card">
                        <div className="tier-header">
                            <div className="tier-title-box">
                                <h3>{t('support.tierSupportTitle')}</h3>
                                <span className="tier-price">{t('support.tierSupportPrice')}</span>
                            </div>
                        </div>
                        <ul className="tier-features">
                            <li>
                                <Sparkles size={16} className="feature-icon icon-amber" />
                                <span>{t('support.featureNoUnlicensed')}</span>
                            </li>
                            <li>
                                <Heart size={16} className="feature-icon icon-red" />
                                <span>{t('support.featureSupportersList')}</span>
                            </li>
                        </ul>
                    </div>

                    {/* Tier 2: Premium */}
                    <div className="support-card tier-card tier-premium">
                        <div className="tier-header">
                            <div className="tier-title-box">
                                <div className="tier-title-row">
                                    <h3>{t('support.tierPremiumTitle')}</h3>
                                </div>
                                <span className="tier-price">{t('support.tierPremiumPrice')}</span>
                            </div>
                        </div>
                        <ul className="tier-features">
                            <li>
                                <Sparkles size={16} className="feature-icon icon-amber" />
                                <span>{t('support.featureNoUnlicensed')}</span>
                            </li>
                            <li>
                                <Heart size={16} className="feature-icon icon-red" />
                                <span>{t('support.featureSupportersList')}</span>
                            </li>
                            <li>
                                <Lightbulb size={16} className="feature-icon icon-blue" />
                                <span>{t('support.featureSuggestFeature')}</span>
                            </li>
                        </ul>
                    </div>
                </div>

                {/* Supporters Block */}
                <div className="support-card supporters-card full-width">
                    <div className="supporters-header">
                        <Heart size={20} className="icon-red" fill="currentColor" />
                        <span className="supporters-header-text">{t('support.supportersTitle')}</span>
                    </div>
                    <div className="supporters-list">
                        {isLoadingSupporters ? (
                            Array.from({ length: 3 }).map((_, idx) => (
                                <div key={idx} className="supporter-item skeleton-item">
                                    <div className="supporter-avatar skeleton-box" />
                                    <div className="supporter-details">
                                        <div className="skeleton-line skeleton-name" />
                                        <div className="skeleton-line skeleton-badge" />
                                    </div>
                                </div>
                            ))
                        ) : supporters.map((supporter) => (
                            <div key={supporter.id} className="supporter-item">
                                <div className="supporter-avatar">
                                    <img src={supporter.avatar} alt={supporter.name} />
                                </div>
                                <div className="supporter-details">
                                    <span className="supporter-name">{supporter.name}</span>
                                    <span className={`supporter-badge tier-${supporter.tier}`}>
                                        {supporter.tier === 'premium'
                                            ? t('support.tierPremiumBadge')
                                            : t('support.tierSupportBadge')}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* License Key Section */}
                <div className="support-card license-card full-width">
                    <div className="license-header">
                        <KeyRound size={20} className="icon-amber" />
                        <span className="license-header-text">{t('support.licenseKeyTitle')}</span>
                    </div>
                    <form className="license-form" onSubmit={async (e) => {
                        e.preventDefault();
                        const trimmedKey = licenseKey.trim();
                        if (!trimmedKey || isActivating) return;

                        setIsActivating(true);
                        try {
                            const result = await validateLicense(trimmedKey);

                            if (result.success && result.expiresAt) {
                                setConfig({
                                    ...config,
                                    licenseKey: trimmedKey,
                                    licenseExpiresAt: result.expiresAt,
                                });
                                showNotification(t('common.success'), t('support.licenseSuccess'), 'success');
                                setLicenseKey('');
                            } else {
                                let errMessage = t('support.licenseError');
                                if (result.errorType === 'NETWORK_ERROR') {
                                    errMessage = t('common.networkError');
                                } else if (result.errorType === 'SERVER_ERROR') {
                                    errMessage = t('common.serverError');
                                }
                                showNotification(t('common.error'), errMessage, 'error');
                            }
                        } catch {
                            showNotification(t('common.error'), t('support.licenseError'), 'error');
                        } finally {
                            setIsActivating(false);
                        }
                    }}>
                        <input
                            type="text"
                            className="license-input"
                            placeholder={t('support.licenseKeyPlaceholder')}
                            value={licenseKey}
                            onChange={(e) => setLicenseKey(e.target.value)}
                            disabled={isActivating}
                        />
                        <button type="submit" className="btn-primary btn-license" disabled={!licenseKey.trim() || isActivating}>
                            {isActivating ? t('support.activatingLicense') : t('support.activateLicense')}
                            {!isActivating && <CheckCircle2 size={16} />}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
});
