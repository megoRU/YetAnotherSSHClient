import React from 'react';
import { Download, UploadCloud, RefreshCw, KeyRound, ShieldAlert } from 'lucide-react';

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

            {/* Block 1: Encryption & Key */}
            <div className="settings-group-title" style={{ marginTop: '16px', marginBottom: '8px', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <KeyRound size={18} />
                {t('settings.encryptionAndKey')}
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

            {/* Block 2: Backup */}
            <div className="settings-group-title" style={{ marginTop: '28px', marginBottom: '8px', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Download size={18} />
                {t('settings.backup')}
            </div>

            <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                <div className="settings-description" style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: '1.4' }}>
                    <ShieldAlert size={18} style={{ color: 'var(--accent-color)', flexShrink: 0, marginTop: '2px' }} />
                    <span>{t('settings.backupRestoreNotice')}</span>
                </div>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.export')}</label>
                </div>
                <button className="btn-secondary btn-backup-action" onClick={handleExport}>
                    <Download size={16} /> {t('settings.export')}
                </button>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.import')}</label>
                </div>
                <button className="btn-secondary btn-backup-action" onClick={handleImport}>
                    <UploadCloud size={16} /> {t('settings.import')}
                </button>
            </div>
        </div>
    );
});
