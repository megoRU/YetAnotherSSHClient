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
                    <label style={{ display: 'block', marginBottom: '8px', opacity: 0.7 }}>Тема</label>
                    <select
                        value={config.theme}
                        onChange={e => handleUpdate('theme', e.target.value)}
                        style={{
                            width: '100%',
                            padding: '10px',
                            paddingRight: '30px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: 'rgba(0,0,0,0.03)',
                            color: 'inherit'
                        }}
                    >
                        <option value="Light">Light</option>
                        <option value="Dark">Dark</option>
                        <option value="Gruvbox Light">Gruvbox Light</option>
                    </select>
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '8px', opacity: 0.7 }}>Шрифт интерфейса</label>
                    <select
                        value={config.uiFontName}
                        onChange={e => handleUpdate('uiFontName', e.target.value)}
                        style={{
                            width: '100%',
                            padding: '10px',
                            paddingRight: '30px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: 'rgba(0,0,0,0.03)',
                            color: 'inherit'
                        }}
                    >
                        {systemFonts.map(font => (
                            <option key={font} value={font}>{font}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '8px', opacity: 0.7 }}>Размер шрифта интерфейса</label>
                    <input
                        type="number"
                        value={config.uiFontSize}
                        onChange={e => handleUpdate('uiFontSize', parseInt(e.target.value) || 12)}
                        style={{
                            width: '100%',
                            padding: '10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: 'rgba(0,0,0,0.03)',
                            userSelect: 'text'
                        }}
                    />
                </div>
                <div style={{ marginTop: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={config.enableTerminalContextMenu || false}
                            onChange={e => handleUpdate('enableTerminalContextMenu', e.target.checked)}
                            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                        <span>Включить контекстное меню (Copy/Paste) в терминале</span>
                    </label>
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '8px', opacity: 0.7 }}>Шрифт терминала</label>
                    <select
                        value={config.terminalFontName}
                        onChange={e => handleUpdate('terminalFontName', e.target.value)}
                        style={{
                            width: '100%',
                            padding: '10px',
                            paddingRight: '30px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: 'rgba(0,0,0,0.03)',
                            color: 'inherit'
                        }}
                    >
                        {systemFonts.map(font => (
                            <option key={font} value={font}>{font}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '8px', opacity: 0.7 }}>Размер шрифта терминала</label>
                    <input
                        type="number"
                        value={config.terminalFontSize}
                        onChange={e => handleUpdate('terminalFontSize', parseInt(e.target.value) || 12)}
                        style={{
                            width: '100%',
                            padding: '10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: 'rgba(0,0,0,0.03)',
                            userSelect: 'text'
                        }}
                    />
                </div>
                <div style={{ marginTop: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={config.enableTerminalContextMenu || false}
                            onChange={e => handleUpdate('enableTerminalContextMenu', e.target.checked)}
                            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                        <span>Включить контекстное меню (Copy/Paste) в терминале</span>
                    </label>
                </div>
                <div style={{ marginTop: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={config.allowLegacyAlgorithms || false}
                            onChange={e => handleUpdate('allowLegacyAlgorithms', e.target.checked)}
                            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                        <span>Разрешить старые алгоритмы (diffie-hellman-group1-sha1, 3des-cbc, ssh-rsa)</span>
                    </label>
                    <div style={{ fontSize: '0.85em', opacity: 0.6, marginTop: '5px', marginLeft: '28px' }}>
                        Включите это, если не удается подключиться к старому оборудованию (роутеры, старые сервера).
                    </div>
                </div>
            </div>
        </div>
    );
};
