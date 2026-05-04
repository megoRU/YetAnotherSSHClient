import React, { useRef, useState, useEffect } from 'react';
import { Minus, Square, X, Download, Home, Settings, Plus, ArrowDown, Check, ChevronLeft, ChevronRight } from 'lucide-react';

import type { Tab, AppConfig } from '../../types';
import { useUpdateChecker } from '../../hooks/useUpdateChecker';
import { useI18n } from '../../utils/i18n';
import { stripHtml } from '../../utils';

const { ipcRenderer } = window;

interface TitleBarProps {
    tabs: Tab[];
    activeTabId: string;
    activeView: 'home' | 'settings' | 'tab';
    setActiveTabId: (id: string) => void;
    setActiveView: (view: 'home' | 'settings' | 'tab') => void;
    addTab: (type: Tab['type'], title: string) => void;
    closeTab: (e: React.MouseEvent, id: string) => void;
    updater: ReturnType<typeof useUpdateChecker>;
    menuRef: React.RefObject<HTMLDivElement>;
    appConfig?: AppConfig;
}

export const TitleBar: React.FC<TitleBarProps> = ({
    tabs,
    activeTabId,
    activeView,
    setActiveTabId,
    setActiveView,
    addTab,
    closeTab,
    updater,
    menuRef,
    appConfig
}) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    const { updateInfo, status, progress, startDownload, quitAndInstall } = updater;
    const scrollRef = useRef<HTMLDivElement>(null);
    const [showLeftScroll, setShowLeftScroll] = useState(false);
    const [showRightScroll, setShowRightScroll] = useState(false);
    const [showUpdateTooltip, setShowUpdateTooltip] = useState(false);

    const connectionTabs = tabs.filter(t => t.type !== 'home' && t.type !== 'settings' && t.type !== 'about');

    const checkScroll = () => {
        if (scrollRef.current) {
            const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
            setShowLeftScroll(scrollLeft > 0);
            setShowRightScroll(scrollLeft < scrollWidth - clientWidth - 5);
        }
    };

    useEffect(() => {
        checkScroll();
        window.addEventListener('resize', checkScroll);
        return () => window.removeEventListener('resize', checkScroll);
    }, [connectionTabs]);

    const scroll = (direction: 'left' | 'right') => {
        if (scrollRef.current) {
            const amount = direction === 'left' ? -200 : 200;
            scrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
        }
    };

    const handleWheel = (e: React.WheelEvent) => {
        if (scrollRef.current) {
            scrollRef.current.scrollLeft += e.deltaY;
            checkScroll();
        }
    };

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
                alignItems: 'center',
                height: '100%',
                flex: 1,
                minWidth: 0,
                paddingLeft: ipcRenderer?.platform === 'darwin' ? '70px' : '0'
            } as any}>
                <img src="./icons/icon48.png" style={{ width: '24px', height: '24px', marginRight: '12px' }}
                    alt="Logo" draggable="false" />

                <button
                    className={`nav-item ${activeView === 'home' ? 'active' : ''}`}
                    onClick={() => setActiveView('home')}
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
                        transition: 'all 0.2s',
                        WebkitAppRegion: 'no-drag'
                    } as any}
                >
                    <Home size={18} />
                </button>

                <button
                    className={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
                    onClick={() => setActiveView('settings')}
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
                        transition: 'all 0.2s',
                        WebkitAppRegion: 'no-drag'
                    } as any}
                >
                    <Settings size={18} />
                </button>

                {status !== 'idle' && status !== 'checking' && status !== 'not-available' && status !== 'error' && (
                    <div style={{ display: 'flex', alignItems: 'center', WebkitAppRegion: 'no-drag' } as any}>
                        <div style={{ width: '1px', height: '24px', background: 'var(--border)', margin: '0 8px' }} />
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <button
                                className="update-banner-btn"
                                onClick={() => {
                                    if (status === 'available') startDownload();
                                    else if (status === 'downloaded') quitAndInstall();
                                }}
                                onMouseEnter={() => setShowUpdateTooltip(true)}
                                onMouseLeave={() => setShowUpdateTooltip(false)}
                                style={{
                                    height: '36px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '0 12px',
                                    background: 'rgba(var(--accent-rgb), 0.1)',
                                    border: '1px solid var(--accent)',
                                    borderRadius: '8px',
                                    color: 'var(--accent)',
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                    fontWeight: 600,
                                    transition: 'all 0.2s',
                                    position: 'relative',
                                    overflow: 'hidden'
                                }}
                            >
                                {status === 'downloading' && progress && (
                                    <div style={{
                                        position: 'absolute',
                                        bottom: 0,
                                        left: 0,
                                        height: '2px',
                                        background: 'var(--accent)',
                                        width: `${progress.percent}%`,
                                        transition: 'width 0.2s'
                                    }} />
                                )}

                                {status === 'available' ? <ArrowDown size={16} /> :
                                 status === 'downloading' ? <Download size={16} className="spin" /> :
                                 <Check size={16} />}

                                <span>
                                         {status === 'available' ? t('settings.newVersionAvailable', { version: updateInfo?.version || '' }) :
                                     status === 'downloading' ? `${Math.round(progress?.percent || 0)}%` :
                                     t('settings.installing')}
                                </span>
                            </button>

                            {showUpdateTooltip && updateInfo?.releaseNotes && (
                                <div style={{
                                    position: 'absolute',
                                    top: 'calc(100% + 10px)',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    background: 'var(--surface)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '12px',
                                    padding: '12px 16px',
                                    boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
                                    zIndex: 1000,
                                    width: 'max-content',
                                    maxWidth: '300px',
                                    color: 'var(--text-primary)',
                                    fontSize: '12px',
                                    lineHeight: '1.4',
                                    textAlign: 'left',
                                    pointerEvents: 'none',
                                    animation: 'tooltipFadeIn 0.2s ease-out'
                                }}>
                                    <div style={{ fontWeight: 700, marginBottom: '4px', color: 'var(--accent)' }}>
                                        {t('settings.whatsNew')}
                                    </div>
                                    <div style={{ opacity: 0.9 }}>
                                        {stripHtml(updateInfo.releaseNotes)}
                                    </div>
                                    <div style={{
                                        position: 'absolute',
                                        top: '-6px',
                                        left: '50%',
                                        transform: 'translateX(-50%) rotate(45deg)',
                                        width: '10px',
                                        height: '10px',
                                        background: 'var(--surface)',
                                        borderTop: '1px solid var(--border)',
                                        borderLeft: '1px solid var(--border)'
                                    }} />
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div style={{ width: '1px', height: '24px', background: 'var(--border)', margin: '0 8px' }} />

                <div style={{ display: 'flex', alignItems: 'stretch', gap: '4px', flex: 1, minWidth: 0 }}>
                    {showLeftScroll && (
                        <button
                            onClick={() => scroll('left')}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                WebkitAppRegion: 'no-drag'
                            } as any}
                        >
                            <ChevronLeft size={16} />
                        </button>
                    )}
                    <div
                        ref={scrollRef}
                        onScroll={checkScroll}
                        onWheel={handleWheel}
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', overflowX: 'auto', paddingBottom: '2px', WebkitAppRegion: 'no-drag' } as any}
                        className="no-scrollbar"
                    >
                        {connectionTabs.map((tab) => {
                            const isActive = activeView === 'tab' && activeTabId === tab.id;

                            return (
                                <div
                                    key={tab.id}
                                    className={`header-tab ${isActive ? 'active' : ''}`}
                                    onClick={() => {
                                        setActiveTabId(tab.id);
                                        setActiveView('tab');
                                    }}
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
                                    whiteSpace: 'nowrap',
                                    minWidth: '40px',
                                    flexShrink: 1
                                    }}
                                >
                                <span style={{ maxWidth: '200px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {tab.title}
                                    </span>
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
                                </div>
                            );
                        })}
                    </div>
                    {showRightScroll && (
                        <button
                            onClick={() => scroll('right')}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                WebkitAppRegion: 'no-drag'
                            } as any}
                        >
                            <ChevronRight size={16} />
                        </button>
                    )}
                    <button
                        className="add-tab-btn"
                        onClick={() => addTab('connection', t('tabs.connection'))}
                        style={{
                            padding: '0 8px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            borderRadius: '6px',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            WebkitAppRegion: 'no-drag',
                            flexShrink: 0
                        } as any}
                    >
                        <Plus size={16} />
                    </button>
                </div>
            </div>

            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flexShrink: 0,
                WebkitAppRegion: 'no-drag' as any
            } as any}>
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
                .add-tab-btn:hover {
                    background: var(--hover-surface) !important;
                    color: var(--text-primary) !important;
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
                @keyframes tooltipFadeIn {
                    from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
                    to { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
            `}</style>
        </div>
    );
};
