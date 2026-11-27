<script module lang="ts">
    import { Download } from '@lucide/svelte';

    interface LogsSectionProps {
        handleExportLogs: () => Promise<void>;
        t: (key: string, options?: Record<string, string>) => string;
    }
</script>

<script lang="ts">
    let { handleExportLogs, t }: LogsSectionProps = $props();
</script>

<div class="settings-section-page">
    <div class="settings-section-header">
        <h2 class="settings-section-title">{t('settings.logs')}</h2>
        <div class="settings-section-subtitle">{t('settings.logsSubtitle')}</div>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <span class="settings-label">{t('settings.exportLogs')}</span>
            <div class="settings-description">
                {t('settings.exportLogsDesc')}
            </div>
        </div>
        <button class="btn-secondary btn-backup-action" onclick={handleExportLogs}>
            <Download size={16} />
            {t('settings.exportLogs')}
        </button>
    </div>
</div>
