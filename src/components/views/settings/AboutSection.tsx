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

/**
 * Нормализует и форматирует строку releaseNotes (HTML или Markdown) в чистый читаемый текст.
 */
function normalizeReleaseNotes(str: string | undefined | null): string {
    if (!str || typeof str !== 'string') return '';
    let res = str;

    // Преобразуем экранированные символы перевода строки
    res = res.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');

    // Если содержится HTML
    if (/<[a-z][\s\S]*>/i.test(res)) {
        res = res
            .replace(/<\/li>|<\/p>|<\/div>|<\/h[1-6]>|<br\s*\/?>/gi, '\n')
            .replace(/<li>/gi, '• ')
            .replace(/<[^>]+>/g, '');
    } else {
        // Очистка спецификации Markdown для текстового отображения
        res = res
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/^\s*[*+-]\s+/gm, '• ')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/__(.*?)__/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/_(.*?)_/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
    }

    return res
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .join('\n');
}

async function fetchReleaseNotesFromGithub(version: string): Promise<string | undefined> {
    const headers = { Accept: 'application/vnd.github+json' };
    const versions = version.startsWith('v') ? [version, version.slice(1)] : [version, `v${version}`];

    for (const releaseVersion of versions) {
        try {
            const response = await fetch(
                `https://api.github.com/repos/megoRU/YetAnotherSSHClient/releases/tags/${encodeURIComponent(releaseVersion)}`,
                { headers }
            );
            if (!response.ok) continue;

            const data = await response.json() as { body?: unknown };
            if (typeof data.body === 'string' && data.body.trim()) {
                return data.body.trim();
            }
        } catch {
            // Основной процесс уже попытался получить заметки; здесь достаточно тихого fallback.
        }
    }

    return undefined;
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
    ipcRenderer,
    t
}) => {
    const isMac = ipcRenderer?.platform === 'darwin';
    const [showWhatsNew, setShowWhatsNew] = useState(false);
    const [fallbackReleaseNotes, setFallbackReleaseNotes] = useState<{ version: string; notes?: string }>({ version: '' });

    const isUpdateAvailable = !isMac && (
        status === 'available' ||
        status === 'downloading' ||
        status === 'downloaded' ||
        status === 'installing' ||
        (!!updateInfo && status !== 'not-available' && status !== 'error') ||
        !!manualCheckResult?.available
    );

    const targetVersion = updateInfo?.version || manualCheckResult?.version || '';
    const rawReleaseNotes = updateInfo?.releaseNotes || manualCheckResult?.releaseNotes;
    const releaseNotes = rawReleaseNotes?.trim()
        ? normalizeReleaseNotes(rawReleaseNotes)
        : fallbackReleaseNotes.version === targetVersion ? fallbackReleaseNotes.notes : undefined;
    const downloadedMegabytes = progress ? Math.floor(progress.transferred / (1024 * 1024)) : 0;
    const totalMegabytes = progress ? Math.ceil(progress.total / (1024 * 1024)) : 0;

    React.useEffect(() => {
        let isDisposed = false;

        if (!isUpdateAvailable || rawReleaseNotes?.trim() || !targetVersion) {
            return () => {
                isDisposed = true;
            };
        }

        void fetchReleaseNotesFromGithub(targetVersion).then(notes => {
            if (!isDisposed) {
                setFallbackReleaseNotes({
                    version: targetVersion,
                    notes: notes ? normalizeReleaseNotes(notes) : undefined
                });
            }
        });

        return () => {
            isDisposed = true;
        };
    }, [isUpdateAvailable, rawReleaseNotes, targetVersion]);

    const handleInstallClick = () => {
        if (status === 'downloaded') {
            quitAndInstall();
        } else if (status === 'idle' || status === 'available' || status === 'error') {
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
        if (status === 'downloading') {
            return t('settings.downloadingUpdate');
        }
        if (status === 'downloaded') {
            return t('settings.readyToInstall');
        }
        if (status === 'installing') {
            return t('settings.installingUpdate');
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
                    <div className="settings-description" style={{ color: 'var(--text-secondary)' }}>
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
                                disabled={status === 'downloading' || status === 'installing'}
                                className="btn-primary btn-about-action"
                            >
                                {status === 'downloading' ? (
                                    <>
                                        <Download size={14} />
                                        <span>{t('settings.downloadingButton', { downloaded: String(downloadedMegabytes), total: String(totalMegabytes) })}</span>
                                    </>
                                ) : status === 'downloaded' ? (
                                    <span>{t('settings.restartAndInstall')}</span>
                                ) : status === 'installing' ? (
                                    <span>{t('settings.installingUpdate')}</span>
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
                            <RefreshCw size={14} />
                            {isChecking || status === 'checking' ? t('settings.checkingUpdates') : t('settings.checkUpdates')}
                        </button>
                    )}
                </div>
            </div>

            {showWhatsNew && isUpdateAvailable && (
                <div className="release-notes-container">
                    {releaseNotes ? (
                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', color: 'var(--text-primary)', fontSize: '0.92rem' }}>
                            {releaseNotes}
                        </div>
                    ) : (
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            {t('settings.noReleaseNotes')}
                        </div>
                    )}
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

        </div>
    );
});
