import { useState, useEffect, useRef } from 'react';
import { TerminalComponent } from './components/Terminal';
import { Search, Server, Settings, HelpCircle, X, Plus, Minus, Square } from 'lucide-react';
import './styles/light.css';
import './styles/dark.css';
import './styles/gruvbox-light.css';
import './App.css';

const { ipcRenderer } = window as any;

interface SSHConfig {
  name: string;
  user: string;
  host: string;
  port: string;
  password?: string;
  identityFile?: string;
  osPrettyName?: string;
}

interface AppConfig {
  terminalFontName: string;
  terminalFontSize: number;
  uiFontName: string;
  uiFontSize: number;
  theme: string;
  favorites: SSHConfig[];
}

interface Tab {
  id: number;
  type: 'home' | 'ssh' | 'settings';
  title: string;
  config?: SSHConfig;
}

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeTabId, setActiveTabId] = useState<number>(0);
  const [tabs, setTabs] = useState<Tab[]>([{ id: 0, type: 'home', title: 'Connect' }]);
  const [search, setSearch] = useState('');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    ipcRenderer.invoke('get-config').then(setConfig);
  }, []);

  useEffect(() => {
    if (config) {
      const root = document.documentElement;
      document.body.className = config.theme.toLowerCase().replace(' ', '-');
      root.style.setProperty('--ui-font-family', config.uiFontName);
      root.style.setProperty('--ui-font-size', `${config.uiFontSize}px`);
    }
  }, [config]);

  if (!config) return <div>Loading...</div>;

  const addTab = (type: Tab['type'], title: string, sshConfig?: SSHConfig) => {
    const id = Date.now();
    setTabs([...tabs, { id, type, title, config: sshConfig }]);
    setActiveTabId(id);
  };

  const closeTab = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (tabs.length === 1) return;
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) setActiveTabId(newTabs[newTabs.length - 1].id);
  };

  const filteredFavorites = config.favorites.filter(f =>
    f.name.toLowerCase().includes(search.toLowerCase()) ||
    f.host.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="app-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* Custom Title Bar */}
      <div className="title-bar" style={{
        height: '40px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        ['WebkitAppRegion' as any]: 'drag',
        background: 'rgba(0,0,0,0.05)',
        borderBottom: '1px solid var(--border-color)',
        justifyContent: 'space-between'
      }} ref={menuRef}>
        <div style={{ display: 'flex', gap: '15px', ['WebkitAppRegion' as any]: 'no-drag', alignItems: 'center' }}>
          <div style={{ fontWeight: 'bold', marginRight: '10px' }}>YA_SSH</div>

          <div style={{ position: 'relative' }}>
            <div
              style={{ cursor: 'pointer', padding: '5px 10px' }}
              onClick={() => setOpenMenu(openMenu === 'connect' ? null : 'connect')}
            >
              Подключение
            </div>
            {openMenu === 'connect' && (
              <div style={{ position: 'absolute', top: '100%', left: 0, background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '4px', zIndex: 100, width: '180px', padding: '5px 0' }}>
                <div style={{ padding: '8px 15px', cursor: 'pointer' }} onClick={() => { addTab('home', 'Connect'); setOpenMenu(null); }}>Новое подключение</div>
                <div style={{ padding: '8px 15px', cursor: 'pointer' }}>Добавить в избранное</div>
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <div
              style={{ cursor: 'pointer', padding: '5px 10px' }}
              onClick={() => setOpenMenu(openMenu === 'settings' ? null : 'settings')}
            >
              Настройки
            </div>
            {openMenu === 'settings' && (
              <div style={{ position: 'absolute', top: '100%', left: 0, background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '4px', zIndex: 100, width: '180px', padding: '5px 0' }}>
                <div style={{ padding: '8px 15px', cursor: 'pointer' }} onClick={() => { addTab('settings', 'Settings'); setOpenMenu(null); }}>Параметры</div>
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <div
              style={{ cursor: 'pointer', padding: '5px 10px' }}
              onClick={() => setOpenMenu(openMenu === 'help' ? null : 'help')}
            >
              Справка
            </div>
            {openMenu === 'help' && (
              <div style={{ position: 'absolute', top: '100%', left: 0, background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '4px', zIndex: 100, width: '180px', padding: '5px 0' }}>
                <div style={{ padding: '8px 15px', cursor: 'pointer' }}>О программе</div>
              </div>
            )}
          </div>
        </div>

        <div style={{ fontSize: '12px', opacity: 0.6 }}>YetAnotherSSHClient</div>

        <div style={{ display: 'flex', ['WebkitAppRegion' as any]: 'no-drag' }}>
          <div className="win-btn" onClick={() => ipcRenderer.send('window-minimize')} style={{ padding: '10px 15px', cursor: 'pointer' }}><Minus size={14} /></div>
          <div className="win-btn" onClick={() => ipcRenderer.send('window-maximize')} style={{ padding: '10px 15px', cursor: 'pointer' }}><Square size={12} /></div>
          <div className="win-btn close" onClick={() => ipcRenderer.send('window-close')} style={{ padding: '10px 15px', cursor: 'pointer' }}><X size={14} /></div>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <div className="sidebar" style={{ width: '250px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '15px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '10px', opacity: 0.6 }}>ИЗБРАННОЕ</div>
            <div className="search-box" style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
              <input
                placeholder="Поиск..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', padding: '6px 6px 6px 28px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.05)' }}
              />
            </div>
          </div>
          <div className="favorites-list" style={{ flex: 1, overflowY: 'auto' }}>
            {filteredFavorites.map((fav, i) => (
              <div
                key={i}
                className="fav-item"
                onClick={() => addTab('ssh', fav.name, fav)}
                style={{ padding: '8px 15px', cursor: 'pointer' }}
              >
                {fav.name}
              </div>
            ))}
          </div>
          <div className="sidebar-footer" style={{ padding: '10px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '15px' }}>
            <Settings size={18} style={{ cursor: 'pointer' }} onClick={() => addTab('settings', 'Settings')} />
            <HelpCircle size={18} style={{ cursor: 'pointer' }} />
          </div>
        </div>

        {/* Main Content */}
        <div className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Tab Bar */}
          <div className="tab-bar" style={{ height: '35px', display: 'flex', background: 'rgba(0,0,0,0.05)', borderBottom: '1px solid var(--border-color)' }}>
            {tabs.map(tab => (
              <div
                key={tab.id}
                className={`tab ${activeTabId === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTabId(tab.id)}
                style={{
                  padding: '0 15px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  borderRight: '1px solid var(--border-color)',
                  background: activeTabId === tab.id ? 'var(--bg-color)' : 'transparent',
                }}
              >
                {tab.title}
                {tabs.length > 1 && <X size={12} onClick={(e) => closeTab(e, tab.id)} />}
              </div>
            ))}
            <div style={{ padding: '0 10px', display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => addTab('home', 'Connect')}>
              <Plus size={14} />
            </div>
          </div>

          {/* Tab Content */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {tabs.map(tab => (
              <div key={tab.id} style={{ display: activeTabId === tab.id ? 'block' : 'none', height: '100%', width: '100%' }}>
                {tab.type === 'home' && (
                  <div style={{ padding: '40px', textAlign: 'center' }}>
                    <h2 style={{ marginBottom: '30px', fontWeight: 'normal' }}>Выберите сервер для подключения</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '20px' }}>
                      {config.favorites.map((fav, i) => (
                        <div
                          key={i}
                          className="fav-card"
                          onClick={() => addTab('ssh', fav.name, fav)}
                          style={{
                            padding: '30px',
                            borderRadius: '15px',
                            background: 'rgba(0,0,0,0.05)',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '15px'
                          }}
                        >
                          <div style={{ width: '60px', height: '60px', borderRadius: '12px', background: '#c81e51', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                            <Server size={32} />
                          </div>
                          <div style={{ fontWeight: '500' }}>{fav.name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {tab.type === 'ssh' && tab.config && (
                  <TerminalComponent
                    id={tab.id}
                    theme={config.theme}
                    config={tab.config}
                    terminalFontName={config.terminalFontName}
                    terminalFontSize={config.terminalFontSize}
                  />
                )}
                {tab.type === 'settings' && (
                  <div style={{ padding: '40px', maxWidth: '600px' }}>
                    <h2>Настройки</h2>
                    <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '5px' }}>Тема:</label>
                        <select
                          value={config.theme}
                          onChange={e => {
                            const newConfig = { ...config, theme: e.target.value };
                            setConfig(newConfig);
                            ipcRenderer.invoke('save-config', newConfig);
                          }}
                          style={{ width: '100%', padding: '8px' }}
                        >
                          <option value="Light">Light</option>
                          <option value="Dark">Dark</option>
                          <option value="Gruvbox Light">Gruvbox Light</option>
                        </select>
                      </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '5px' }}>Шрифт интерфейса:</label>
                      <input
                        value={config.uiFontName}
                        onChange={e => setConfig({ ...config, uiFontName: e.target.value })}
                        onBlur={() => ipcRenderer.invoke('save-config', config)}
                        style={{ width: '100%', padding: '8px' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '5px' }}>Размер шрифта интерфейса:</label>
                      <input
                        type="number"
                        value={config.uiFontSize}
                        onChange={e => setConfig({ ...config, uiFontSize: parseInt(e.target.value) || 12 })}
                        onBlur={() => ipcRenderer.invoke('save-config', config)}
                        style={{ width: '100%', padding: '8px' }}
                      />
                    </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '5px' }}>Шрифт терминала:</label>
                        <input
                          value={config.terminalFontName}
                          onChange={e => setConfig({ ...config, terminalFontName: e.target.value })}
                          onBlur={() => ipcRenderer.invoke('save-config', config)}
                          style={{ width: '100%', padding: '8px' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '5px' }}>Размер шрифта терминала:</label>
                        <input
                          type="number"
                          value={config.terminalFontSize}
                          onChange={e => setConfig({ ...config, terminalFontSize: parseInt(e.target.value) || 12 })}
                          onBlur={() => ipcRenderer.invoke('save-config', config)}
                          style={{ width: '100%', padding: '8px' }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
