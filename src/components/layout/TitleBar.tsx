import React from 'react';
import { Minus, Square, X, Download, Home, Settings, Plus } from 'lucide-react';

import type { Tab, AppConfig } from '../../types';
import { useUpdateChecker } from '../../hooks/useUpdateChecker';
import { useI18n } from '../../utils/i18n';

const { ipcRenderer } = window;

interface TitleBarProps {
    tabs: Tab[];
    activeTabId: string;
    setActiveTabId: (id: string) => void;
    addTab: (type: Tab['type'], title: string) => void;
    closeTab: (e: React.MouseEvent, id: string) => void;
    updater: ReturnType<typeof useUpdateChecker>;
    menuRef: React.RefObject<HTMLDivElement>;
    appConfig?: AppConfig;
}

export const TitleBar: React.FC<TitleBarProps> = ({
    tabs,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    updater,
    menuRef,
    appConfig
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
                gap: '4px',
                WebkitAppRegion: 'no-drag' as any,
                alignItems: 'center',
                height: '100%',
                paddingLeft: ipcRenderer?.platform === 'darwin' ? '70px' : '0'
            } as any}>
                <img src="/icons/icon32.png" style={{ width: '24px', height: '24px', marginRight: '12px' }}
                    alt="Logo" />

                <button
                    className={`nav-item ${tabs.length === 1 && activeTabId === tabs[0].id && tabs[0].type === 'home' ? 'active' : ''}`}
                    onClick={() => addTab('home', t('tabs.home'))}
                    title={t('common.home')}
                    style={{
                        padding: '0 10px',
                        height: '36px',
                        display: 'flex',
                        alignItems: 'center',
                        borderRadius: '8px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                    }}
                >
                    <Home size={18} />
                </button>

                <button
                    className={`nav-item ${activeTabId && tabs.find(t => t.id === activeTabId)?.type === 'settings' ? 'active' : ''}`}
                    onClick={() => addTab('settings', t('tabs.settings'))}
                    title={t('settings.title')}
                    style={{
                        padding: '0 10px',
                        height: '36px',
                        display: 'flex',
                        alignItems: 'center',
                        borderRadius: '8px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                    }}
                >
                    <Settings size={18} />
                </button>

                <div style={{ width: '1px', height: '24px', background: 'var(--border)', margin: '0 8px' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', maxWidth: '600px', overflowX: 'auto', paddingBottom: '2px' }} className="no-scrollbar">
                    {tabs.map((tab) => {
                        const isActive = activeTabId === tab.id;
                        if (tab.type === 'home' && tabs.length === 1) return null;

                        return (
                            <div
                                key={tab.id}
                                className={`header-tab ${isActive ? 'active' : ''}`}
                                onClick={() => setActiveTabId(tab.id)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '0 10px',
                                    height: '32px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                    fontWeight: isActive ? 500 : 400,
                                    background: isActive ? 'var(--hover-surface)' : 'transparent',
                                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                                    border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                                    transition: 'all 0.2s',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {tab.title}
                                </span>
                                {!(tabs.length === 1 && tab.type === 'home') && (
                                    <div className="tab-close-btn" onClick={(e) => { e.stopPropagation(); closeTab(e, tab.id); }} style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '16px',
                                        height: '16px',
                                        borderRadius: '4px',
                                        opacity: 0.6
                                    }}>
                                        <X size={12} strokeWidth={2.5} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    <button
                        className="nav-item"
                        onClick={() => addTab('home', t('tabs.home'))}
                        style={{
                            padding: '0 8px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            borderRadius: '6px',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer'
                        }}
                    >
                        <Plus size={16} />
                    </button>
                </div>
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
            <style>{`
                .nav-item:hover {
                    background: var(--hover-surface) !important;
                }
                .nav-item.active {
                    background: var(--hover-surface) !important;
                    color: var(--accent) !important;
                }
                .header-tab:hover {
                    background: var(--hover-surface) !important;
                    color: var(--text-primary) !important;
                }
                .tab-close-btn:hover {
                    background: var(--border) !important;
                    color: var(--text-primary) !important;
                    opacity: 1 !important;
                }
                .no-scrollbar::-webkit-scrollbar {
                    display: none;
                }
                .no-scrollbar {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}</style>
        </div>
    );
};
