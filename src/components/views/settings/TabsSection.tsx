import React from 'react';
import { Layout } from 'lucide-react';
import type { AppConfig } from '../../../types';

interface TabsSectionProps {
    config: AppConfig;
    handleUpdate: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
    t: (key: string, options?: any) => string;
}

export const TabsSection: React.FC<TabsSectionProps> = React.memo(({
    config,
    handleUpdate,
    t
}) => {
    return (
        <div className="settings-group" id="section-tabs">
            <div className="settings-group-title">
                <Layout size={14} className="settings-group-icon" /> {t('settings.tabs')}
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.activeTabColor')}</label>
                    <div className="settings-description">{t('settings.activeTabColorDesc')}</div>
                </div>
                <label className="ui-switch">
                    <input
                        type="checkbox"
                        checked={config.activeTabColorEnabled || false}
                        onChange={e => handleUpdate('activeTabColorEnabled', e.target.checked)}
                    />
                    <span className="ui-slider"></span>
                </label>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.alwaysHover')}</label>
                    <div className="settings-description">{t('settings.alwaysHoverDesc')}</div>
                </div>
                <label className="ui-switch">
                    <input
                        type="checkbox"
                        checked={config.alwaysShowHoverOnInactiveTabs || false}
                        onChange={e => handleUpdate('alwaysShowHoverOnInactiveTabs', e.target.checked)}
                    />
                    <span className="ui-slider"></span>
                </label>
            </div>
        </div>
    );
});
