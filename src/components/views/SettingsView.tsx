import React from 'react';
import { Settings } from 'lucide-react';
import type { AppConfig } from '../../types';

interface SettingsViewProps {
    config: AppConfig;
    setConfig: (config: AppConfig) => void;
    systemFonts: string[];
}

export const SettingsView: React.FC<SettingsViewProps> = ({ config, setConfig, systemFonts }) => {
    const handleUpdate = (key: keyof AppConfig, value: any) => {
        setConfig({ ...config, [key]: value });
    };

    return (
        <div style={{ padding: '40px', maxWidth: '600px', userSelect: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '30px' }}>
                <div style={{
                    width: '50px',
                    height: '50px',
                    borderRadius: '12px',
                    background: 'var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <Settings size={28} />
                </div>
                <h2 style={{ margin: 0 }}>Настройки</h2>
            </div>

            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '15px'
            }}>
                <div>
                    <label style={{ display: 'block', marginBottom: '5px' }}>Тема:</label>
                    <select
                        value={config.theme}
                        onChange={e => handleUpdate('theme', e.target.value)}
                        style={{ width: '100%', padding: '8px' }}
                    >
                        <option value="Light">Light</option>
                        <option value="Dark">Dark</option>
                        <option value="Gruvbox Light">Gruvbox Light</option>
                    </select>
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '5px' }}>Шрифт интерфейса:</label>
                    <select
                        value={config.uiFontName}
                        onChange={e => handleUpdate('uiFontName', e.target.value)}
                        style={{ width: '100%', padding: '8px' }}
                    >
                        {systemFonts.map(font => (
                            <option key={font} value={font}>{font}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '5px' }}>Размер шрифта интерфейса:</label>
                    <input
                        type="number"
                        value={config.uiFontSize}
                        onChange={e => handleUpdate('uiFontSize', parseInt(e.target.value) || 12)}
                        style={{ width: '100%', padding: '8px', userSelect: 'text' }}
                    />
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '5px' }}>Шрифт терминала:</label>
                    <select
                        value={config.terminalFontName}
                        onChange={e => handleUpdate('terminalFontName', e.target.value)}
                        style={{ width: '100%', padding: '8px' }}
                    >
                        {systemFonts.map(font => (
                            <option key={font} value={font}>{font}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '5px' }}>Размер шрифта терминала:</label>
                    <input
                        type="number"
                        value={config.terminalFontSize}
                        onChange={e => handleUpdate('terminalFontSize', parseInt(e.target.value) || 12)}
                        style={{ width: '100%', padding: '8px', userSelect: 'text' }}
                    />
                </div>
            </div>
        </div>
    );
};
