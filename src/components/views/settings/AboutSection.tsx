import React from 'react';
import { Info, RefreshCw } from 'lucide-react';
import { VERSION } from '../../../types';
import type { UpdateInfo, UpdateProgress, UpdateStatus } from '../../../types';

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
    showNotification: (title: string, message: string, type?: any) => void;
    stripHtml: (html: string) => string;
    ipcRenderer: any;
    t: (key: string, options?: any) => string;
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
    return (
        <div className="settings-group" id="section-about">
            <div className="settings-group-title">
                <Info size={14} className="settings-group-icon" /> {t('settings.about')}
            </div>
            <div className="about-section-layout">
                <img
                    src="./icons/icon256.png"
                    className="about-logo"
                    alt="Logo"
                />
                <div className="about-info-container">
                    <div className="about-app-name">YetAnotherSSHClient</div>
                    <div className="about-meta-row">
                        <span>{t('settings.version')}: {VERSION}</span>

                        <button
                            onClick={handleCheckUpdates}
                            disabled={isChecking}
                            className="btn-secondary btn-check-updates"
                        >
                            <RefreshCw size={12} className={isChecking ? 'spin' : ''} />
                            {isChecking ? t('settings.checkingUpdates') : t('settings.checkUpdates')}
                        </button>

                        {updateInfo?.releaseNotes && (
                            <button
                                onClick={() => showNotification(
                                    `${t('settings.whatsNew')} (v${updateInfo.version})`,
                                    stripHtml(updateInfo.releaseNotes!),
                                    'info'
                                )}
                                className="btn-secondary btn-whats-new"
                            >
                                {t('settings.whatsNew')}
                            </button>
                        )}
                    </div>

                    {(manualCheckResult || status !== 'idle') && (
                        <div className="update-status-container">
                            {status === 'available' && updateInfo ? (
                                <button
                                    onClick={startDownload}
                                    className="btn-primary btn-download-update"
                                >
                                    {t('settings.download', { version: updateInfo.version })}
                                </button>
                            ) : status === 'downloading' && progress ? (
                                <div className="progress-container">
                                    <div className="progress-bar-bg">
                                        <div className="progress-bar-fill" style={{ width: `${progress.percent}%` }} />
                                    </div>
                                    <span className="progress-percent">{Math.round(progress.percent)}%</span>
                                </div>
                            ) : status === 'downloaded' ? (
                                <button
                                    onClick={quitAndInstall}
                                    className="btn-primary btn-install-update"
                                >
                                    {t('settings.installing')}
                                </button>
                            ) : status === 'error' ? (
                                <div className="update-error-badge">
                                    {t('common.error')}: {updateError || ''}
                                </div>
                            ) : manualCheckResult ? (
                                <div className="manual-check-container">
                                    {manualCheckResult.available ? (
                                        <div className="update-available-badge">
                                            {t('settings.newVersionAvailable', { version: manualCheckResult.version! })}
                                        </div>
                                    ) : (
                                        <div className="no-updates-badge">
                                            {manualCheckResult.error ? `${t('common.error')}: ${manualCheckResult.error}` : t('settings.noUpdates')}
                                        </div>
                                    )}
                                </div>
                            ) : null}
                        </div>
                    )}

                    <div className="about-links">
                        <a href="#" onClick={(e) => {
                            e.preventDefault();
                            ipcRenderer?.openExternal?.('https://github.com/megoRU/YetAnotherSSHClient');
                        }} className="about-link">{t('settings.github')}</a>
                        <a href="#" onClick={(e) => {
                            e.preventDefault();
                            ipcRenderer?.openExternal?.('https://github.com/megoRU/YetAnotherSSHClient/blob/main/LICENSE');
                        }} className="about-link">{t('settings.license')}</a>
                    </div>
                </div>
            </div>
        </div>
    );
});
