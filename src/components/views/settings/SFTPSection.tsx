import React from 'react';
import { Share2 } from 'lucide-react';
import type { AppConfig } from '../../../types';

interface SFTPSectionProps {
    config: AppConfig;
    handleUpdate: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
    t: (key: string, options?: Record<string, string>) => string;
}

export const SFTPSection: React.FC<SFTPSectionProps> = React.memo(({
    config,
    handleUpdate,
    t
}) => {
    return (
        <div className="settings-group" id="section-sftp">
            <div className="settings-group-title">
                <Share2 size={14} className="settings-group-icon" /> SFTP
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('sftp.soundEnabled')}</label>
                </div>
                <label className="ui-switch">
                    <input
                        type="checkbox"
                        checked={config.sftpSoundEnabled ?? true}
                        onChange={e => handleUpdate('sftpSoundEnabled', e.target.checked)}
                    />
                    <span className="ui-slider"></span>
                </label>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('sftp.soundVolume')}</label>
                </div>
                <div className="volume-control-container">
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={config.sftpSoundVolume ?? 0.5}
                        onChange={e => handleUpdate('sftpSoundVolume', parseFloat(e.target.value))}
                        className="volume-slider"
                        style={{
                            background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${(config.sftpSoundVolume ?? 0.5) * 100}%, var(--border) ${(config.sftpSoundVolume ?? 0.5) * 100}%, var(--border) 100%)`
                        }}
                    />
                    <span className="volume-percentage">
                        {Math.round((config.sftpSoundVolume ?? 0.5) * 100)}%
                    </span>
                </div>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('sftp.flashIcon')}</label>
                </div>
                <label className="ui-switch">
                    <input
                        type="checkbox"
                        checked={config.sftpFlashIcon ?? true}
                        onChange={e => handleUpdate('sftpFlashIcon', e.target.checked)}
                    />
                    <span className="ui-slider"></span>
                </label>
            </div>
        </div>
    );
});
