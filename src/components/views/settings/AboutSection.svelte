<script module lang="ts">
    import { RefreshCw, FileText, Download, ExternalLink } from '@lucide/svelte';

    import { VERSION } from '../../../types';

    import type {
        UpdateInfo,
        UpdateProgress,
        UpdateStatus,
        NotificationType,
        NotificationAction,
    } from '../../../types';

    import type { IpcRendererApi } from '../../../ipc';

    import { untrack } from 'svelte';

    import { type SetStateAction } from '../../../utils/dom';

    interface AboutSectionProps {
        handleCheckUpdates: () => Promise<void>;
        isChecking: boolean;
        updateInfo: UpdateInfo | null;
        status: UpdateStatus;
        progress: UpdateProgress | null;
        updateError: string | null;
        startDownload: () => void;
        installUpdate: () => void;
        manualCheckResult: {
            available: boolean;
            version?: string;
            url?: string;
            releaseNotes?: string;
            error?: string;
        } | null;
        showNotification: (
            title: string,
            message: string,
            type?: NotificationType,
            action?: NotificationAction,
        ) => void;
        stripHtml: (html: string) => string;
        ipcRenderer: IpcRendererApi;
        t: (key: string, options?: Record<string, string>) => string;
    }

    function normalizeReleaseNotes(str: string | undefined | null): string {
        if (!str || typeof str !== 'string') return '';
        let res = str;

        // Преобразуем экранированные символы перевода строки
        res = res
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\r\n/g, '\n');

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
                .replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1 ($2)');
        }

        return res
            .split('\n')
            .map((line) => line.trim())
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
                    { headers },
                );
                if (!response.ok) continue;

                const data = (await response.json()) as { body?: unknown };
                if (typeof data.body === 'string' && data.body.trim()) {
                    return data.body.trim();
                }
            } catch {
                // Основной процесс уже попытался получить заметки; здесь достаточно тихого fallback.
            }
        }

        return undefined;
    }
</script>

<script lang="ts">
    let {
        handleCheckUpdates,
        isChecking,
        updateInfo,
        status,
        progress,
        updateError,
        startDownload,
        installUpdate,
        manualCheckResult,
        ipcRenderer,
        t,
    }: AboutSectionProps = $props();

    let showWhatsNew = $state.raw(false);
    function setShowWhatsNew(next: SetStateAction<typeof showWhatsNew>) {
        showWhatsNew = typeof next === 'function' ? next(showWhatsNew) : next;
    }

    let fallbackReleaseNotes = $state.raw<{ version: string; notes?: string }>({ version: '' });

    const isUpdateAvailable = $derived(
        status === 'available' ||
            status === 'downloading' ||
            status === 'downloaded' ||
            status === 'installing' ||
            (!!updateInfo && status !== 'not-available' && status !== 'error') ||
            !!manualCheckResult?.available,
    );

    const targetVersion = $derived(updateInfo?.version || manualCheckResult?.version || '');

    const rawReleaseNotes = $derived(updateInfo?.releaseNotes || manualCheckResult?.releaseNotes);

    const releaseNotes = $derived(
        rawReleaseNotes?.trim()
            ? normalizeReleaseNotes(rawReleaseNotes)
            : fallbackReleaseNotes.version === targetVersion
              ? fallbackReleaseNotes.notes
              : undefined,
    );

    const downloadedMegabytes = $derived(progress ? Math.floor(progress.transferred / (1024 * 1024)) : 0);

    const totalMegabytes = $derived(progress ? Math.ceil(progress.total / (1024 * 1024)) : 0);

    $effect(() => {
        void [isUpdateAvailable, rawReleaseNotes, targetVersion];
        return untrack(() => {
            let isDisposed = false;

            if (!isUpdateAvailable || rawReleaseNotes?.trim() || !targetVersion) {
                return () => {
                    isDisposed = true;
                };
            }

            void fetchReleaseNotesFromGithub(targetVersion).then((notes) => {
                if (!isDisposed) {
                    fallbackReleaseNotes = {
                        version: targetVersion,
                        notes: notes ? normalizeReleaseNotes(notes) : undefined,
                    };
                }
            });

            return () => {
                isDisposed = true;
            };
        });
    });

    const handleInstallClick = () => {
        if (status === 'downloaded') {
            installUpdate();
        } else if (status === 'idle' || status === 'available' || status === 'error') {
            startDownload();
        }
    };

    const getUpdateStatusText = () => {
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
</script>

<div class="settings-section-page">
    <div class="settings-section-header" style="margin-bottom: 16px">
        <h2 class="settings-section-title">{t('settings.updates')}</h2>
        <div class="settings-section-subtitle">{t('settings.updatesSubtitle')}</div>
    </div>

    <div class="settings-row" style="border-bottom: 1px solid var(--border); padding-bottom: 16px">
        <div class="settings-label-container">
            <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px">
                <span style="font-size: 1.2rem; font-weight: 600; color: var(--text-primary)"
                    >YetAnotherSSHClient</span
                >
                <span style="font-size: 0.95rem; color: var(--text-secondary); font-weight: 500">v{VERSION}</span>
            </div>
            <div class="settings-description" style="color: var(--text-secondary)">
                {getUpdateStatusText()}
            </div>
        </div>

        <div class="about-action-container">
            {#if isUpdateAvailable}<div style="display: flex; gap: 10px; align-items: center">
                    <button
                        class="btn-secondary btn-about-action"
                        onclick={() => setShowWhatsNew((prev) => !prev)}
                    >
                        <FileText size={14} />
                        {t('settings.whatsNew')}
                    </button>
                    <button
                        onclick={handleInstallClick}
                        disabled={status === 'downloading' || status === 'installing'}
                        class="btn-primary btn-about-action"
                    >
                        {#if status === 'downloading'}
                            <Download size={14} />
                            <span
                                >{t('settings.downloadingButton', {
                                    downloaded: String(downloadedMegabytes),
                                    total: String(totalMegabytes),
                                })}</span
                            >
                        {:else if status === 'downloaded'}<span>{t('settings.restartAndInstall')}</span
                            >{:else if status === 'installing'}<span>{t('settings.installingUpdate')}</span
                            >{:else}{t('settings.downloadUpdate')}{/if}
                    </button>
                </div>{:else}<button
                    onclick={() => void handleCheckUpdates()}
                    disabled={isChecking || status === 'checking'}
                    class="btn-secondary btn-about-action"
                >
                    <RefreshCw size={14} />
                    {#if isChecking || status === 'checking'}{t('settings.checkingUpdates')}{:else}{t(
                            'settings.checkUpdates',
                        )}{/if}
                </button>{/if}
        </div>
    </div>

    {#if showWhatsNew && isUpdateAvailable}<div class="release-notes-container">
            {#if releaseNotes}<div
                    style="white-space: pre-wrap; line-height: 1.6; color: var(--text-primary); font-size: 0.92rem"
                >
                    {releaseNotes}
                </div>{:else}<div style="color: var(--text-secondary); font-size: 0.9rem">
                    {t('settings.noReleaseNotes')}
                </div>{/if}
        </div>{/if}

    <div class="settings-row" style="margin-top: 16px">
        <div class="settings-label-container">
            <span class="settings-label">GitHub</span>
            <div class="settings-description">{t('settings.githubDesc')}</div>
        </div>
        <button
            class="btn-secondary btn-about-action"
            onclick={() => ipcRenderer?.openExternal?.('https://github.com/megoRU/YetAnotherSSHClient')}
        >
            GitHub <ExternalLink size={14} />
        </button>
    </div>
</div>
