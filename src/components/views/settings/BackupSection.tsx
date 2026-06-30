import React from 'react';
import { Database, Download, UploadCloud } from 'lucide-react';

interface BackupSectionProps {
    handleExport: () => Promise<void>;
    handleImport: () => Promise<void>;
    t: (key: string, options?: any) => string;
}

export const BackupSection: React.FC<BackupSectionProps> = React.memo(({
    handleExport,
    handleImport,
    t
}) => {
    return (
        <div className="settings-group" id="section-backup">
            <div className="settings-group-title">
                <Database size={14} className="settings-group-icon" /> {t('settings.backup')}
            </div>
            <div className="settings-description backup-desc">
                {t('settings.backupDesc')}
            </div>
            <div className="backup-actions">
                <button className="btn-secondary btn-backup-action" onClick={handleExport}>
                    <Download size={16} /> {t('settings.export')}
                </button>
                <button className="btn-secondary btn-backup-action" onClick={handleImport}>
                    <UploadCloud size={16} /> {t('settings.import')}
                </button>
            </div>
        </div>
    );
});
