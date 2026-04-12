import React, { useState } from 'react';
import { Settings, Monitor, Terminal, Keyboard, Info, RefreshCw } from 'lucide-react';
import type { AppConfig } from '../../types';
import { VERSION } from '../../types';

const { ipcRenderer } = window as any;

interface SettingsViewProps {
    config: AppConfig;
    setConfig: (config: AppConfig) => void;
    systemFonts: string[];
}

export const SettingsView: React.FC<SettingsViewProps> = ({ config, setConfig, systemFonts }) => {
    const [isChecking, setIsChecking] = useState(false);
    const [checkStatus, setCheckStatus] = useState<string | null>(null);

    const handleUpdate = (key: keyof AppConfig, value: any) => {
        setConfig({ ...config, [key]: value });
    };

    const handleCheckUpdates = async () => {
        setIsChecking(true);
        setCheckStatus(null);
        try {
            await ipcRenderer.invoke('check-updates');
            // Если обновление есть, TitleBar его покажет сам через IPC
            // Подождем немного и выведем сообщение если ничего не прилетело
            setTimeout(() => {
                setCheckStatus('Проверка завершена');
                setIsChecking(false);
            }, 2000);
        } catch {
            setCheckStatus('Ошибка при проверке');
            setIsChecking(false);
        }
    };

    const isMac = ipcRenderer.platform === 'darwin';
    const isLinux = ipcRenderer.platform === 'linux';
    const isWindows = ipcRenderer.platform === 'win32';

    const getShortcuts = () => {
        const list = [
            { label: 'Поиск по истории (в терминале)', key: 'Ctrl + R' },
            { label: 'Перезагрузка приложения', key: 'Ctrl + R / F5' },
        ];

        if (isMac) {
            list.push({ label: 'Копировать (в терминале)', key: 'Cmd + C' });
            list.push({ label: 'Вставить (в терминале)', key: 'Cmd + V' });
        } else if (isLinux || isWindows) {
            list.push({ label: 'Копировать (в терминале)', key: 'Ctrl + Shift + C' });
            list.push({ label: 'Вставить (в терминале)', key: 'Ctrl + Shift + V' });
        }

        return list;
    };

    const shortcuts = getShortcuts();

    return (
        <div style={{
            userSelect: 'none',
            height: '100%',
            overflowY: 'auto'
        }}>
            <div style={{
                padding: '40px',
                maxWidth: '800px',
                margin: '0 auto'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '40px' }}>
                    <div style={{
                        width: '50px',
                        height: '50px',
                        borderRadius: '12px',
                        background: '#c81e51',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 4px 12px rgba(200, 30, 81, 0.3)'
                    }}>
                        <Settings size={28} />
                    </div>
                    <div>
                        <h2 style={{ margin: 0 }}>Настройки</h2>
                        <div style={{ opacity: 0.5, fontSize: '0.9em' }}>Управление внешним видом и поведением</div>
                    </div>
                </div>

                {/* Интерфейс */}
                <div className="settings-group">
                    <div className="settings-group-title">
                        <Monitor size={14} style={{ marginRight: '8px' }} /> Интерфейс
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>Тема оформления</label>
                            <div className="settings-description">Выберите цветовую схему приложения</div>
                        </div>
                        <select
                            value={config.theme}
                            onChange={e => handleUpdate('theme', e.target.value)}
                            style={{ width: '200px', padding: '8px' }}
                        >
                            <option value="Light">Светлая</option>
                            <option value="Dark">Темная</option>
                            <option value="Gruvbox Light">Gruvbox Light</option>
                        </select>
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>Шрифт интерфейса</label>
                            <div className="settings-description">Основной шрифт для меню и вкладок</div>
                        </div>
                        <select
                            value={config.uiFontName}
                            onChange={e => handleUpdate('uiFontName', e.target.value)}
                            style={{ width: '200px', padding: '8px' }}
                        >
                            {systemFonts.map(font => (
                                <option key={font} value={font}>{font}</option>
                            ))}
                        </select>
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>Размер шрифта</label>
                            <div className="settings-description">Масштаб элементов управления</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <button className="btn-secondary" style={{ padding: '5px 12px', borderRadius: '6px' }} onClick={() => handleUpdate('uiFontSize', Math.max(8, config.uiFontSize - 1))}>-</button>
                            <span style={{ minWidth: '30px', textAlign: 'center', fontWeight: 'bold' }}>{config.uiFontSize}</span>
                            <button className="btn-secondary" style={{ padding: '5px 12px', borderRadius: '6px' }} onClick={() => handleUpdate('uiFontSize', Math.min(24, config.uiFontSize + 1))}>+</button>
                        </div>
                    </div>
                </div>

                {/* Терминал */}
                <div className="settings-group">
                    <div className="settings-group-title">
                        <Terminal size={14} style={{ marginRight: '8px' }} /> Терминал
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>Шрифт терминала</label>
                            <div className="settings-description">Моноширинный шрифт для командной строки</div>
                        </div>
                        <select
                            value={config.terminalFontName}
                            onChange={e => handleUpdate('terminalFontName', e.target.value)}
                            style={{ width: '200px', padding: '8px' }}
                        >
                            {systemFonts.map(font => (
                                <option key={font} value={font}>{font}</option>
                            ))}
                        </select>
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>Размер шрифта терминала</label>
                            <div className="settings-description">Размер текста в сессиях SSH</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <button className="btn-secondary" style={{ padding: '5px 12px', borderRadius: '6px' }} onClick={() => handleUpdate('terminalFontSize', Math.max(8, config.terminalFontSize - 1))}>-</button>
                            <span style={{ minWidth: '30px', textAlign: 'center', fontWeight: 'bold' }}>{config.terminalFontSize}</span>
                            <button className="btn-secondary" style={{ padding: '5px 12px', borderRadius: '6px' }} onClick={() => handleUpdate('terminalFontSize', Math.min(32, config.terminalFontSize + 1))}>+</button>
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>Быстрый Copy/Paste</label>
                            <div className="settings-description">Копирование при выделении и вставка правой кнопкой мыши</div>
                        </div>
                        <label className="switch">
                            <input
                                type="checkbox"
                                checked={config.enableTerminalContextMenu || false}
                                onChange={e => handleUpdate('enableTerminalContextMenu', e.target.checked)}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>
                </div>

                {/* Горячие клавиши */}
                <div className="settings-group">
                    <div className="settings-group-title">
                        <Keyboard size={14} style={{ marginRight: '8px' }} /> Горячие клавиши
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        {shortcuts.map((s, i) => (
                            <div key={i} className="shortcut-item">
                                <span style={{ opacity: 0.8 }}>{s.label}</span>
                                <span className="shortcut-key">{s.key}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* О программе */}
                <div className="settings-group">
                    <div className="settings-group-title">
                        <Info size={14} style={{ marginRight: '8px' }} /> О программе
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <img src="./icons/icon256.png" style={{ width: '64px', height: '64px' }} alt="Logo" />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '1.2em', fontWeight: 'bold' }}>YetAnotherSSHClient</div>
                        <div style={{ opacity: 0.6, display: 'flex', alignItems: 'center', gap: '10px' }}>
                            Версия: {VERSION}
                            <button
                                onClick={handleCheckUpdates}
                                disabled={isChecking}
                                className="btn-secondary"
                                style={{
                                    padding: '2px 8px',
                                    fontSize: '0.8em',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                    borderRadius: '6px'
                                }}
                            >
                                <RefreshCw size={12} className={isChecking ? 'spin' : ''} />
                                {isChecking ? 'Проверка...' : 'Проверить обновление'}
                            </button>
                            {checkStatus && <span style={{ fontSize: '0.9em', opacity: 0.8 }}>{checkStatus}</span>}
                        </div>
                            <div style={{ marginTop: '10px', display: 'flex', gap: '15px' }}>
                                <a href="#" onClick={(e) => {
                                    e.preventDefault();
                                    ipcRenderer.send('open-external', 'https://github.com/megoRU/YetAnotherSSHClient');
                                }} style={{ color: '#c81e51', textDecoration: 'none', fontWeight: 'bold' }}>GitHub</a>
                                <a href="#" onClick={(e) => {
                                    e.preventDefault();
                                    ipcRenderer.send('open-external', 'https://github.com/megoRU/YetAnotherSSHClient/blob/main/LICENSE');
                                }} style={{ color: '#c81e51', textDecoration: 'none', fontWeight: 'bold' }}>Лицензия</a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
