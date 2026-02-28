import React, { useState } from 'react';
import { Server, Save, Play } from 'lucide-react';

interface ConnectionFormProps {
  onConnect: (config: any) => void;
  onSave: (config: any) => void;
  initialConfig?: any;
}

export const ConnectionForm: React.FC<ConnectionFormProps> = ({ onConnect, onSave, initialConfig }) => {
  const [config, setConfig] = useState(() => initialConfig || {
    name: '',
    host: '',
    port: '22',
    user: 'root',
    password: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setConfig((prev: any) => ({ ...prev, [name]: value }));
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
    <div style={{ padding: '40px', maxWidth: '500px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '30px' }}>
        <div style={{ width: '50px', height: '50px', borderRadius: '12px', background: 'var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Server size={28} />
        </div>
        <h2 style={{ margin: 0 }}>Настройка подключения</h2>
      </div>

      <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '8px', opacity: 0.7 }}>Название (необязательно)</label>
          <input
            name="name"
            value={config.name}
            onChange={handleChange}
            placeholder="Название сервера"
            style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.03)' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '15px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={{ display: 'block', marginBottom: '8px', opacity: 0.7 }}>Хост</label>
            <input
              name="host"
              required
              value={config.host}
              onChange={handleChange}
              placeholder="127.0.0.1"
              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.03)' }}
            />
          </div>
          <div style={{ width: '100px', flexShrink: 0 }}>
            <label style={{ display: 'block', marginBottom: '8px', opacity: 0.7 }}>Порт</label>
            <input
              name="port"
              required
              value={config.port}
              onChange={handleChange}
              placeholder="22"
              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.03)' }}
            />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', opacity: 0.7 }}>Пользователь</label>
          <input
            name="user"
            required
            value={config.user}
            onChange={handleChange}
            placeholder="root"
            style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.03)' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', opacity: 0.7 }}>Пароль</label>
          <input
            name="password"
            type="password"
            value={config.password}
            onChange={handleChange}
            placeholder="••••••••"
            style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.03)' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
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
            <Play size={18} /> Подключиться
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
            <Save size={18} /> {initialConfig ? 'Обновить' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  );
};
