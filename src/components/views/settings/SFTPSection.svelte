<script module lang="ts">
    import type { AppConfig } from '../../../types';

    import { inlineStyle } from '../../../utils/dom';

    interface SFTPSectionProps {
        config: AppConfig;
        handleUpdate: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
        t: (key: string, options?: Record<string, string>) => string;
    }
</script>

<script lang="ts">
    const fieldId = $props.id();

    let { config, handleUpdate, t }: SFTPSectionProps = $props();
</script>

<div class="settings-section-page">
    <div class="settings-section-header">
        <h2 class="settings-section-title">{t('settings.sftp')}</h2>
        <div class="settings-section-subtitle">{t('settings.sftpSubtitle')}</div>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-soundEnabled'}>{t('sftp.soundEnabled')}</label>
            <div class="settings-description">{t('sftp.soundEnabledDesc')}</div>
        </div>
        <label class="ui-switch">
            <input
                id={fieldId + '-soundEnabled'}
                type="checkbox"
                checked={config.sftpSoundEnabled ?? true}
                onchange={(e) => handleUpdate('sftpSoundEnabled', e.currentTarget.checked)}
            />
            <span class="ui-slider"></span>
        </label>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-soundVolume'}>{t('sftp.soundVolume')}</label>
        </div>
        <div class="volume-control-container">
            <input
                id={fieldId + '-soundVolume'}
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={config.sftpSoundVolume ?? 0.5}
                oninput={(e) => handleUpdate('sftpSoundVolume', parseFloat(e.currentTarget.value))}
                class="volume-slider"
                style={inlineStyle({
                    background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${(config.sftpSoundVolume ?? 0.5) * 100}%, var(--border) ${(config.sftpSoundVolume ?? 0.5) * 100}%, var(--border) 100%)`,
                })}
            />
            <span class="volume-percentage">
                {Math.round((config.sftpSoundVolume ?? 0.5) * 100)}%
            </span>
        </div>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-flashIcon'}>{t('sftp.flashIcon')}</label>
            <div class="settings-description">{t('sftp.flashIconDesc')}</div>
        </div>
        <label class="ui-switch">
            <input
                id={fieldId + '-flashIcon'}
                type="checkbox"
                checked={config.sftpFlashIcon ?? true}
                onchange={(e) => handleUpdate('sftpFlashIcon', e.currentTarget.checked)}
            />
            <span class="ui-slider"></span>
        </label>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-deletePartialOnCancel'}>{t('sftp.deletePartialOnCancel')}</label>
            <div class="settings-description">{t('sftp.deletePartialOnCancelDesc')}</div>
        </div>
        <label class="ui-switch">
            <input
                id={fieldId + '-deletePartialOnCancel'}
                type="checkbox"
                checked={config.sftpDeletePartialOnCancel ?? false}
                onchange={(e) => handleUpdate('sftpDeletePartialOnCancel', e.currentTarget.checked)}
            />
            <span class="ui-slider"></span>
        </label>
    </div>
</div>
