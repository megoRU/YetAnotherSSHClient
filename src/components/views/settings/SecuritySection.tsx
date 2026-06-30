import React from 'react';
import { ShieldCheck, RefreshCw } from 'lucide-react';

interface SecuritySectionProps {
    handleRegenerateKey: () => Promise<void>;
    t: (key: string, options?: Record<string, string>) => string;
}

export const SecuritySection: React.FC<SecuritySectionProps> = React.memo(({
    handleRegenerateKey,
    t
}) => {
    return (
        <div className="settings-group" id="section-security">
            <div className="settings-group-title">
                <ShieldCheck size={14} className="settings-group-icon" /> {t('connection.auth')}
            </div>
            <div className="settings-description security-desc">
                {t('vault.regenerateDesc')}
            </div>
            <button
                className="btn-secondary btn-regenerate-key"
                onClick={handleRegenerateKey}
            >
                <RefreshCw size={16} /> {t('vault.regenerate')}
            </button>
        </div>
    );
});
