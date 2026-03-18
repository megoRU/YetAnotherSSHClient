import React, {useState} from 'react';
import {Eye, EyeOff, FileKey, Play, Save, Server} from 'lucide-react';

const {ipcRenderer} = window as any;

interface ConnectionFormProps {
    onConnect: (config: any) => void;
    onSave: (config: any) => void;
    initialConfig?: any;
}

export const ConnectionForm: React.FC<ConnectionFormProps> = ({onConnect, onSave, initialConfig}) => {
    const [config, setConfig] = useState(() => initialConfig || {
        name: '',
        host: '',
        port: '22',
        user: 'root',
        password: '',
        authType: 'password',
        privateKeyPath: '',
        initialCommands: '',
        allowLegacyAlgorithms: false
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const {name, value, type} = e.target as HTMLInputElement;
        const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
        setConfig((prev: any) => ({...prev, [name]: val}));
    };

    const handleSelectKey = async () => {
        const path = await ipcRenderer.invoke('select-key-file');
        if (path) {
            setConfig((prev: any) => ({...prev, privateKeyPath: path}));
        }
    };

    const handleConnect = (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setIsSubmitting(true);
        onConnect(config);
    };

    const handleSave = () => {
        onSave(config);
    };

    return (
        <div style={{padding: '40px', maxWidth: '500px', userSelect: 'none'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '30px'}}>
                <div style={{
                    width: '50px',
                    height: '50px',
                    borderRadius: '12px',
                    background: 'var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <Server size={28}/>
                </div>
                <h2 style={{margin: 0}}>Настройка подключения</h2>
            </div>

            <form onSubmit={handleConnect} style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
                <div>
                    <label style={{display: 'block', marginBottom: '8px', opacity: 0.7}}>Название
                        (необязательно)</label>
                    <input
                        name="name"
                        value={config.name}
                        onChange={handleChange}
                        placeholder="Название сервера"
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

                <div style={{display: 'flex', gap: '15px'}}>
                    <div style={{flex: 1, minWidth: 0}}>
                        <label style={{display: 'block', marginBottom: '8px', opacity: 0.7}}>Хост</label>
                        <input
                            name="host"
                            required
                            value={config.host}
                            onChange={handleChange}
                            placeholder="127.0.0.1"
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
                    <div style={{width: '100px', flexShrink: 0}}>
                        <label style={{display: 'block', marginBottom: '8px', opacity: 0.7}}>Порт</label>
                        <input
                            name="port"
                            required
                            value={config.port}
                            onChange={handleChange}
                            placeholder="22"
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
                </div>

                <div>
                    <label style={{display: 'block', marginBottom: '8px', opacity: 0.7}}>Пользователь</label>
                    <input
                        name="user"
                        required
                        value={config.user}
                        onChange={handleChange}
                        placeholder="root"
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

                <div>
                    <label style={{display: 'block', marginBottom: '8px', opacity: 0.7}}>Команды при подключении (по одной на строку)</label>
                    <textarea
                        name="initialCommands"
                        value={config.initialCommands}
                        onChange={handleChange}
                        placeholder="cd /var/www/html&#10;ls -la"
                        rows={3}
                        style={{
                            width: '100%',
                            padding: '10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--input-bg)',
                            color: 'var(--text-color)',
                            userSelect: 'text',
                            fontFamily: 'inherit',
                            resize: 'vertical'
                        }}
                    />
                </div>

                <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                    <input
                        type="checkbox"
                        name="allowLegacyAlgorithms"
                        id="allowLegacyAlgorithms"
                        checked={config.allowLegacyAlgorithms || false}
                        onChange={handleChange}
                        style={{width: '18px', height: '18px', cursor: 'pointer'}}
                    />
                    <label htmlFor="allowLegacyAlgorithms" style={{cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9em'}}>
                        Разрешить старые алгоритмы (для роутеров)
                    </label>
                </div>

                <div>
                    <label style={{display: 'block', marginBottom: '8px', opacity: 0.7}}>Способ аутентификации</label>
                    <select
                        name="authType"
                        value={config.authType || 'password'}
                        onChange={handleChange}
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
                        <option value="password">Пароль</option>
                        <option value="key">SSH Ключ</option>
                    </select>
                </div>

                {config.authType === 'key' ? (
                    <div>
                        <label style={{display: 'block', marginBottom: '8px', opacity: 0.7}}>Путь к приватному
                            ключу</label>
                        <div style={{display: 'flex', gap: '10px'}}>
                            <input
                                name="privateKeyPath"
                                value={config.privateKeyPath}
                                onChange={handleChange}
                                placeholder="/path/to/id_rsa"
                                style={{
                                    flex: 1,
                                    padding: '10px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-color)',
                                    background: 'rgba(0,0,0,0.03)',
                                    userSelect: 'text'
                                }}
                            />
                            <button
                                type="button"
                                onClick={handleSelectKey}
                                className="btn-secondary"
                                style={{
                                    padding: '0 15px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '5px'
                                }}
                            >
                                <FileKey size={16}/> Обзор
                            </button>
                        </div>
                    </div>
                ) : (
                    <div>
                        <label style={{display: 'block', marginBottom: '8px', opacity: 0.7}}>Пароль</label>
                        <div style={{position: 'relative'}}>
                            <input
                                name="password"
                                type={showPassword ? 'text' : 'password'}
                                value={config.password}
                                onChange={handleChange}
                                placeholder="••••••••"
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    paddingRight: '40px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-color)',
                                    background: 'rgba(0,0,0,0.03)',
                                    userSelect: 'text'
                                }}
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
                                {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
                            </div>
                        </div>
                    </div>
                )}

                <div style={{display: 'flex', gap: '15px', marginTop: '10px'}}>
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="btn-primary"
                        style={{
                            flex: 1,
                            padding: '12px',
                            borderRadius: '8px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px'
                        }}
                    >
                        <Play size={18}/> Подключиться
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        className="btn-secondary"
                        style={{
                            padding: '12px 20px',
                            borderRadius: '8px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px'
                        }}
                    >
                        <Save size={18}/> {initialConfig ? 'Обновить' : 'Сохранить'}
                    </button>
                </div>
            </form>
        </div>
    );
};
