import React, { type FC } from 'react';
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

export const TelemetrySection: FC<TelemetrySectionProps> = React.memo(({
    config,
    onTelemetryToggle,
    t
}) => {
    return (
        <div className="settings-section-page">
            <div className="settings-section-header">
                <h2 className="settings-section-title">{t('settings.telemetry')}</h2>
                <div className="settings-section-subtitle">{t('settings.telemetrySubtitle')}</div>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.telemetrySend')}</label>
                    <div className="settings-description">{t('settings.telemetryDesc')}</div>
                </div>
                <label className="ui-switch">
                    <input
                        type="checkbox"
                        checked={config.telemetryEnabled ?? true}
                        onChange={e => onTelemetryToggle(e.target.checked)}
                    />
                    <span className="ui-slider"></span>
                </label>
            </div>
        </div>
    );
});
