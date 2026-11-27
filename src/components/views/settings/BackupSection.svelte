<script module lang="ts">
    import { Download, CloudUpload, RefreshCw, ShieldAlert } from '@lucide/svelte';

    interface BackupSectionProps {
        handleExport: () => Promise<void>;
        handleImport: () => Promise<void>;
        handleRegenerateKey: () => Promise<void>;
        t: (key: string, options?: Record<string, string>) => string;
    }
</script>

<script lang="ts">
    let { handleExport, handleImport, handleRegenerateKey, t }: BackupSectionProps = $props();
</script>

<div class="settings-section-page">
    <div class="settings-section-header">
        <h2 class="settings-section-title">{t('settings.backup')}</h2>
        <div class="settings-section-subtitle">{t('settings.backupDesc')}</div>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <span class="settings-label">{t('vault.regenerate')}</span>
            <div class="settings-description">
                {t('settings.regenerateKeyWarning')}
            </div>
        </div>
        <button class="btn-secondary btn-regenerate-key" onclick={handleRegenerateKey}>
            <RefreshCw size={16} />
            {t('vault.regenerate')}
        </button>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <span class="settings-label">{t('settings.export')}</span>
            <div class="settings-description">
                {t('settings.exportDesc')}
            </div>
        </div>
        <button class="btn-secondary btn-backup-action" onclick={handleExport}>
            <Download size={16} />
            {t('settings.export')}
        </button>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <span class="settings-label">{t('settings.import')}</span>
            <div class="settings-description">
                {t('settings.importDesc')}
            </div>
        </div>
        <button class="btn-secondary btn-backup-action" onclick={handleImport}>
            <CloudUpload size={16} />
            {t('settings.import')}
        </button>
    </div>

    <div
        class="settings-row"
        style="margin-top: 12px; background: var(--hover-surface); border-radius: 8px; padding: 12px 16px"
    >
        <div
            class="settings-description"
            style="display: flex; align-items: flex-start; gap: 10px; color: var(--text-secondary); font-size: var(--ui-font-size); line-height: 1.4"
        >
            <ShieldAlert size={18} style="color: var(--accent); flex-shrink: 0; margin-top: 2px" />
            <span>{t('settings.backupRestoreNotice')}</span>
        </div>
    </div>
</div>
