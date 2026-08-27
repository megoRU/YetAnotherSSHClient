import React from 'react';
import { RefreshCw } from 'lucide-react';

interface SecuritySectionProps {
    handleRegenerateKey: () => Promise<void>;
    t: (key: string, options?: Record<string, string>) => string;
}

export const SecuritySection: React.FC<SecuritySectionProps> = React.memo(({
    handleRegenerateKey,
    t
}) => {
    return (
        <div className="settings-section-page">
            <div className="settings-section-header">
                <h2 className="settings-section-title">{t('connection.auth')}</h2>
                <div className="settings-section-subtitle">{t('settings.securitySubtitle')}</div>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('vault.regenerate')}</label>
                    <div className="settings-description">{t('vault.regenerateDesc')}</div>
                </div>
                <button
                    className="btn-secondary btn-regenerate-key"
                    onClick={handleRegenerateKey}
                >
                    <RefreshCw size={16} /> {t('vault.regenerate')}
                </button>
            </div>
        </div>
    );
});
