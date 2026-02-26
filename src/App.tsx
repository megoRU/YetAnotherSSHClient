import { useState, useEffect } from 'react';
import { TerminalComponent } from './components/Terminal';
import './styles/light.css';
import './styles/dark.css';
import './styles/gruvbox-light.css';
import './App.css';

type Theme = 'light' | 'dark' | 'gruvbox-light';

interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
}

function App() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [config, setConfig] = useState<SSHConfig | null>(null);
  const [form, setForm] = useState<SSHConfig>({
    host: 'localhost',
    port: 22,
    username: 'user',
    password: ''
  });

  useEffect(() => {
    document.body.className = theme;
  }, [theme]);

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    setConfig({ ...form });
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>TypeScript SSH Client</h1>

      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', alignItems: 'center' }}>
        <label>Theme:</label>
        <select value={theme} onChange={e => setTheme(e.target.value as Theme)}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="gruvbox-light">Gruvbox Light</option>
        </select>
      </div>

      <form onSubmit={handleConnect} style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <input
          placeholder="Host"
          value={form.host}
          onChange={e => setForm({ ...form, host: e.target.value })}
          required
        />
        <input
          type="number"
          placeholder="Port"
          value={form.port}
          onChange={e => setForm({ ...form, port: parseInt(e.target.value) || 22 })}
          required
        />
        <input
          placeholder="Username"
          value={form.username}
          onChange={e => setForm({ ...form, username: e.target.value })}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={e => setForm({ ...form, password: e.target.value })}
        />
        <button type="submit">Connect</button>
      </form>

      <TerminalComponent theme={theme} config={config} />
    </div>
  );
}

export default App;
