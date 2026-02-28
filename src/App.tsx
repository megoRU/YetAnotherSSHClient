import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { TerminalComponent } from './components/Terminal';
import { ConnectionForm } from './components/ConnectionForm';
import { ContextMenu } from './components/ContextMenu';
import { Search, Server, X, Plus, Minus, Square, Play, Edit2, Trash2 } from 'lucide-react';
import './styles/light.css';
import './styles/dark.css';
import './styles/gruvbox-light.css';
import './App.css';

const { ipcRenderer } = window as any;

interface SSHConfig {
  id?: string;
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
  id: string;
  type: 'home' | 'ssh' | 'settings' | 'connection' | 'about';
  title: string;
  config?: SSHConfig;
}

// Robust ID generator
const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 11);
};

// Helper to encode string to base64 supporting UTF-8 using TextEncoder/TextDecoder
const toBase64 = (str: string) => {
  try {
    const uint8Array = new TextEncoder().encode(str);
    let binString = "";
    uint8Array.forEach((byte) => {
      binString += String.fromCharCode(byte);
    });
    return btoa(binString);
  } catch (e) {
    return btoa(str);
  }
};

const fromBase64 = (str: string) => {
  try {
    const binString = atob(str);
    const uint8Array = Uint8Array.from(binString, (m) => m.codePointAt(0)!);
    return new TextDecoder().decode(uint8Array);
  } catch (e) {
    try {
      return atob(str);
    } catch (e2) {
      return str;
    }
  }
};

