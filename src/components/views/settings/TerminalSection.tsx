import React from 'react';
import { Terminal, Minus, Plus } from 'lucide-react';
import { CustomSelect } from '../../layout/CustomSelect';
import type { AppConfig } from '../../../types';

interface TerminalSectionProps {
    config: AppConfig;
    handleUpdate: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
    terminalFontOptions: { value: string; label: string }[];
    keywordList: { label: string; color: string }[];
    t: (key: string, options?: any) => string;
}

export const TerminalSection: React.FC<TerminalSectionProps> = React.memo(({
    config,
    handleUpdate,
    terminalFontOptions,
    keywordList,
    t
}) => {
    return (
        <div className="settings-group" id="section-terminal">
            <div className="settings-group-title">
                <Terminal size={14} className="settings-group-icon" /> {t('settings.terminal')}
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.terminalFont')}</label>
                    <div className="settings-description">{t('settings.terminalFontDesc')}</div>
                </div>
                <CustomSelect
                    value={config.terminalFontName}
                    onChange={val => handleUpdate('terminalFontName', val)}
                    options={terminalFontOptions}
                    className="settings-select-fixed"
                />
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.terminalFontSize')}</label>
                    <div className="settings-description">{t('settings.terminalFontSizeDesc')}</div>
                </div>
                <div className="settings-font-control-group">
                    <button
                        className="btn-font-control btn-font-control-icon"
                        onClick={() => handleUpdate('terminalFontSize', Math.max(8, config.terminalFontSize - 1))}
                    >
                        <Minus size={12} />
                    </button>
                    <div className="settings-font-display">
                        {config.terminalFontSize}
                    </div>
                    <button
                        className="btn-font-control btn-font-control-icon"
                        onClick={() => handleUpdate('terminalFontSize', Math.min(32, config.terminalFontSize + 1))}
                    >
                        <Plus size={12} />
                    </button>
                </div>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.scrollSensitivity')}</label>
                    <div className="settings-description">{t('settings.scrollSensitivityDesc')}</div>
                </div>
                <div className="settings-font-control-group">
                    <button
                        className="btn-font-control btn-font-control-icon"
                        onClick={() => handleUpdate('terminalScrollSensitivity', Math.max(1, config.terminalScrollSensitivity - 1))}
                    >
                        <Minus size={12} />
                    </button>
                    <div className="settings-font-display">
                        {config.terminalScrollSensitivity}
                    </div>
                    <button
                        className="btn-font-control btn-font-control-icon"
                        onClick={() => handleUpdate('terminalScrollSensitivity', Math.min(10, config.terminalScrollSensitivity + 1))}
                    >
                        <Plus size={12} />
                    </button>
                </div>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('settings.quickCopyPaste')}</label>
                    <div className="settings-description">{t('settings.quickCopyPasteDesc')}</div>
                </div>
                <label className="ui-switch">
                    <input
                        type="checkbox"
                        checked={config.enableTerminalContextMenu || false}
                        onChange={e => handleUpdate('enableTerminalContextMenu', e.target.checked)}
                    />
                    <span className="ui-slider"></span>
                </label>
            </div>

            <div className="settings-row terminal-row-top">
                <div className="settings-label-container">
                    <label>{t('settings.keywordHighlighting')}</label>
                    <div className="settings-description">{t('settings.keywordHighlightingDesc')}</div>

                    <div className="keyword-list-container">
                        {keywordList.map(kw => (
                            <div key={kw.label} className="keyword-item">
                                <span className="keyword-label">{kw.label}</span>
                                <div className="keyword-color-preview" style={{ background: kw.color }} />
                            </div>
                        ))}
                    </div>
                </div>
                <label className="ui-switch">
                    <input
                        type="checkbox"
                        checked={config.keywordHighlighting}
                        onChange={e => handleUpdate('keywordHighlighting', e.target.checked)}
                    />
                    <span className="ui-slider"></span>
                </label>
            </div>
        </div>
    );
});
