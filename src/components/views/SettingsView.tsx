import React, { useState } from 'react';
import { Settings, Monitor, Terminal, Keyboard, Info, RefreshCw, Download, UploadCloud, Database } from 'lucide-react';
import type { AppConfig, NotificationType } from '../../types';
import { VERSION } from '../../types';
import { CustomSelect } from '../layout/CustomSelect';
import { useUpdateChecker } from '../../hooks/useUpdateChecker';

const { ipcRenderer } = window;

interface SettingsViewProps {
    config: AppConfig;
    setConfig: (config: AppConfig) => void;
    systemFonts: string[];
    showNotification: (title: string, message: string, type?: NotificationType, action?: { label: string, onClick: () => void }) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ config, setConfig, systemFonts, showNotification }) => {
    const { updateInfo, status, progress, error: updateError, startDownload, quitAndInstall } = useUpdateChecker();
    const [isChecking, setIsChecking] = useState(false);
    const [manualCheckResult, setManualCheckResult] = useState<{ available: boolean, version?: string, url?: string, error?: string } | null>(null);

    const handleUpdate = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
        setConfig({ ...config, [key]: value });
    };

    const handleCheckUpdates = async () => {
        setIsChecking(true);
        setManualCheckResult(null);
        try {
            const result = await ipcRenderer.invoke('check-updates') as { available: boolean, version?: string, url?: string, error?: string };
            if (result.available) {
                setManualCheckResult(result);
            } else if (result.error) {
                setManualCheckResult({ available: false, error: result.error });
            } else {
                setManualCheckResult({ available: false });
            }
        } catch {
            setManualCheckResult({ available: false, error: 'Ошибка при проверке' });
        } finally {
            setIsChecking(false);
        }
    };

    const handleExport = async () => {
        try {
            const result = await ipcRenderer.invoke('export-config');
            if (result) {
                showNotification('Экспорт', 'Настройки успешно экспортированы', 'success');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            showNotification('Ошибка экспорта', message, 'error');
        }
    };

    const handleImport = async () => {
        try {
            const newConfig = await ipcRenderer.invoke('import-config') as AppConfig | null;
            if (newConfig) {
                setConfig(newConfig);
                showNotification(
                    'Импорт',
                    'Настройки успешно импортированы. Для корректного применения всех параметров рекомендуется перезапустить приложение.',
                    'success',
                    {
                        label: 'Выйти из приложения',
                        onClick: () => ipcRenderer.send('window-close')
                    }
                );
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            showNotification('Ошибка импорта', message, 'error');
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
                        background: 'var(--primary-color)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                    }}>
                        <Settings size={28} />
                    </div>
                    <div>
                        <h2 style={{ margin: 0 }}>Настройки</h2>
                        <div style={{ opacity: 0.7, fontSize: '1em' }}>Управление внешним видом и поведением</div>
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
                        <CustomSelect
                            value={config.theme}
                            onChange={val => handleUpdate('theme', val)}
                            options={[
                                { value: 'Light', label: 'Светлая' },
                                { value: 'Dark', label: 'Темная' },
                                { value: 'Gruvbox Light', label: 'Gruvbox Light' }
                            ]}
                            style={{ width: '200px' }}
                        />
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>Шрифт интерфейса</label>
                            <div className="settings-description">Основной шрифт для меню и вкладок</div>
                        </div>
                        <CustomSelect
                            value={config.uiFontName}
                            onChange={val => handleUpdate('uiFontName', val)}
                            options={systemFonts
                                .filter(font => ['Inter', 'JetBrains Mono', 'Fira Mono'].includes(font))
                                .map(font => ({ value: font, label: font }))}
                            style={{ width: '200px' }}
                        />
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
                        <CustomSelect
                            value={config.terminalFontName}
                            onChange={val => handleUpdate('terminalFontName', val)}
                            options={systemFonts.map(font => ({ value: font, label: font }))}
                            style={{ width: '200px' }}
                        />
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
                            <label>Чувствительность прокрутки</label>
                            <div className="settings-description">Скорость прокрутки текста в терминале (2 — стандартная)</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <button className="btn-secondary" style={{ padding: '5px 12px', borderRadius: '6px' }} onClick={() => handleUpdate('terminalScrollSensitivity', Math.max(1, config.terminalScrollSensitivity - 1))}>-</button>
                            <span style={{ minWidth: '30px', textAlign: 'center', fontWeight: 'bold' }}>{config.terminalScrollSensitivity}</span>
                            <button className="btn-secondary" style={{ padding: '5px 12px', borderRadius: '6px' }} onClick={() => handleUpdate('terminalScrollSensitivity', Math.min(10, config.terminalScrollSensitivity + 1))}>+</button>
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>Быстрый Copy/Paste</label>
                            <div className="settings-description">Копирование при выделении и вставка правой кнопкой мыши</div>
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

                {/* Резервное копирование */}
                <div className="settings-group">
                    <div className="settings-group-title">
                        <Database size={14} style={{ marginRight: '8px' }} /> Резервное копирование
                    </div>
                    <div className="settings-description" style={{ marginBottom: '15px' }}>
                        Вы можете сохранить все ваши настройки и список серверов в файл или восстановить их из резервной копии.
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button className="btn-secondary" onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}>
                            <Download size={16} /> Экспортировать в файл
                        </button>
                        <button className="btn-secondary" onClick={handleImport} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}>
                            <UploadCloud size={16} /> Импортировать из файла
                        </button>
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
                        <div style={{ opacity: 0.8, display: 'flex', alignItems: 'center', gap: '10px' }}>
                            Версия: {VERSION}
                            <button
                                onClick={handleCheckUpdates}
                                disabled={isChecking}
                                className="btn-secondary"
                                style={{
                                    padding: '2px 8px',
                                    fontSize: '0.9em',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                    borderRadius: '6px'
                                }}
                            >
                                <RefreshCw size={12} className={isChecking ? 'spin' : ''} />
                                {isChecking ? 'Проверка...' : 'Проверить обновление'}
                            </button>
                            {(manualCheckResult || status !== 'idle') && (
                                <span style={{ fontSize: '1em', opacity: 1, display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    {status === 'available' && updateInfo ? (
                                        <button
                                            onClick={startDownload}
                                            className="btn-primary"
                                            style={{ padding: '2px 10px', fontSize: '0.9em', borderRadius: '6px' }}
                                        >
                                            Скачать v{updateInfo.version}
                                        </button>
                                    ) : status === 'downloading' && progress ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div style={{ width: '100px', height: '6px', background: 'rgba(200, 30, 81, 0.2)', borderRadius: '3px', overflow: 'hidden' }}>
                                                <div style={{ width: `${progress.percent}%`, height: '100%', background: 'var(--primary-color)' }} />
                                            </div>
                                            <span>{Math.round(progress.percent)}%</span>
                                        </div>
                                    ) : status === 'downloaded' ? (
                                        <button
                                            onClick={quitAndInstall}
                                            className="btn-primary"
                                            style={{ padding: '2px 10px', fontSize: '0.9em', borderRadius: '6px', background: '#28a745' }}
                                        >
                                            Установить и перезапустить
                                        </button>
                                    ) : status === 'error' ? (
                                        <span style={{ color: '#ff4d4d' }}>Ошибка: {updateError || 'Не удалось загрузить'}</span>
                                    ) : manualCheckResult ? (
                                        manualCheckResult.available ? (
                                            <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>Доступно v{manualCheckResult.version} (см. панель выше)</span>
                                        ) : (
                                            manualCheckResult.error ? `Ошибка: ${manualCheckResult.error}` : 'Обновлений нет'
                                        )
                                    ) : null}
                                </span>
                            )}
                        </div>
                            <div style={{ marginTop: '10px', display: 'flex', gap: '15px' }}>
                                <a href="#" onClick={(e) => {
                                    e.preventDefault();
                                    ipcRenderer.send('open-external', 'https://github.com/megoRU/YetAnotherSSHClient');
                                }} style={{ color: 'var(--primary-color)', textDecoration: 'none', fontWeight: 'bold' }}>GitHub</a>
                                <a href="#" onClick={(e) => {
                                    e.preventDefault();
                                    ipcRenderer.send('open-external', 'https://github.com/megoRU/YetAnotherSSHClient/blob/main/LICENSE');
                                }} style={{ color: 'var(--primary-color)', textDecoration: 'none', fontWeight: 'bold' }}>Лицензия</a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
