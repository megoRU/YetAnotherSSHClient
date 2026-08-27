import React from 'react';
import { Download, UploadCloud } from 'lucide-react';

interface BackupSectionProps {
    handleExport: () => Promise<void>;
    handleImport: () => Promise<void>;
    t: (key: string, options?: Record<string, string>) => string;
}

export const BackupSection: React.FC<BackupSectionProps> = React.memo(({
    handleExport,
    handleImport,
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
