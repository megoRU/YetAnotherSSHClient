import React from 'react';
import { Download } from 'lucide-react';

interface LogsSectionProps {
    handleExportLogs: () => Promise<void>;
    t: (key: string, options?: Record<string, string>) => string;
}

export const LogsSection: React.FC<LogsSectionProps> = React.memo(({
    handleExportLogs,
    t
}) => {
    return (
        <div className="settings-section-page">
            <div className="settings-section-header">
                <h2 className="settings-section-title">{t('settings.logs')}</h2>
                <div className="settings-section-subtitle">{t('settings.logsSubtitle')}</div>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.exportLogs')}</label>
                    <div className="settings-description">
                        {t('settings.exportLogsDesc')}
                    </div>
                </div>
                <button className="btn-secondary btn-backup-action" onClick={handleExportLogs}>
                    <Download size={16} /> {t('settings.exportLogs')}
                </button>
            </div>
        </div>
    );
});