const getOSIcon = (osPrettyName?: string) => {
  if (!osPrettyName) return './icons/os/default.svg';
  const name = osPrettyName.toLowerCase();
  if (name.includes('ubuntu')) return './icons/os/ubuntu.svg';
  if (name.includes('debian')) return './icons/os/debian.svg';
  if (name.includes('centos')) return './icons/os/centos.svg';
  if (name.includes('fedora')) return './icons/os/fedora.svg';
  if (name.includes('keenetic')) return './icons/os/keenetic.svg';
  return './icons/os/default.svg';
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('ErrorBoundary caught an error', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', color: 'red', background: 'white', height: '100vh' }}>
          <h1>Something went wrong.</h1>
          <pre>{this.state.error?.toString()}</pre>
          <button onClick={() => window.location.reload()}>Reload Application</button>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('0');
  const isConnectingRef = useRef(false);
  const [tabs, setTabs] = useState<Tab[]>([{ id: '0', type: 'home', title: 'Главная' }]);
  const [search, setSearch] = useState('');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, config: SSHConfig } | null>(null);
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
    ipcRenderer.invoke('get-config').then((loadedConfig: AppConfig) => {
      // Migration: ensure all favorites have an ID
      let changed = false;
      const migratedFavorites = loadedConfig.favorites.map(fav => {
        if (!fav.id) {
          changed = true;
          return { ...fav, id: generateId() };
        }
        return fav;
      });

      if (changed) {
        const updatedConfig = { ...loadedConfig, favorites: migratedFavorites };
        setConfig(updatedConfig);
        ipcRenderer.invoke('save-config', updatedConfig);
      } else {
        setConfig(loadedConfig);
      }
    });
    ipcRenderer.invoke('get-system-fonts').then(setSystemFonts);
  }, []);

  useLayoutEffect(() => {
    if (config) {
      const root = document.documentElement;
      const themeClass = config.theme.toLowerCase().replace(' ', '-');
      document.body.className = themeClass;
      document.documentElement.className = themeClass;
      root.style.setProperty('--ui-font-family', config.uiFontName);
      root.style.setProperty('--ui-font-size', `${config.uiFontSize}px`);
      localStorage.setItem('last-theme', config.theme);
    }
  }, [config]);

  const addTab = useCallback((type: Tab['type'], title: string, sshConfig?: SSHConfig) => {
    let existingId: string | null = null;
    if (type === 'ssh' && sshConfig) {
      const existingTab = tabs.find(t =>
        t.type === 'ssh' &&
        t.config?.id === sshConfig.id &&
        t.config?.host === sshConfig.host &&
        t.config?.user === sshConfig.user &&
        t.config?.port === sshConfig.port
      );
      if (existingTab) existingId = existingTab.id;
    }

    if (existingId) {
      setActiveTabId(existingId);
      return;
    }

    const newId = generateId();
    setTabs(prev => [...prev, { id: newId, type, title, config: sshConfig }]);
    setActiveTabId(newId);
  }, [tabs]);

  const handleFormConnect = useCallback((sshConfig: SSHConfig) => {
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;

    console.log('[App] Connecting to server...', sshConfig.host);
    const name = sshConfig.name || `${sshConfig.user}@${sshConfig.host}`;
    const newTabId = generateId();
    const configWithEncodedPassword = {
      ...sshConfig,
      password: toBase64(sshConfig.password || '')
    };

    setTabs(prev => {
      const otherTabs = prev.filter(t => t.id !== activeTabId);
      return [...otherTabs, { id: newTabId, type: 'ssh', title: name, config: configWithEncodedPassword }];
    });
    setActiveTabId(newTabId);

    setTimeout(() => {
      isConnectingRef.current = false;
    }, 1000);
  }, [activeTabId]);

  const handleOSInfo = useCallback((sshConfig: SSHConfig, osInfo: string) => {
    if (!config) return;

    const prettyNameMatch = osInfo.match(/PRETTY_NAME="([^"]+)"/);
    const osPrettyName = prettyNameMatch ? prettyNameMatch[1] : undefined;

    if (osPrettyName && sshConfig.osPrettyName !== osPrettyName) {
      console.log(`[App] Updating OS info for ${sshConfig.host}: ${osPrettyName}`);

      const newFavorites = config.favorites.map(fav => {
        if (fav.id === sshConfig.id) {
          return { ...fav, osPrettyName };
        }
        return fav;
      });

      const newConfig = { ...config, favorites: newFavorites };
      setConfig(newConfig);
      ipcRenderer.invoke('save-config', newConfig);

      // Update the active tab's config if it matches
      setTabs(prev => prev.map(tab => {
        if (tab.type === 'ssh' && tab.config &&
            (tab.config.id === sshConfig.id ||
             (tab.config.host === sshConfig.host &&
              tab.config.user === sshConfig.user &&
              tab.config.port === sshConfig.port))) {
          return { ...tab, config: { ...tab.config, osPrettyName } };
        }
        return tab;
      }));
    }
  }, [config]);

  if (!config) return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
      color: 'inherit',
      fontWeight: 'bold'
    }}>
    </div>
  );

  const handleFormSave = (sshConfig: SSHConfig) => {
    if (!config) return;
    const name = sshConfig.name || `${sshConfig.user}@${sshConfig.host}`;
    const newFavorite = {
      ...sshConfig,
      id: sshConfig.id || generateId(),
      name,
      password: toBase64(sshConfig.password || '')
    };

    // Check if we are updating an existing favorite (with fallback for backward compatibility)
    const existingIndex = config.favorites.findIndex(f =>
      f.id === newFavorite.id ||
      (f.host === newFavorite.host && f.user === newFavorite.user && f.port === newFavorite.port)
    );

    let newFavorites;
    if (existingIndex > -1) {
      newFavorites = [...config.favorites];
      newFavorites[existingIndex] = newFavorite;
    } else {
      newFavorites = [...config.favorites, newFavorite];
    }

    const newConfig = {
      ...config,
      favorites: newFavorites
    };
    setConfig(newConfig);
    ipcRenderer.invoke('save-config', newConfig);

    // Close the current tab after saving
    let newTabs = tabs.filter(t => t.id !== activeTabId);
    if (newTabs.length === 0) {
      const homeId = generateId();
      newTabs = [{ id: homeId, type: 'home', title: 'Главная' }];
      setTabs(newTabs);
      setActiveTabId(homeId);
    } else {
      setTabs(newTabs);
      setActiveTabId(newTabs[newTabs.length - 1].id);
    }
  };

  const deleteFavorite = (sshConfig: SSHConfig) => {
    if (!config) return;
    if (!confirm(`Вы уверены, что хотите удалить ${sshConfig.name}?`)) return;

    const newFavorites = config.favorites.filter(f =>
      f.id !== sshConfig.id &&
      !(f.host === sshConfig.host && f.user === sshConfig.user && f.port === sshConfig.port)
    );

    const newConfig = { ...config, favorites: newFavorites };
    setConfig(newConfig);
    ipcRenderer.invoke('save-config', newConfig);
  };

  const onContextMenu = (e: React.MouseEvent, sshConfig: SSHConfig) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      config: sshConfig
    });
  };

  const closeTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const index = tabs.findIndex(t => t.id === id);
    const newTabs = tabs.filter(t => t.id !== id);

    if (newTabs.length === 0) {
      const homeId = generateId();
      setTabs([{ id: homeId, type: 'home', title: 'Главная' }]);
      setActiveTabId(homeId);
    } else {
      setTabs(newTabs);
      if (activeTabId === id) {
        const nextActiveTab = newTabs[Math.max(0, index - 1)];
        setActiveTabId(nextActiveTab.id);
      }
    }
  };

  const filteredFavorites = config.favorites.filter(f =>
    f.name.toLowerCase().includes(search.toLowerCase()) ||
    f.host.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="app-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* Custom Title Bar */}
      <div className="title-bar" style={{
        height: '30px',
        display: 'flex',
        alignItems: 'center',
        padding: 0,
        ['WebkitAppRegion' as any]: 'drag',
        background: 'rgba(0,0,0,0.05)',
        borderBottom: '1px solid var(--border-color)',
        justifyContent: 'space-between',
        userSelect: 'none'
      }} ref={menuRef}>
        <div style={{ display: 'flex', gap: '0', ['WebkitAppRegion' as any]: 'no-drag', alignItems: 'center', height: '100%', paddingLeft: '10px' }}>
          <img src="./icons/icon32.png" style={{ width: '20px', height: '20px', marginRight: '15px' }} alt="Logo" />

          <div style={{ position: 'relative', height: '100%' }}>
            <div
              className="menu-item"
              style={{ fontWeight: 'bold', cursor: 'pointer', padding: '0 10px', height: '100%', display: 'flex', alignItems: 'center' }}
              onClick={() => setOpenMenu(openMenu === 'connect' ? null : 'connect')}
            >
              Подключение
            </div>
            {openMenu === 'connect' && (
              <div style={{ position: 'absolute', top: 'calc(100% + 5px)', left: 0, background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '4px', zIndex: 100, width: 'max-content', padding: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
                <div className="menu-dropdown-item" style={{ fontWeight: 'bold', padding: '4px 8px', margin: '1px 2px', cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => { addTab('connection', 'Подключение'); setOpenMenu(null); }}>Новое подключение</div>
              </div>
            )}
          </div>

          <div style={{ position: 'relative', height: '100%' }}>
            <div
              className="menu-item"
              style={{ fontWeight: 'bold', cursor: 'pointer', padding: '0 10px', height: '100%', display: 'flex', alignItems: 'center' }}
              onClick={() => setOpenMenu(openMenu === 'settings' ? null : 'settings')}
            >
              Настройки
            </div>
            {openMenu === 'settings' && (
              <div style={{ position: 'absolute', top: 'calc(100% + 5px)', left: 0, background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '4px', zIndex: 100, width: 'max-content', padding: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
                <div className="menu-dropdown-item" style={{ fontWeight: 'bold', padding: '4px 8px', margin: '1px 2px', cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => { addTab('settings', 'Параметры'); setOpenMenu(null); }}>Параметры</div>
              </div>
            )}
          </div>

          <div style={{ position: 'relative', height: '100%' }}>
            <div
              className="menu-item"
              style={{ fontWeight: 'bold', cursor: 'pointer', padding: '0 10px', height: '100%', display: 'flex', alignItems: 'center' }}
              onClick={() => setOpenMenu(openMenu === 'help' ? null : 'help')}
            >
              Справка
            </div>
            {openMenu === 'help' && (
              <div style={{ position: 'absolute', top: 'calc(100% + 5px)', left: 0, background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '4px', zIndex: 100, width: 'max-content', padding: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
                <div className="menu-dropdown-item" style={{ fontWeight: 'bold', padding: '4px 8px', margin: '1px 2px', cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => { addTab('about', 'О программе'); setOpenMenu(null); }}>О программе</div>
              </div>
            )}
          </div>
        </div>

        <div style={{ fontSize: '12px', opacity: 0.6 }}>YetAnotherSSHClient</div>

        <div style={{ display: 'flex', ['WebkitAppRegion' as any]: 'no-drag', height: '100%' }}>
          <div className="win-btn" onClick={() => ipcRenderer.send('window-minimize')} style={{ padding: '0 15px', cursor: 'pointer', height: '100%', display: 'flex', alignItems: 'center' }}><Minus size={14} /></div>
          <div className="win-btn" onClick={() => ipcRenderer.send('window-maximize')} style={{ padding: '0 15px', cursor: 'pointer', height: '100%', display: 'flex', alignItems: 'center' }}><Square size={12} /></div>
          <div className="win-btn close" onClick={() => ipcRenderer.send('window-close')} style={{ padding: '0 15px', cursor: 'pointer', height: '100%', display: 'flex', alignItems: 'center' }}><X size={14} /></div>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <div className="sidebar" style={{ width: '190px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '15px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '10px', opacity: 0.6 }}>ИЗБРАННОЕ</div>
            <div className="search-box" style={{ position: 'relative', width: '100%' }}>
              <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
              <input
                  placeholder="Поиск..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '6px 6px 6px 28px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.05)' }}
              />
            </div>
          </div>
          <div className="favorites-list" style={{ flex: 1, overflowY: 'auto' }}>
            {filteredFavorites.map((fav, i) => (
              <div
                key={i}
                className="fav-item"
                onClick={() => addTab('ssh', fav.name, fav)}
                onContextMenu={(e) => onContextMenu(e, fav)}
                style={{ fontWeight: 'bold', padding: '8px 15px', cursor: 'pointer' }}
              >
                {fav.name}
              </div>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Tab Bar */}
          <div className="tab-bar" style={{ height: '35px', display: 'flex', background: 'rgba(0,0,0,0.05)', borderBottom: '1px solid var(--border-color)', userSelect: 'none' }}>
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
                <div className="tab-close-btn" onClick={(e) => closeTab(e, tab.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '50%', transition: 'background-color 0.2s' }}>
                  <X size={12} />
                </div>
              </div>
            ))}
            <div style={{ padding: '0 10px', display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => addTab('home', 'Главная')}>
              <Plus size={14} />
            </div>
          </div>

          {/* Tab Content */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {tabs.map(tab => (
              <div key={tab.id} style={{ display: activeTabId === tab.id ? 'block' : 'none', height: '100%', width: '100%' }}>
                {tab.type === 'home' && (
                  <div style={{ padding: '40px', textAlign: 'center' }}>
                    <h2 style={{  marginBottom: '30px' }}>Выберите сервер для подключения</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 180px)', gap: '20px', justifyContent: 'center' }}>
                      {config.favorites.map((fav, i) => (
                        <div
                          key={i}
                          className="fav-card"
                          onClick={() => addTab('ssh', fav.name, fav)}
                            onContextMenu={(e) => onContextMenu(e, fav)}
                          style={{
                            width: '180px',
                            height: '180px',
                            padding: '15px',
                            borderRadius: '15px',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '12px',
                            boxSizing: 'border-box'
                          }}
                        >
                          <div style={{ width: '80px', height: '80px', borderRadius: '12px', background: '#c81e51', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', overflow: 'hidden' }}>
                            {fav.osPrettyName ? (
                              <img src={getOSIcon(fav.osPrettyName)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="OS Icon" />
                            ) : (
                              <Server size={40} />
                            )}
                          </div>
                          <div style={{ fontWeight: 'bold' }}>{fav.name}</div>
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
                    visible={activeTabId === tab.id}
                    onOSInfo={(info) => tab.config && handleOSInfo(tab.config, info)}
                  />
                )}
                {tab.type === 'connection' && (
                  <ConnectionForm
                    onConnect={handleFormConnect}
                    onSave={handleFormSave}
                    initialConfig={tab.config}
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
                      <select
                        value={config.uiFontName}
                        onChange={e => {
                           const newConfig = { ...config, uiFontName: e.target.value };
                           setConfig(newConfig);
                           ipcRenderer.invoke('save-config', newConfig);
                        }}
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
                        onChange={e => {
                          const newConfig = { ...config, uiFontSize: parseInt(e.target.value) || 12 };
                          setConfig(newConfig);
                          ipcRenderer.invoke('save-config', newConfig);
                        }}
                        style={{ width: '100%', padding: '8px' }}
                      />
                    </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: '5px' }}>Шрифт терминала:</label>
                        <select
                          value={config.terminalFontName}
                          onChange={e => {
                            const newConfig = { ...config, terminalFontName: e.target.value };
                            setConfig(newConfig);
                            ipcRenderer.invoke('save-config', newConfig);
                          }}
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
                          onChange={e => {
                            const newConfig = { ...config, terminalFontSize: parseInt(e.target.value) || 12 };
                            setConfig(newConfig);
                            ipcRenderer.invoke('save-config', newConfig);
                          }}
                          style={{ width: '100%', padding: '8px' }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                {tab.type === 'about' && (
                  <div style={{ padding: '40px', textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: `${config.uiFontSize}px` }}>
                      <img src="./icons/icon256.png" style={{ width: '128px', height: '128px', marginBottom: '20px' }} alt="Logo" />
                      <br />
                      <b style={{ fontSize: '1.5em' }}>YetAnotherSSHClient</b>
                      <br /><br />
                      Версия: 1.0.0
                      <br /><br />
                      GitHub: <a href="#" onClick={(e) => { e.preventDefault(); ipcRenderer.send('open-external', 'https://github.com/megoRU/YetAnotherSSHClient'); }} style={{ color: '#c81e51', textDecoration: 'none' }}>YetAnotherSSHClient</a>
                      <br /><br />
                      Лицензия: <a href="#" onClick={(e) => { e.preventDefault(); ipcRenderer.send('open-external', 'https://github.com/megoRU/YetAnotherSSHClient/blob/main/LICENSE'); }} style={{ color: '#c81e51', textDecoration: 'none' }}>GNU GPL v3</a>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          options={[
            {
              label: 'Подключиться',
              icon: <Play size={14} />,
              onClick: () => addTab('ssh', contextMenu.config.name, contextMenu.config)
            },
            {
              label: 'Редактировать',
              icon: <Edit2 size={14} />,
              onClick: () => addTab('connection', `Правка: ${contextMenu.config.name}`, {
                ...contextMenu.config,
                password: fromBase64(contextMenu.config.password || '')
              })
            },
            {
              label: 'Удалить',
              icon: <Trash2 size={14} />,
              danger: true,
              onClick: () => deleteFavorite(contextMenu.config)
            }
          ]}
        />
      )}
    </div>
  );
}

function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export default AppWrapper;
