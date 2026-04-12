import React, { useState } from 'react';
import { Eye, EyeOff, FileKey, Play, Server } from 'lucide-react';
import type { SSHConfig } from '../types';

const { ipcRenderer } = window as any;

interface ConnectionFormProps {
    onConnect: (config: SSHConfig, shouldSave: boolean) => void;
    initialConfig?: SSHConfig;
}

export const ConnectionForm: React.FC<ConnectionFormProps> = ({ onConnect, initialConfig }) => {
    const [config, setConfig] = useState<SSHConfig>(() => initialConfig || {
        name: '',
        host: '',
        port: 22,
        user: 'root',
        password: '',
        authType: 'password',
        privateKeyPath: '',
        initialCommands: ''
    });
    const [saveToFavorites, setSaveToFavorites] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showInitialCommands, setShowInitialCommands] = useState(!!config.initialCommands);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setConfig((prev: any) => ({ ...prev, [name]: name === 'port' ? parseInt(value) || 0 : value }));
    };

    const handleSelectKey = async () => {
        const path = await ipcRenderer.invoke('select-key-file');
        if (path) {
            setConfig((prev: any) => ({ ...prev, privateKeyPath: path }));
        }
    };

    const handleConnect = (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setIsSubmitting(true);
        onConnect(config, saveToFavorites);
    };

    return (
        <div style={{
            userSelect: 'none',
            height: '100%',
            overflowY: 'auto'
        }}>
            <div style={{
                padding: '40px',
                maxWidth: '600px',
                margin: '0 auto'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '20px' }}>
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
                        <Server size={28} />
                    </div>
                    <div>
                        <h2 style={{ margin: 0 }}>Настройка подключения</h2>
                        <div style={{ opacity: 0.5, fontSize: '0.9em' }}>Укажите параметры доступа к удаленному серверу</div>
                    </div>
                </div>

                <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div className="settings-group" style={{ marginBottom: 0, padding: '15px' }}>
                        <div className="settings-group-title" style={{ marginBottom: '10px' }}>Основные настройки</div>

                        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px', padding: '8px 0' }}>
                            <label>Название (необязательно)</label>
                            <input
                                name="name"
                                value={config.name}
                                onChange={handleChange}
                                placeholder="Мой сервер"
                                style={{ width: '100%', padding: '10px' }}
                            />
                        </div>

                        <div className="settings-row" style={{ gap: '15px', padding: '8px 0' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '4px' }}>Хост</label>
                                <input
                                    name="host"
                                    required
                                    value={config.host}
                                    onChange={handleChange}
                                    placeholder="127.0.0.1"
                                    style={{ width: '100%', padding: '8px' }}
                                />
                            </div>
                            <div style={{ width: '100px' }}>
                                <label style={{ display: 'block', marginBottom: '4px' }}>Порт</label>
                                <input
                                    name="port"
                                    type="number"
                                    required
                                    value={config.port}
                                    onChange={handleChange}
                                    placeholder="22"
                                    style={{ width: '100%', padding: '8px' }}
                                />
                            </div>
                        </div>

                        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px', padding: '8px 0' }}>
                            <label>Пользователь</label>
                            <input
                                name="user"
                                required
                                value={config.user}
                                onChange={handleChange}
                                placeholder="root"
                                style={{ width: '100%', padding: '10px' }}
                            />
                        </div>
                    </div>

                    <div className="settings-group" style={{ marginBottom: 0, padding: '15px' }}>
                        <div className="settings-group-title" style={{ marginBottom: '10px' }}>Аутентификация</div>

                        <div className="settings-row" style={{ padding: '8px 0' }}>
                            <div className="settings-label-container">
                                <label>Способ входа</label>
                                <div className="settings-description">Выберите пароль или SSH-ключ</div>
                            </div>
                            <select
                                name="authType"
                                value={config.authType || 'password'}
                                onChange={handleChange}
                                style={{
                                    width: '180px',
                                    padding: '8px',
                                    backgroundColor: 'rgba(0,0,0,0.03)'
                                }}
                            >
                                <option value="password">Пароль</option>
                                <option value="key">SSH Ключ</option>
                            </select>
                        </div>

                        {config.authType === 'key' ? (
                            <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px', padding: '8px 0' }}>
                                <label>Приватный ключ</label>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <input
                                        name="privateKeyPath"
                                        value={config.privateKeyPath}
                                        onChange={handleChange}
                                        placeholder="/path/to/id_rsa"
                                        style={{ flex: 1, padding: '8px' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleSelectKey}
                                        className="btn-secondary"
                                        style={{ padding: '0 15px', borderRadius: '6px' }}
                                    >
                                        <FileKey size={16} />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px', padding: '8px 0' }}>
                                <label>Пароль</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        name="password"
                                        type={showPassword ? 'text' : 'password'}
                                        value={config.password}
                                        onChange={handleChange}
                                        placeholder="••••••••"
                                        style={{ width: '100%', padding: '8px', paddingRight: '40px' }}
                                    />
                                    <div
                                        onClick={() => setShowPassword(!showPassword)}
                                        style={{
                                            position: 'absolute',
                                            right: '10px',
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            opacity: 0.5
                                        }}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="settings-group" style={{ marginBottom: 0, padding: '15px' }}>
                        <div className="settings-group-title" style={{ marginBottom: '10px' }}>Дополнительно</div>

                        <div className="settings-row" style={{ padding: '8px 0' }}>
                            <div className="settings-label-container">
                                <label>Команды при подключении</label>
                                <div className="settings-description">Выполнить скрипт сразу после входа</div>
                            </div>
                            <label className="switch">
                                <input
                                    type="checkbox"
                                    checked={showInitialCommands}
                                    onChange={e => setShowInitialCommands(e.target.checked)}
                                />
                                <span className="slider"></span>
                            </label>
                        </div>

                        {showInitialCommands && (
                            <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                                <textarea
                                    name="initialCommands"
                                    value={config.initialCommands}
                                    onChange={handleChange}
                                    placeholder="cd /var/www&#10;ls -la"
                                    rows={3}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        borderRadius: '8px',
                                        background: 'var(--input-bg)',
                                        color: 'var(--text-color)',
                                        fontFamily: 'monospace'
                                    }}
                                />
                            </div>
                        )}

                        <div className="settings-row" style={{ padding: '8px 0' }}>
                            <div className="settings-label-container">
                                <label>Сохранить в избранное</label>
                                <div className="settings-description">Добавить сервер в список на главной</div>
                            </div>
                            <label className="switch">
                                <input
                                    type="checkbox"
                                    checked={saveToFavorites}
                                    onChange={e => setSaveToFavorites(e.target.checked)}
                                />
                                <span className="slider"></span>
                            </label>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="btn-primary"
                            style={{
                                flex: 1,
                                padding: '14px',
                                fontSize: '1.1em',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '10px'
                            }}
                        >
                            <Play size={20} /> Подключиться
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
