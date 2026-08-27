import React, { useState } from 'react';
import { Heart, ExternalLink, Copy, QrCode, Hammer } from 'lucide-react';
import type { AppConfig, NotificationType, NotificationAction } from '../../../types';
import { useI18n } from '../../../utils/i18n';
import { QRCodeModal } from '../../modals/QRCodeModal';

const { ipcRenderer } = window;

interface SupportViewProps {
    config: AppConfig;
    showNotification: (title: string, message: string, type?: NotificationType, action?: NotificationAction) => void;
}

export const SupportView: React.FC<SupportViewProps> = React.memo(({ config, showNotification }) => {
    const { t } = useI18n(config.language);
    const tonAddress = "UQBBo6FN-c0QSH2mIgLM-984HzOUobKABmVMvSWaycxTLtF9";
    const tonUrl = `ton://transfer/${tonAddress}`;
    const [showQR, setShowQR] = useState(false);

    const handleCopyAddress = () => {
        navigator.clipboard.writeText(tonAddress);
        showNotification(t('common.success'), t('common.copied'), 'success');
    };

    return (
        <div className="settings-view-wrapper support-view">
            <div className="settings-view-content">
                <div className="support-header">
                    <div className="support-icon-large">
                        <Heart size={36} fill="currentColor" />
                    </div>
                    <h1>{t('support.title')}</h1>
                    <p className="support-subtitle">
                        {t('support.subtitle')}
                    </p>
                </div>

                <div className="support-cards-row">
                    <div className="support-card donate-card primary">
                        <div className="support-card-header">
                            <Heart size={24} className="icon-purple" />
                            <h2>{t('support.cloudTipsTitle')}</h2>
                        </div>
                        <p>{t('support.cloudTipsDesc')}</p>
                        <button
                            className="btn-primary btn-cloudtips"
                            onClick={() => ipcRenderer?.openExternal?.('https://pay.cloudtips.ru/p/ab380c86')}
                        >
                            {t('support.cloudTipsButton')}
                            <ExternalLink size={16} />
                        </button>
                    </div>

                    <div className="support-card donate-card">
                        <div className="support-card-header">
                            <span className="ton-icon">💎</span>
                            <h2>{t('support.tonTitle')}</h2>
                        </div>
                        <p>{t('support.tonDesc')}</p>
                        <div className="crypto-address-box">
                            {tonAddress}
                        </div>
                        <div className="crypto-actions">
                            <button className="btn-secondary" onClick={handleCopyAddress}>
                                <Copy size={14} /> {t('support.copyAddress')}
                            </button>
                            <button className="btn-secondary" onClick={() => setShowQR(true)}>
                                <QrCode size={14} /> {t('support.showQR')}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="support-card info-card full-width">
                    <div className="support-card-header">
                        <span className="rocket-icon">🚀</span>
                        <h2>{t('support.thanksTitle')}</h2>
                    </div>
                    <p className="info-text">{t('support.thanksText')}</p>

                    <div className="progress-column">
                        <h3><Hammer size={16} className="icon-warning" /> {t('support.inDevelopment')}</h3>
                        <ul>
                            <li>✨ {t('support.commandCompletion')}</li>
                            <li>🤖 {t('settings.mcpAiAgents')}</li>
                        </ul>
                    </div>
                </div>

                <div className="support-footer-thanks">
                    {t('support.footerThanks')}
                </div>
            </div>

            {showQR && (
                <QRCodeModal
                    value={tonUrl}
                    title={t('support.qrModalTitle')}
                    onClose={() => setShowQR(false)}
                />
            )}
        </div>
    );
});
