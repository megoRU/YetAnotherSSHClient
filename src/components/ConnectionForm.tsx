import React, { useState } from 'react';
import { Eye, EyeOff, FileKey, Play, Server, Save } from 'lucide-react';
import type { SSHConfig, AppConfig } from '../types';
import { CustomSelect } from './layout/CustomSelect';
import { useI18n } from '../utils/i18n';

const { ipcRenderer } = window;

interface ConnectionFormProps {
    onConnect: (config: SSHConfig, shouldSave: boolean) => void;
    initialConfig?: SSHConfig;
    appConfig?: AppConfig;
    onClose?: () => void;
}

export const ConnectionForm: React.FC<ConnectionFormProps> = ({ onConnect, initialConfig, appConfig, onClose }) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    const formRef = React.useRef<HTMLFormElement>(null);
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

    const isEditMode = !!initialConfig?.id;
    const isHostValid = !!config.host.trim();

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setConfig((prev: SSHConfig) => ({
            ...prev,
            [name]: name === 'port' ? (parseInt(value) || 0) : value
        }));
    };

    const handleSelectKey = async () => {
        const path = await ipcRenderer?.selectKeyFile?.();
        if (path && typeof path === 'string') {
            setConfig((prev: SSHConfig) => ({ ...prev, privateKeyPath: path }));
        }
    };

    const handleConnect = (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting || !isHostValid) return;
        setIsSubmitting(true);
        onConnect(config, saveToFavorites);
    };

    const handleSaveOnly = (e: React.MouseEvent) => {
        e.preventDefault();
        if (formRef.current && !formRef.current.reportValidity()) {
            return;
        }
        onConnect(config, true);
        if (onClose) onClose();
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
                        background: 'var(--accent)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                    }}>
                        <Server size={28} />
                    </div>
                    <div>
                        <h2 style={{ margin: 0 }}>{t('connection.title')}</h2>
                        <div style={{ opacity: 0.7, fontSize: '1em' }}>{t('connection.subtitle')}</div>
                    </div>
                </div>

                <form ref={formRef} onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div className="settings-group" style={{ marginBottom: 0, padding: '15px' }}>
                        <div className="settings-group-title" style={{ marginBottom: '10px' }}>{t('connection.general')}</div>

                        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px', padding: '8px 0' }}>
                            <label>{t('connection.name')}</label>
                            <input
                                name="name"
                                value={config.name}
                                onChange={handleChange}
                                placeholder={t('connection.namePlaceholder')}
                                style={{ width: '100%', padding: '10px' }}
                            />
                        </div>

                        {/* Single horizontal row for Host, Port, and User */}
                        <div className="settings-row" style={{ gap: '10px', padding: '8px 0', flexWrap: 'wrap' }}>
                            <div style={{ flex: '3 1 180px' }}>
                                <label style={{ display: 'block', marginBottom: '4px' }}>{t('connection.host')}</label>
                                <input
                                    name="host"
                                    required
                                    value={config.host}
                                    onChange={handleChange}
                                    placeholder="example.com"
                                    style={{ width: '100%', padding: '8px' }}
                                />
                            </div>
                            <div style={{ flex: '1 1 80px', minWidth: '70px' }}>
                                <label style={{ display: 'block', marginBottom: '4px' }}>{t('connection.port')}</label>
                                <input
                                    name="port"
                                    type="number"
                                    required
                                    value={config.port || ''}
                                    onChange={handleChange}
                                    placeholder="22"
                                    style={{ width: '100%', padding: '8px' }}
                                />
                            </div>
                            <div style={{ flex: '2 1 120px' }}>
                                <label style={{ display: 'block', marginBottom: '4px' }}>{t('connection.user')}</label>
                                <input
                                    name="user"
                                    required
                                    value={config.user}
                                    onChange={handleChange}
                                    placeholder="root"
                                    style={{ width: '100%', padding: '8px' }}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="settings-group" style={{ marginBottom: 0, padding: '15px' }}>
                        <div className="settings-group-title" style={{ marginBottom: '10px' }}>{t('connection.auth')}</div>

                        <div className="settings-row" style={{ padding: '8px 0' }}>
                            <div className="settings-label-container">
                                <label>{t('connection.authType')}</label>
                            </div>
                            <CustomSelect
                                value={config.authType || 'password'}
                                onChange={val => setConfig(prev => ({ ...prev, authType: val as 'password' | 'key' }))}
                                options={[
                                    { value: 'password', label: t('connection.password') },
                                    { value: 'key', label: t('connection.sshKey') }
                                ]}
                                style={{
                                    width: '180px'
                                }}
                            />
                        </div>

                        {config.authType === 'key' ? (
                            <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px', padding: '8px 0' }}>
                                <label>{t('connection.privateKey')}</label>
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
                                <label>{t('connection.password')}</label>
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
                        <div className="settings-group-title" style={{ marginBottom: '10px' }}>{t('connection.advanced')}</div>

                        <div className="settings-row" style={{ padding: '8px 0' }}>
                            <div className="settings-label-container">
                                <label>{t('connection.initialCommands')}</label>
                                <div className="settings-description">{t('connection.initialCommandsDesc')}</div>
                            </div>
                            <label className="ui-switch">
                                <input
                                    type="checkbox"
                                    checked={showInitialCommands}
                                    onChange={e => setShowInitialCommands(e.target.checked)}
                                />
                                <span className="ui-slider"></span>
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
                                        padding: '10px'
                                    }}
                                />
                            </div>
                        )}

                        <div className="settings-row" style={{ padding: '8px 0' }}>
                            <div className="settings-label-container">
                                <label>{t('connection.saveToFavorites')}</label>
                                <div className="settings-description">{t('connection.saveToFavoritesDesc')}</div>
                            </div>
                            <label className="ui-switch">
                                <input
                                    type="checkbox"
                                    checked={saveToFavorites}
                                    onChange={e => setSaveToFavorites(e.target.checked)}
                                />
                                <span className="ui-slider"></span>
                            </label>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
                        {isEditMode && (
                            <button
                                type="button"
                                onClick={handleSaveOnly}
                                className="btn-secondary"
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
                                <Save size={20} /> {t('common.save')}
                            </button>
                        )}
                        <button
                            type="submit"
                            disabled={isSubmitting || !isHostValid}
                            className="btn-primary"
                            style={{
                                flex: 1,
                                padding: '14px',
                                fontSize: '1.1em',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '10px',
                                opacity: (!isHostValid || isSubmitting) ? 0.5 : 1,
                                cursor: (!isHostValid || isSubmitting) ? 'not-allowed' : 'pointer'
                            }}
                        >
                            <Play size={20} /> {t('connection.connect')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
