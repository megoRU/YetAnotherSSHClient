import React from 'react';
import { Minus, Square, X, Download, Plus, Home, Settings, Search } from 'lucide-react';

import type { Tab, AppConfig } from '../../types';
import { useUpdateChecker } from '../../hooks/useUpdateChecker';
import { useI18n } from '../../utils/i18n';

const { ipcRenderer } = window;

interface TitleBarProps {
    addTab: (type: Tab['type'], title: string) => void;
    updater: ReturnType<typeof useUpdateChecker>;
    menuRef: React.RefObject<HTMLDivElement>;
    appConfig?: AppConfig;
    searchQuery: string;
    setSearchQuery: (query: string) => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
    addTab,
    updater,
    menuRef,
    appConfig,
    searchQuery,
    setSearchQuery
}) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    const { updateInfo, status, startDownload } = updater;

    return (
        <div className="title-bar" style={{
            height: '56px',
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            WebkitAppRegion: 'drag' as any,
            background: 'var(--background)',
            borderBottom: '1px solid var(--border)',
            justifyContent: 'space-between',
            userSelect: 'none',
            gap: '20px'
        } as any} ref={menuRef}>
            <div style={{
                display: 'flex',
                gap: '8px',
                WebkitAppRegion: 'no-drag' as any,
                alignItems: 'center',
                height: '100%',
                paddingLeft: ipcRenderer?.platform === 'darwin' ? '70px' : '0'
            } as any}>
                <img src="./icons/icon32.png" style={{ width: '24px', height: '24px', marginRight: '8px' }}
                    alt="Logo" />

                <button
                    className="menu-item"
                    style={{
                        padding: '0 12px',
                        height: '36px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        borderRadius: '8px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: 500,
                        transition: 'all 0.2s'
                    }}
                    onClick={() => addTab('home', t('tabs.home'))}
                >
                    <Home size={18} />
                    {t('common.home')}
                </button>

                <button
                    className="menu-item"
                    style={{
                        padding: '0 12px',
                        height: '36px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        borderRadius: '8px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: 500,
                        transition: 'all 0.2s'
                    }}
                    onClick={() => addTab('settings', t('tabs.settings'))}
                >
                    <Settings size={18} />
                    {t('settings.title')}
                </button>
            </div>

            <div style={{
                flex: 1,
                maxWidth: '400px',
                position: 'relative',
                WebkitAppRegion: 'no-drag' as any
            } as any}>
                <Search size={16} style={{
                    position: 'absolute',
                    left: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    opacity: 0.5,
                    color: 'var(--text-secondary)'
                }} />
                <input
                    type="text"
                    placeholder={t('common.search')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                        width: '100%',
                        height: '36px',
                        padding: '0 12px 0 36px',
                        borderRadius: '8px',
                        background: 'var(--hover-surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        fontWeight: 400,
                        outline: 'none',
                        transition: 'all 0.2s'
                    }}
                />
            </div>

            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                WebkitAppRegion: 'no-drag' as any
            } as any}>
                {status === 'available' && updateInfo && (
                    <button
                        className="btn-primary"
                        onClick={startDownload}
                        style={{
                            height: '36px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '0 16px',
                            fontSize: '13px',
                            borderRadius: '8px'
                        }}
                    >
                        <Download size={16} />
                        v{updateInfo.version}
                    </button>
                )}

                <button
                    className="btn-primary"
                    onClick={() => addTab('connection', t('tabs.connection'))}
                    style={{
                        height: '36px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '0 16px',
                        fontSize: '14px',
                        borderRadius: '8px'
                    }}
                >
                    <Plus size={18} />
                    {t('home.addServer')}
                </button>

                {ipcRenderer?.platform !== 'darwin' && (
                    <div style={{ display: 'flex', marginLeft: '8px' }}>
                        <div className="win-btn" onClick={() => ipcRenderer.send('window-minimize')}
                            style={{
                                padding: '0 12px',
                                cursor: 'pointer',
                                height: '36px',
                                display: 'flex',
                                alignItems: 'center',
                                borderRadius: '6px'
                            }}>
                            <Minus size={16} /></div>
                        <div className="win-btn" onClick={() => ipcRenderer.send('window-maximize')}
                            style={{
                                padding: '0 12px',
                                cursor: 'pointer',
                                height: '36px',
                                display: 'flex',
                                alignItems: 'center',
                                borderRadius: '6px'
                            }}>
                            <Square size={14} /></div>
                        <div className="win-btn close" onClick={() => ipcRenderer.send('window-close')}
                            style={{
                                padding: '0 12px',
                                cursor: 'pointer',
                                height: '36px',
                                display: 'flex',
                                alignItems: 'center',
                                borderRadius: '6px'
                            }}>
                            <X size={16} /></div>
                    </div>
                )}
            </div>
        </div>
    );
};
