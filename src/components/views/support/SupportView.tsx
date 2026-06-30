import React from 'react';
import { Heart, ExternalLink, Copy, QrCode, CheckCircle2, Hammer } from 'lucide-react';
import type { AppConfig, NotificationType, NotificationAction } from '../../../types';
import { useI18n } from '../../../utils/i18n';

const { ipcRenderer } = window;

interface SupportViewProps {
    config: AppConfig;
    showNotification: (title: string, message: string, type?: NotificationType, action?: NotificationAction) => void;
}

export const SupportView: React.FC<SupportViewProps> = React.memo(({ config, showNotification }) => {
    const { t } = useI18n(config.language);
    const tonAddress = "UQBBo6FN-c0QSH2mIgLM-984HzOUobKABmVMvSWaycxTLtF9";

    const handleCopyAddress = () => {
        navigator.clipboard.writeText(tonAddress);
        showNotification(t('common.success'), t('common.copied'), 'success');
    };

    const handleShowQR = () => {
        // В реальном приложении здесь было бы модальное окно с QR
        // Но пока просто покажем уведомление
        showNotification("TON QR-код", tonAddress, "info");
    };

    return (
        <div className="settings-view-wrapper support-view">
            <div className="settings-view-content">
                <div className="support-header">
                    <div className="support-icon-large">
                        <Heart size={48} fill="currentColor" />
                    </div>
                    <h1>Поддержать YetAnotherSSHClient</h1>
                    <p className="support-subtitle">
                        YetAnotherSSHClient — полностью бесплатный SSH-клиент с открытым исходным кодом.
                        Если приложение помогает вам в работе, вы можете поддержать дальнейшую разработку.
                    </p>
                </div>

                <div className="support-cards-row">
                    <div className="support-card donate-card primary">
                        <div className="support-card-header">
                            <Heart size={24} className="icon-purple" />
                            <h2>CloudTips</h2>
                        </div>
                        <p>Поддержите проект любой удобной суммой.</p>
                        <button
                            className="btn-primary btn-cloudtips"
                            onClick={() => ipcRenderer?.openExternal?.('https://pay.cloudtips.ru/p/ab380c86')}
                        >
                            Поддержать через CloudTips
                            <ExternalLink size={16} />
                        </button>
                    </div>

                    <div className="support-card donate-card">
                        <div className="support-card-header">
                            <span className="ton-icon">💎</span>
                            <h2>TON</h2>
                        </div>
                        <p>Поддержка криптовалютой.</p>
                        <div className="crypto-address-box">
                            {tonAddress}
                        </div>
                        <div className="crypto-actions">
                            <button className="btn-secondary" onClick={handleCopyAddress}>
                                <Copy size={14} /> Копировать адрес
                            </button>
                            <button className="btn-secondary" onClick={handleShowQR}>
                                <QrCode size={14} /> Показать QR-код
                            </button>
                        </div>
                    </div>
                </div>

                <div className="support-card info-card full-width">
                    <div className="support-card-header">
                        <span className="rocket-icon">🚀</span>
                        <h2>Благодаря вашей поддержке</h2>
                    </div>
                    <p className="info-text">Каждое пожертвование помогает развивать YetAnotherSSHClient, исправлять ошибки и добавлять новые возможности.</p>

                    <div className="progress-columns">
                        <div className="progress-column">
                            <h3><CheckCircle2 size={16} className="icon-success" /> Уже реализовано</h3>
                            <ul>
                                <li>SSH</li>
                                <li>SFTP</li>
                                <li>Порт-форвардинг</li>
                                <li>Резервное копирование</li>
                                <li>Темы оформления</li>
                            </ul>
                        </div>
                        <div className="progress-column">
                            <h3><Hammer size={16} className="icon-warning" /> В разработке</h3>
                            <ul>
                                <li>🤖 AI-помощник в терминале</li>
                                <li>✨ Автодополнение команд</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div className="support-footer-thanks">
                    Спасибо каждому, кто помогает развивать YetAnotherSSHClient ❤️
                </div>
            </div>
        </div>
    );
});
