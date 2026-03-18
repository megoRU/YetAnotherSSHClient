import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {TerminalComponent} from './components/Terminal';
import {SFTPBrowser} from './components/SFTPBrowser';
import {ConnectionForm} from './components/ConnectionForm';
import {ContextMenu} from './components/ContextMenu';
import {Edit2, Folder, Minus, Play, Plus, Server, Square, Trash2, X} from 'lucide-react';
import './styles/light.css';
import './styles/dark.css';
import './styles/gruvbox-light.css';
import './App.css';

const {ipcRenderer} = window as any;

interface SSHConfig {
    id?: string
    name: string
    user: string
    host: string
    port: number
    password?: string
    authType?: 'password' | 'key'
    privateKeyPath?: string
    osPrettyName?: string
    initialCommands?: string
    allowLegacyAlgorithms?: boolean
}

interface AppConfig {
    terminalFontName: string
    terminalFontSize: number
    uiFontName: string
    uiFontSize: number
    theme: string
    favorites: SSHConfig[]
    x: number
    y: number
    width: number
    height: number
    maximized: boolean
    lastUpdateCheck?: number
}

interface Tab {
    id: string;
    type: 'home' | 'ssh' | 'settings' | 'connection' | 'about' | 'sftp';
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
        console.error(e);
        try {
            return atob(str);
        } catch (e2) {
            console.error(e2);
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
    return './icons/os/default.svg';
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
    constructor(props: any) {
        super(props);
        this.state = {hasError: false, error: null};
    }

    static getDerivedStateFromError(error: any) {
        return {hasError: true, error};
    }

    componentDidCatch(error: any, errorInfo: React.ErrorInfo) {
        console.error('ErrorBoundary caught an error', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{padding: '40px', color: 'red', background: 'white', height: '100vh'}}>
                    <h1>Что-то пошло не так.</h1>
                    <pre>{this.state.error?.toString()}</pre>
                    <button onClick={() => window.location.reload()}>Перезагрузить приложение</button>
                </div>
            );
        }

        return this.props.children;
    }
}

