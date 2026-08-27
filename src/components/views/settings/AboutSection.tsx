import React, { useState } from 'react';
import { RefreshCw, ExternalLink, FileText, Download } from 'lucide-react';
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
    manualCheckResult: { available: boolean, version?: string, url?: string, releaseNotes?: string, error?: string } | null;
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
    stripHtml,
    ipcRenderer,
    t
}) => {
    const isMac = ipcRenderer?.platform === 'darwin';
    const [showWhatsNew, setShowWhatsNew] = useState(false);

    const isUpdateAvailable = !isMac && (
        status === 'available' ||
        status === 'downloading' ||
        status === 'downloaded' ||
        (!!updateInfo && status !== 'not-available' && status !== 'error') ||
        !!manualCheckResult?.available
    );

    const targetVersion = updateInfo?.version || manualCheckResult?.version || '';
    const releaseNotes = updateInfo?.releaseNotes || manualCheckResult?.releaseNotes;

    const handleInstallClick = () => {
        if (status === 'downloaded') {
            quitAndInstall();
        } else {
            startDownload();
        }
    };

    const getUpdateStatusText = () => {
        if (isMac) {
            return t('settings.macOsUpdateUnavailableDesc');
        }
        if (status === 'checking' || isChecking) {
            return t('settings.checkingUpdates');
        }
        if (isUpdateAvailable) {
            return t('settings.newVersionAvailableNotice', { version: targetVersion });
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
                    ) : isUpdateAvailable ? (
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <button
                                className="btn-secondary btn-about-action"
                                onClick={() => setShowWhatsNew(prev => !prev)}
                            >
                                <FileText size={14} />
                                {t('settings.whatsNew')}
                            </button>
                            <button
                                onClick={handleInstallClick}
                                disabled={status === 'downloading'}
                                className="btn-primary btn-about-action"
                            >
                                {status === 'downloading' ? (
                                    <>
                                        <Download size={14} className="spin" />
                                        <span>{progress ? `${Math.round(progress.percent)}%` : t('settings.checkingUpdates')}</span>
                                    </>
                                ) : (
                                    t('settings.installUpdate')
                                )}
                            </button>
                        </div>
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

            {showWhatsNew && isUpdateAvailable && (
                <div style={{
                    marginTop: '16px',
                    padding: '16px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '0.9rem',
                    lineHeight: '1.5'
                }}>
                    <div style={{ fontWeight: 600, marginBottom: '8px', color: 'var(--accent)' }}>
                        {t('settings.whatsNew')}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
                        {releaseNotes ? stripHtml(releaseNotes) : t('settings.noReleaseNotes')}
                    </div>
                </div>
            )}

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
                    <div className="settings-description">{t('settings.licenseDesc')}</div>
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
