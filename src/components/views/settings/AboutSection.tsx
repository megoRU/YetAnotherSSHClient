import React from 'react';
import { RefreshCw, ExternalLink } from 'lucide-react';
import { VERSION } from '../../../types';
import type { UpdateInfo, UpdateProgress, UpdateStatus, NotificationType, NotificationAction } from '../../../types';
import type { IpcRendererApi } from '../../../global';

interface AboutSectionProps {
    handleCheckUpdates: () => Promise<void>;
    isChecking: boolean;
    updateInfo: UpdateInfo | null;
    status: UpdateStatus;
    progress: UpdateProgress | null;
    updateError: string | null;
    startDownload: () => void;
    quitAndInstall: () => void;
    manualCheckResult: { available: boolean, version?: string, url?: string, error?: string } | null;
    showNotification: (title: string, message: string, type?: NotificationType, action?: NotificationAction) => void;
    stripHtml: (html: string) => string;
    ipcRenderer: IpcRendererApi;
    t: (key: string, options?: Record<string, string>) => string;
}

export const AboutSection: React.FC<AboutSectionProps> = React.memo(({
    handleCheckUpdates,
    isChecking,
    updateInfo,
    status,
    progress,
    updateError,
    startDownload,
    quitAndInstall,
    manualCheckResult,
    showNotification,
    stripHtml,
    ipcRenderer,
    t
}) => {
    const isMac = ipcRenderer?.platform === 'darwin';

    const getUpdateStatusText = () => {
        if (isMac) {
            return t('settings.macOsUpdateUnavailableDesc');
        }
        if (status === 'checking' || isChecking) {
            return t('settings.checkingUpdates');
        }
        if (status === 'downloading' && progress) {
            return `${Math.round(progress.percent)}%`;
        }
        if (status === 'downloaded') {
            return t('settings.clickToRestart');
        }
        if (status === 'available' && updateInfo) {
            return t('settings.newVersionAvailableNotice', { version: updateInfo.version });
        }
        if (manualCheckResult?.available) {
            return t('settings.newVersionAvailableNotice', { version: manualCheckResult.version! });
        }
        if (updateError || manualCheckResult?.error) {
            return `${t('common.error')}: ${updateError || manualCheckResult?.error}`;
        }
        return t('settings.latestVersionInstalled');
    };

    return (
        <div className="settings-section-page">
            <div className="settings-section-header" style={{ marginBottom: '16px' }}>
                <h2 className="settings-section-title">{t('settings.updates')}</h2>
                <div className="settings-section-subtitle">{t('settings.updatesSubtitle')}</div>
            </div>

            <div className="settings-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
                <div className="settings-label-container">
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)' }}>YetAnotherSSHClient</span>
                        <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', fontWeight: 500 }}>v{VERSION}</span>
                    </div>
                    <div className="settings-description" style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        {getUpdateStatusText()}
                    </div>
                </div>

                <div className="about-action-container">
                    {isMac ? (
                        <button
                            className="btn-primary btn-about-action"
                            onClick={() => ipcRenderer?.openExternal?.('https://github.com/megoRU/YetAnotherSSHClient/releases')}
                        >
                            <ExternalLink size={14} />
                            {t('settings.downloadLatestVersion')}
                        </button>
                    ) : status === 'available' && updateInfo ? (
                        <button
                            onClick={startDownload}
                            className="btn-primary btn-about-action"
                        >
                            {t('settings.download', { version: updateInfo.version })}
                        </button>
                    ) : status === 'downloaded' ? (
                        <button
                            onClick={quitAndInstall}
                            className="btn-primary btn-about-action"
                        >
                            {t('settings.installing')}
                        </button>
                    ) : (
                        <button
                            onClick={handleCheckUpdates}
                            disabled={isChecking || status === 'checking'}
                            className="btn-secondary btn-about-action"
                        >
                            <RefreshCw size={14} className={isChecking || status === 'checking' ? 'spin' : ''} />
                            {isChecking || status === 'checking' ? t('settings.checkingUpdates') : t('settings.checkUpdates')}
                        </button>
                    )}
                </div>
            </div>

            <div className="settings-row" style={{ marginTop: '16px' }}>
                <div className="settings-label-container">
                    <label>GitHub</label>
                    <div className="settings-description">{t('settings.githubDesc')}</div>
                </div>
                <button
                    className="btn-secondary btn-about-action"
                    onClick={() => ipcRenderer?.openExternal?.('https://github.com/megoRU/YetAnotherSSHClient')}
                >
                    GitHub
                </button>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.license')}</label>
                </div>
                <button
                    className="btn-secondary btn-about-action"
                    onClick={() => ipcRenderer?.openExternal?.('https://github.com/megoRU/YetAnotherSSHClient/blob/main/LICENSE')}
                >
                    {t('settings.license')}
                </button>
            </div>
        </div>
    );
});
