import React from 'react';
import { Minus, Square, X } from 'lucide-react';

const { ipcRenderer } = window as any;

interface TitleBarProps {
    openMenu: string | null;
    setOpenMenu: (menu: string | null) => void;
    addTab: (type: any, title: string) => void;
    updateAvailable: { version: string, url: string } | null;
    menuRef: React.RefObject<HTMLDivElement>;
}

export const TitleBar: React.FC<TitleBarProps> = ({
    openMenu,
    setOpenMenu,
    addTab,
    updateAvailable,
    menuRef
}) => {
    return (
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
                <img src="./icons/icon32.png" style={{ width: '20px', height: '20px', marginRight: '15px' }}
                    alt="Logo" />

                <div style={{ position: 'relative', height: '100%' }}>
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

                <div style={{ position: 'relative', height: '100%' }}>
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

                <div style={{ position: 'relative', height: '100%' }}>
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

            <div style={{ fontSize: '12px', opacity: 1, display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 'bold' }}>
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
                <div style={{ display: 'flex', ['WebkitAppRegion' as any]: 'no-drag', height: '100%' }}>
                    <div className="win-btn" onClick={() => ipcRenderer.send('window-minimize')}
                        style={{
                            padding: '0 15px',
                            cursor: 'pointer',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center'
                        }}>
                        <Minus size={14} /></div>
                    <div className="win-btn" onClick={() => ipcRenderer.send('window-maximize')}
                        style={{
                            padding: '0 15px',
                            cursor: 'pointer',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center'
                        }}>
                        <Square size={12} /></div>
                    <div className="win-btn close" onClick={() => ipcRenderer.send('window-close')}
                        style={{
                            padding: '0 15px',
                            cursor: 'pointer',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center'
                        }}>
                        <X size={14} /></div>
                </div>
            )}
        </div>
    );
};
