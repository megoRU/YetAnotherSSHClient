import React from 'react';
import { Minus, Square, X, Download, RefreshCw, AlertCircle } from 'lucide-react';

import type { Tab } from '../../types';
import { useUpdateChecker } from '../../hooks/useUpdateChecker';

const { ipcRenderer } = window;

interface TitleBarProps {
    addTab: (type: Tab['type'], title: string) => void;
    updater: ReturnType<typeof useUpdateChecker>;
    menuRef: React.RefObject<HTMLDivElement>;
}

export const TitleBar: React.FC<TitleBarProps> = ({
    addTab,
    updater,
    menuRef
}) => {
    const { updateInfo, status, progress, error, startDownload, quitAndInstall } = updater;

    return (
        <div className="title-bar" style={{
            height: '30px',
            display: 'flex',
            alignItems: 'center',
            padding: 0,
            WebkitAppRegion: 'drag',
            background: 'rgba(0,0,0,0.05)',
            borderBottom: '1px solid var(--border-color)',
            justifyContent: 'space-between',
            userSelect: 'none'
        } as React.CSSProperties} ref={menuRef}>
            <div style={{
                display: 'flex',
                gap: '0',
                WebkitAppRegion: 'no-drag',
                alignItems: 'center',
                height: '100%',
                paddingLeft: ipcRenderer.platform === 'darwin' ? '80px' : '10px'
            } as React.CSSProperties}>
                <img src="./icons/icon32.png" style={{ width: '20px', height: '20px', marginRight: '15px' }}
                    alt="Logo" />

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
                        userSelect: 'none',
                        WebkitAppRegion: 'no-drag'
                    } as React.CSSProperties}
                    onClick={() => addTab('connection', 'Подключение')}
                >
                    Подключение
                </div>

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
                        userSelect: 'none',
                        WebkitAppRegion: 'no-drag'
                    } as React.CSSProperties}
                    onClick={() => addTab('settings', 'Параметры')}
                >
                    Настройки
                </div>

                {status === 'available' && updateInfo && (
                    <div
                        className="menu-item"
                        onClick={startDownload}
                        style={{
                            color: 'var(--primary-color)',
                            padding: '0 10px',
                            margin: '4px 5px',
                            height: '22px',
                            display: 'flex',
                            alignItems: 'center',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            WebkitAppRegion: 'no-drag',
                            gap: '5px'
                        } as React.CSSProperties}
                        title="Нажмите, чтобы начать загрузку"
                    >
                        <Download size={14} />
                        Доступно обновление: v{updateInfo.version}
                    </div>
                )}

                {status === 'downloading' && progress && (
                    <div
                        className="menu-item"
                        style={{
                            color: 'var(--primary-color)',
                            padding: '0 10px',
                            margin: '4px 5px',
                            height: '22px',
                            display: 'flex',
                            alignItems: 'center',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            WebkitAppRegion: 'no-drag',
                            gap: '8px',
                            fontSize: '11px'
                        } as React.CSSProperties}
                    >
                        <div style={{
                            width: '60px',
                            height: '4px',
                            background: 'rgba(200, 30, 81, 0.2)',
                            borderRadius: '2px',
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                width: `${progress.percent}%`,
                                height: '100%',
                                background: 'var(--primary-color)'
                            }} />
                        </div>
                        Загрузка: {Math.round(progress.percent)}%
                    </div>
                )}

                {status === 'downloaded' && (
                    <div
                        className="menu-item"
                        onClick={quitAndInstall}
                        style={{
                            color: '#fff',
                            background: 'var(--primary-color)',
                            padding: '0 10px',
                            margin: '4px 5px',
                            height: '22px',
                            display: 'flex',
                            alignItems: 'center',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            WebkitAppRegion: 'no-drag',
                            gap: '5px'
                        } as React.CSSProperties}
                        title="Нажмите, чтобы перезапустить и обновить"
                    >
                        <RefreshCw size={14} />
                        Обновить и перезагрузить
                    </div>
                )}

                {status === 'error' && (
                    <div
                        className="menu-item"
                        style={{
                            color: '#ff4d4d',
                            padding: '0 10px',
                            margin: '4px 5px',
                            height: '22px',
                            display: 'flex',
                            alignItems: 'center',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            WebkitAppRegion: 'no-drag',
                            gap: '5px'
                        } as React.CSSProperties}
                        title={error || 'Ошибка при обновлении'}
                    >
                        <AlertCircle size={14} />
                        Ошибка обновления
                    </div>
                )}

            </div>

            <div style={{ fontSize: '12px', opacity: 1, display: 'flex', alignItems: 'center', gap: '0px', fontWeight: 'bold' }}>
            </div>

            {ipcRenderer.platform !== 'darwin' && (
                <div style={{ display: 'flex', WebkitAppRegion: 'no-drag', height: '100%' } as React.CSSProperties}>
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