function App() {
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [systemFonts, setSystemFonts] = useState<string[]>([
        'JetBrains Mono', 'Menlo', 'Monaco', 'SF Pro Display', 'Helvetica Neue',
        'Consolas', 'Courier New', 'Segoe UI', 'Roboto', 'Ubuntu Mono', 'Arial', 'monospace', 'sans-serif'
    ]);
    const [activeTabId, setActiveTabId] = useState<string>('0');
    const isConnectingRef = useRef(false);
    const [tabs, setTabs] = useState<Tab[]>([{id: '0', type: 'home', title: 'Главная'}]);
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, config: SSHConfig } | null>(null);
    const [updateAvailable, setUpdateAvailable] = useState<{ version: string, url: string } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const unlisten = ipcRenderer.on('update-available', (data: any) => {
            setUpdateAvailable(data);
        });
        return () => {
            if (typeof unlisten === 'function') unlisten();
        };
    }, []);

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
                    return {...fav, id: generateId()};
                }
                return fav;
            });

            if (changed) {
                const updatedConfig = {...loadedConfig, favorites: migratedFavorites};
                setConfig(updatedConfig);
                ipcRenderer.invoke('save-config', updatedConfig);
            } else {
                setConfig(loadedConfig);
            }
        });
        ipcRenderer.invoke('get-system-fonts').then((fonts: string[]) => {
            if (fonts && fonts.length > 0) {
                setSystemFonts(fonts);
            }
        });
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
        if (type === 'home') {
            const existingHomeTab = tabs.find(t => t.type === 'home');
            if (existingHomeTab) {
                setActiveTabId(existingHomeTab.id);
                return;
            }
        }
        const newId = generateId();
        setTabs(prev => [...prev, {id: newId, type, title, config: sshConfig}]);
        setActiveTabId(newId);
    }, [tabs, setActiveTabId]);

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
            return [...otherTabs, {id: newTabId, type: 'ssh', title: name, config: configWithEncodedPassword}];
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
                    return {...fav, osPrettyName};
                }
                return fav;
            });

            const newConfig = {...config, favorites: newFavorites};
            setConfig(newConfig);
            ipcRenderer.invoke('save-config', newConfig);

            // Update the active tab's config if it matches
            setTabs(prev => prev.map(tab => {
                if (tab.type === 'ssh' && tab.config &&
                    (tab.config.id === sshConfig.id ||
                        (tab.config.host === sshConfig.host &&
                            tab.config.user === sshConfig.user &&
                            tab.config.port === sshConfig.port))) {
                    return {...tab, config: {...tab.config, osPrettyName}};
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
            newTabs = [{id: homeId, type: 'home', title: 'Главная'}];
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

        const newConfig = {...config, favorites: newFavorites};
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
            setTabs([{id: homeId, type: 'home', title: 'Главная'}]);
            setActiveTabId(homeId);
        } else {
            setTabs(newTabs);
            if (activeTabId === id) {
                const nextActiveTab = newTabs[Math.max(0, index - 1)];
                setActiveTabId(nextActiveTab.id);
            }
        }
    };

    return (
        <div className="app-container"
             style={{display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden'}}>
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
                <div style={{
                    display: 'flex',
                    gap: '0',
                    ['WebkitAppRegion' as any]: 'no-drag',
                    alignItems: 'center',
                    height: '100%',
                    paddingLeft: ipcRenderer.platform === 'darwin' ? '80px' : '10px'
                }}>
                    <img src="./icons/icon32.png" style={{width: '20px', height: '20px', marginRight: '15px'}}
                         alt="Logo"/>

                    <div style={{position: 'relative', height: '100%'}}>
                        <div
                            className="menu-item"
                            style={{
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                padding: '0 10px',
                                margin: '4px 5px',
                                height: '22px',
                                display: 'flex',
                                alignItems: 'center',
                                borderRadius: '4px',
                                userSelect: 'none'
                            }}
                            onClick={() => setOpenMenu(openMenu === 'connect' ? null : 'connect')}
                        >
                            Подключение
                        </div>
                        {openMenu === 'connect' && (
                            <div style={{
                                position: 'absolute',
                                top: 'calc(100% + 5px)',
                                left: 0,
                                background: 'var(--bg-color)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                zIndex: 100,
                                width: 'max-content',
                                padding: '2px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'stretch'
                            }}>
                                <div className="menu-dropdown-item" style={{
                                    fontWeight: 'bold',
                                    padding: '4px 8px',
                                    margin: '1px 2px',
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap'
                                }} onClick={() => {
                                    addTab('connection', 'Подключение');
                                    setOpenMenu(null);
                                }}>Новое подключение
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{position: 'relative', height: '100%'}}>
                        <div
                            className="menu-item"
                            style={{
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                padding: '0 10px',
                                margin: '4px 5px',
                                height: '22px',
                                display: 'flex',
                                alignItems: 'center',
                                borderRadius: '4px',
                                userSelect: 'none'
                            }}
                            onClick={() => setOpenMenu(openMenu === 'settings' ? null : 'settings')}
                        >
                            Настройки
                        </div>
                        {openMenu === 'settings' && (
                            <div style={{
                                position: 'absolute',
                                top: 'calc(100% + 5px)',
                                left: 0,
                                background: 'var(--bg-color)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                zIndex: 100,
                                width: 'max-content',
                                padding: '2px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'stretch'
                            }}>
                                <div className="menu-dropdown-item" style={{
                                    fontWeight: 'bold',
                                    padding: '4px 8px',
                                    margin: '1px 2px',
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap'
                                }} onClick={() => {
                                    addTab('settings', 'Параметры');
                                    setOpenMenu(null);
                                }}>Параметры
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{position: 'relative', height: '100%'}}>
                        <div
                            className="menu-item"
                            style={{
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                padding: '0 10px',
                                margin: '4px 5px',
                                height: '22px',
                                display: 'flex',
                                alignItems: 'center',
                                borderRadius: '4px',
                                userSelect: 'none'
                            }}
                            onClick={() => setOpenMenu(openMenu === 'help' ? null : 'help')}
                        >
                            Справка
                        </div>
                        {openMenu === 'help' && (
                            <div style={{
                                position: 'absolute',
                                top: 'calc(100% + 5px)',
                                left: 0,
                                background: 'var(--bg-color)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                zIndex: 100,
                                width: 'max-content',
                                padding: '2px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'stretch'
                            }}>
                                <div className="menu-dropdown-item" style={{
                                    fontWeight: 'bold',
                                    padding: '4px 8px',
                                    margin: '1px 2px',
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap'
                                }} onClick={() => {
                                    addTab('about', 'О программе');
                                    setOpenMenu(null);
                                }}>О программе
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div style={{fontSize: '12px', opacity: 1, display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 'bold'}}>
                    {updateAvailable && (
                        <div
                            onClick={() => ipcRenderer.send('open-external', updateAvailable.url)}
                            style={{
                                background: '#c81e51',
                                color: 'white',
                                padding: '2px 8px',
                                borderRadius: '10px',
                                fontSize: '10px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                ['WebkitAppRegion' as any]: 'no-drag'
                            }}
                        >
                            Доступно обновление: v{updateAvailable.version}
                        </div>
                    )}
                </div>

                {ipcRenderer.platform !== 'darwin' && (
                    <div style={{display: 'flex', ['WebkitAppRegion' as any]: 'no-drag', height: '100%'}}>
                        <div className="win-btn" onClick={() => ipcRenderer.send('window-minimize')}
                             style={{
                                 padding: '0 15px',
                                 cursor: 'pointer',
                                 height: '100%',
                                 display: 'flex',
                                 alignItems: 'center'
                             }}>
                            <Minus size={14}/></div>
                        <div className="win-btn" onClick={() => ipcRenderer.send('window-maximize')}
                             style={{
                                 padding: '0 15px',
                                 cursor: 'pointer',
                                 height: '100%',
                                 display: 'flex',
                                 alignItems: 'center'
                             }}>
                            <Square size={12}/></div>
                        <div className="win-btn close" onClick={() => ipcRenderer.send('window-close')}
                             style={{
                                 padding: '0 15px',
                                 cursor: 'pointer',
                                 height: '100%',
                                 display: 'flex',
                                 alignItems: 'center'
                             }}>
                            <X size={14}/></div>
                    </div>
                )}
            </div>

            <div style={{display: 'flex', flex: 1, minHeight: 0}}>
                {/* Main Content */}
                <div className="main-content" style={{flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0}}>
                    {/* Tab Bar */}
                    <div className="tab-bar" style={{
                        height: '35px',
                        display: 'flex',
                        background: 'rgba(0,0,0,0.05)',
                        borderBottom: '1px solid var(--border-color)',
                        userSelect: 'none'
                    }}>
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
                                {!(tabs.length === 1 && tab.type === 'home') && (
                                    <div className="tab-close-btn" onClick={(e) => closeTab(e, tab.id)} style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '20px',
                                        height: '20px',
                                        borderRadius: '50%',
                                        transition: 'background-color 0.2s'
                                    }}>
                                        <X size={12}/>
                                    </div>
                                )}
                            </div>
                        ))}
                        <div style={{display: 'flex', alignItems: 'center', padding: '0 5px'}}>
                            <div className="tab-add-btn"
                                 onClick={() => addTab('home', 'Главная')}
                                 style={{
                                     display: 'flex',
                                     alignItems: 'center',
                                     justifyContent: 'center',
                                     width: '24px',
                                     height: '24px',
                                     borderRadius: '50%',
                                     cursor: 'pointer',
                                     transition: 'background-color 0.2s'
                                 }}>
                                <Plus size={14}/>
                            </div>
                        </div>
                    </div>

                    {/* Tab Content */}
                    <div style={{flex: 1, position: 'relative', overflow: 'hidden'}}>
                        {tabs.map(tab => (
                            <div key={tab.id}
                                 style={{
                                     display: activeTabId === tab.id ? 'block' : 'none',
                                     height: '100%',
                                     width: '100%'
                                 }}>
                                {tab.type === 'home' && (
                                    <div style={{padding: '60px 40px', textAlign: 'center', userSelect: 'none'}}>
                                        <h2 style={{marginBottom: '30px', userSelect: 'none'}}>
                                            {config.favorites.length === 1 ? 'Сервер' : 'Сервера'}
                                        </h2>
                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 270px))',
                                            gap: '20px',
                                            justifyContent: 'center',
                                            maxWidth: '1200px',
                                            margin: '0 auto'
                                        }}>
                                            {config.favorites.map((fav, i) => (
                                                <div
                                                    key={i}
                                                    className="server-list-item"
                                                    onClick={() => addTab('ssh', fav.name, fav)}
                                                    onContextMenu={(e) => onContextMenu(e, fav)}
                                                    style={{
                                                        height: '220px',
                                                        padding: '20px',
                                                        borderRadius: '15px',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: '15px',
                                                        boxSizing: 'border-box',
                                                        transition: 'background-color 0.2s',
                                                        border: '1px solid var(--border-color)'
                                                    }}
                                                >
                                                    <div style={{
                                                        width: '90px',
                                                        height: '90px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center'
                                                    }}>
                                                        {fav.osPrettyName ? (
                                                            <img src={getOSIcon(fav.osPrettyName)}
                                                                 style={{
                                                                     width: '72px',
                                                                     height: '72px',
                                                                     objectFit: 'contain'
                                                                 }} alt="OS Icon"/>
                                                        ) : (
                                                            <Server size={72} style={{opacity: 0.7}}/>
                                                        )}
                                                    </div>
                                                    <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%'}}>
                                                        <div style={{fontWeight: 'bold', fontSize: '1.15em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%'}}>
                                                            {fav.name || fav.host}
                                                        </div>
                                                        <div style={{opacity: 0.6, fontSize: '0.95em'}}>
                                                            ssh, {fav.user}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            <div
                                                className="server-list-item"
                                                onClick={() => addTab('connection', 'Подключение')}
                                                style={{
                                                    height: '220px',
                                                    padding: '20px',
                                                    borderRadius: '15px',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: '15px',
                                                    boxSizing: 'border-box',
                                                    transition: 'background-color 0.2s',
                                                    border: '1px dashed var(--border-color)',
                                                    opacity: 0.8
                                                }}
                                            >
                                                <div style={{
                                                    width: '90px',
                                                    height: '90px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    borderRadius: '50%',
                                                    background: 'rgba(0,0,0,0.05)'
                                                }}>
                                                    <Plus size={56} style={{opacity: 0.5}}/>
                                                </div>
                                                <div style={{fontWeight: 'bold', fontSize: '1.1em'}}>
                                                    Добавить сервер
                                                </div>
                                            </div>
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
                                {tab.type === 'sftp' && tab.config && (
                                    <SFTPBrowser
                                        id={tab.id}
                                        config={tab.config}
                                        visible={activeTabId === tab.id}
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
                                    <div style={{padding: '40px', maxWidth: '600px'}}>
                                        <h2>Настройки</h2>
                                        <div style={{
                                            marginTop: '20px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '15px'
                                        }}>
                                            <div>
                                                <label style={{display: 'block', marginBottom: '5px'}}>Тема:</label>
                                                <select
                                                    value={config.theme}
                                                    onChange={e => {
                                                        const newConfig = {...config, theme: e.target.value};
                                                        setConfig(newConfig);
                                                        ipcRenderer.invoke('save-config', newConfig);
                                                    }}
                                                    style={{width: '100%', padding: '8px'}}
                                                >
                                                    <option value="Light">Light</option>
                                                    <option value="Dark">Dark</option>
                                                    <option value="Gruvbox Light">Gruvbox Light</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label style={{display: 'block', marginBottom: '5px'}}>Шрифт
                                                    интерфейса:</label>
                                                <select
                                                    value={config.uiFontName}
                                                    onChange={e => {
                                                        const newConfig = {...config, uiFontName: e.target.value};
                                                        setConfig(newConfig);
                                                        ipcRenderer.invoke('save-config', newConfig);
                                                    }}
                                                    style={{width: '100%', padding: '8px'}}
                                                >
                                                    {systemFonts.map(font => (
                                                        <option key={font} value={font}>{font}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label style={{display: 'block', marginBottom: '5px'}}>Размер шрифта
                                                    интерфейса:</label>
                                                <input
                                                    type="number"
                                                    value={config.uiFontSize}
                                                    onChange={e => {
                                                        const newConfig = {
                                                            ...config,
                                                            uiFontSize: parseInt(e.target.value) || 12
                                                        };
                                                        setConfig(newConfig);
                                                        ipcRenderer.invoke('save-config', newConfig);
                                                    }}
                                                    style={{width: '100%', padding: '8px'}}
                                                />
                                            </div>
                                            <div>
                                                <label style={{display: 'block', marginBottom: '5px'}}>Шрифт
                                                    терминала:</label>
                                                <select
                                                    value={config.terminalFontName}
                                                    onChange={e => {
                                                        const newConfig = {...config, terminalFontName: e.target.value};
                                                        setConfig(newConfig);
                                                        ipcRenderer.invoke('save-config', newConfig);
                                                    }}
                                                    style={{width: '100%', padding: '8px'}}
                                                >
                                                    {systemFonts.map(font => (
                                                        <option key={font} value={font}>{font}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label style={{display: 'block', marginBottom: '5px'}}>Размер шрифта
                                                    терминала:</label>
                                                <input
                                                    type="number"
                                                    value={config.terminalFontSize}
                                                    onChange={e => {
                                                        const newConfig = {
                                                            ...config,
                                                            terminalFontSize: parseInt(e.target.value) || 12
                                                        };
                                                        setConfig(newConfig);
                                                        ipcRenderer.invoke('save-config', newConfig);
                                                    }}
                                                    style={{width: '100%', padding: '8px'}}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {tab.type === 'about' && (
                                    <div style={{
                                        padding: '40px',
                                        textAlign: 'center',
                                        height: '100%',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <div style={{fontSize: `${config.uiFontSize}px`}}>
                                            <img src="./icons/icon256.png"
                                                 style={{width: '128px', height: '128px', marginBottom: '20px'}}
                                                 alt="Logo"/>
                                            <br/>
                                            <b style={{fontSize: '1.5em'}}>YetAnotherSSHClient</b>
                                            <br/><br/>
                                            Версия: 1.1.6
                                            <br/><br/>
                                            GitHub: <a href="#" onClick={(e) => {
                                            e.preventDefault();
                                            ipcRenderer.send('open-external', 'https://github.com/megoRU/YetAnotherSSHClient');
                                        }} style={{color: '#c81e51', textDecoration: 'none'}}>YetAnotherSSHClient</a>
                                            <br/><br/>
                                            Лицензия: <a href="#" onClick={(e) => {
                                            e.preventDefault();
                                            ipcRenderer.send('open-external', 'https://github.com/megoRU/YetAnotherSSHClient/blob/main/LICENSE');
                                        }} style={{color: '#c81e51', textDecoration: 'none'}}>GNU GPL v3</a>
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
                            icon: <Play size={14}/>,
                            onClick: () => addTab('ssh', contextMenu.config.name, contextMenu.config)
                        },
                        {
                            label: 'Открыть sFTP',
                            icon: <Folder size={14}/>,
                            onClick: () => {
                                const name = contextMenu.config.name || `${contextMenu.config.user}@${contextMenu.config.host}`;
                                addTab('sftp', `sFTP: ${name}`, {
                                    ...contextMenu.config,
                                    password: contextMenu.config.password // Already encoded
                                });
                            }
                        },
                        {
                            label: 'Редактировать',
                            icon: <Edit2 size={14}/>,
                            onClick: () => addTab('connection', `Правка: ${contextMenu.config.name}`, {
                                ...contextMenu.config,
                                password: fromBase64(contextMenu.config.password || '')
                            })
                        },
                        {
                            label: 'Удалить',
                            icon: <Trash2 size={14}/>,
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
            <App/>
        </ErrorBoundary>
    );
}

export default AppWrapper;
