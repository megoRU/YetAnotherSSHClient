import React from 'react';
import { Download, UploadCloud, RefreshCw, ShieldAlert } from 'lucide-react';

interface BackupSectionProps {
    handleExport: () => Promise<void>;
    handleImport: () => Promise<void>;
    handleRegenerateKey: () => Promise<void>;
    t: (key: string, options?: Record<string, string>) => string;
}

export const BackupSection: React.FC<BackupSectionProps> = React.memo(({
    handleExport,
    handleImport,
    handleRegenerateKey,
    t
}) => {
    return (
        <div className="settings-section-page">
            <div className="settings-section-header">
                <h2 className="settings-section-title">{t('settings.backup')}</h2>
                <div className="settings-section-subtitle">{t('settings.backupDesc')}</div>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('vault.regenerate')}</label>
                    <div className="settings-description">
                        {t('settings.regenerateKeyWarning')}
                    </div>
                </div>
                <button
                    className="btn-secondary btn-regenerate-key"
                    onClick={handleRegenerateKey}
                >
                    <RefreshCw size={16} /> {t('vault.regenerate')}
                </button>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.export')}</label>
                    <div className="settings-description">
                        {t('settings.exportDesc')}
                    </div>
                </div>
                <button className="btn-secondary btn-backup-action" onClick={handleExport}>
                    <Download size={16} /> {t('settings.export')}
                </button>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.import')}</label>
                    <div className="settings-description">
                        {t('settings.importDesc')}
                    </div>
                </div>
                <button className="btn-secondary btn-backup-action" onClick={handleImport}>
                    <UploadCloud size={16} /> {t('settings.import')}
                </button>
            </div>


            <div className="settings-row" style={{ marginTop: '12px', background: 'var(--hover-surface)', borderRadius: '8px', padding: '12px 16px' }}>
                <div className="settings-description" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', color: 'var(--text-secondary)', fontSize: 'var(--ui-font-size)', lineHeight: '1.4' }}>
                    <ShieldAlert size={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '2px' }} />
                    <span>{t('settings.backupRestoreNotice')}</span>
                </div>
            </div>
        </div>
    );
});
