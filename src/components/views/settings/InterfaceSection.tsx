import React from 'react';
import { Monitor, Minus, Plus } from 'lucide-react';
import { CustomSelect } from '../../layout/CustomSelect';
import type { AppConfig } from '../../../types';
import type { Language } from '../../../utils/i18n';

interface InterfaceSectionProps {
    config: AppConfig;
    handleUpdate: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
    languageOptions: { value: string; label: string }[];
    themeOptions: { value: string; label: string }[];
    uiFontOptions: { value: string; label: string }[];
    serverCardSizeOptions: { value: string; label: string }[];
    sidebarPositionOptions: { value: string; label: string }[];
    t: (key: string, options?: Record<string, string>) => string;
}

export const InterfaceSection: React.FC<InterfaceSectionProps> = React.memo(({
    config,
    handleUpdate,
    languageOptions,
    themeOptions,
    uiFontOptions,
    serverCardSizeOptions,
    sidebarPositionOptions,
    t
}) => {
    return (
        <div className="settings-group" id="section-interface">
            <div className="settings-group-title">
                <Monitor size={14} className="settings-group-icon" /> {t('settings.interface')}
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.language')}</label>
                </div>
                <CustomSelect
                    value={config.language}
                    onChange={val => handleUpdate('language', val as Language)}
                    options={languageOptions}
                    className="settings-select-fixed"
                />
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.theme')}</label>
                    <div className="settings-description">{t('settings.subtitle')}</div>
                </div>
                <CustomSelect
                    value={config.theme}
                    onChange={val => handleUpdate('theme', val)}
                    options={themeOptions}
                    className="settings-select-fixed"
                />
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.uiFont')}</label>
                    <div className="settings-description">{t('settings.uiFontDesc')}</div>
                </div>
                <CustomSelect
                    value={config.uiFontName}
                    onChange={val => handleUpdate('uiFontName', val)}
                    options={uiFontOptions}
                    className="settings-select-fixed"
                />
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.fontSize')}</label>
                    <div className="settings-description">{t('settings.fontSizeDesc')}</div>
                </div>
                <div className="settings-font-control-group">
                    <button
                        className="btn-font-control btn-font-control-icon"
                        onClick={() => handleUpdate('uiFontSize', Math.max(8, config.uiFontSize - 1))}
                    >
                        <Minus size={12} />
                    </button>
                    <div className="settings-font-display">
                        {config.uiFontSize}
                    </div>
                    <button
                        className="btn-font-control btn-font-control-icon"
                        onClick={() => handleUpdate('uiFontSize', Math.min(24, config.uiFontSize + 1))}
                    >
                        <Plus size={12} />
                    </button>
                </div>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.serverCardSize')}</label>
                </div>
                <CustomSelect
                    value={config.serverCardSize || 'standard'}
                    onChange={val => handleUpdate('serverCardSize', val as 'standard' | 'compact')}
                    options={serverCardSizeOptions}
                    className="settings-select-fixed"
                />
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.sidebarEnabled')}</label>
                    <div className="settings-description">{t('settings.sidebarEnabledDesc')}</div>
                </div>
                <label className="ui-switch">
                    <input
                        type="checkbox"
                        checked={config.sidebarEnabled || false}
                        onChange={e => handleUpdate('sidebarEnabled', e.target.checked)}
                    />
                    <span className="ui-slider"></span>
                </label>
            </div>

            {config.sidebarEnabled && (
                <div className="settings-row">
                    <div className="settings-label-container">
                        <label>{t('settings.sidebarPosition')}</label>
                    </div>
                    <CustomSelect
                        value={config.sidebarPosition || 'left'}
                        onChange={val => handleUpdate('sidebarPosition', val as 'left' | 'right')}
                        options={sidebarPositionOptions}
                        className="settings-select-fixed"
                    />
                </div>
            )}
        </div>
    );
});
