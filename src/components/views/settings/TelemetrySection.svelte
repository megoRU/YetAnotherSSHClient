<script module lang="ts">
    import type { AppConfig } from '../../../types';

    interface TelemetrySectionProps {
        config: AppConfig;
        /**
         * Переключение телеметрии: выключение дополнительно удаляет запись
         * установки на сервере и показывает тост с результатом — поэтому это
         * отдельный обработчик, а не прямой `handleUpdate`.
         */
        onTelemetryToggle: (enabled: boolean) => void;
        t: (key: string, options?: Record<string, string>) => string;
    }
</script>

<script lang="ts">
    const fieldId = $props.id();

    let { config, onTelemetryToggle, t }: TelemetrySectionProps = $props();
</script>

<div class="settings-section-page">
    <div class="settings-section-header">
        <h2 class="settings-section-title">{t('settings.telemetry')}</h2>
        <div class="settings-section-subtitle">{t('settings.telemetrySubtitle')}</div>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-telemetrySend'}>{t('settings.telemetrySend')}</label>
            <div class="settings-description">{t('settings.telemetryDesc')}</div>
        </div>
        <label class="ui-switch">
            <input
                id={fieldId + '-telemetrySend'}
                type="checkbox"
                checked={config.telemetryEnabled ?? true}
                onchange={(e) => onTelemetryToggle(e.currentTarget.checked)}
            />
            <span class="ui-slider"></span>
        </label>
    </div>
</div>
