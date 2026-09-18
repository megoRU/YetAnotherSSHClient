import React from 'react';
import { Home, Settings, Plus, Heart, Terminal, X } from 'lucide-react';

import type { Tab, AppConfig } from '../../types';
import { useUpdateChecker } from '../../hooks/useUpdateChecker';

const { ipcRenderer } = window;

interface TitleBarProps {
    tabs: Tab[];
    activeTabId: string;
    activeView: 'home' | 'settings' | 'tab' | 'support';
    setActiveTabId: (id: string) => void;
    setActiveView: (view: 'home' | 'settings' | 'tab' | 'support') => void;
    closeTab: (e: React.MouseEvent, id: string) => void;
    onTabContextMenu?: (e: React.MouseEvent | { clientX: number, clientY: number }, tab: Tab) => void;
    updater: ReturnType<typeof useUpdateChecker>;
    menuRef: React.RefObject<HTMLDivElement | null>;
    appConfig?: AppConfig;
    isOnboarding?: boolean;
    setTabs?: (updater: (prev: Tab[]) => Tab[]) => void;
    onOpenLocalTerminal?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = React.memo(({
    tabs,
    activeTabId,
    activeView,
    setActiveTabId,
    setActiveView,
    closeTab,
    onTabContextMenu,
    updater,
    menuRef,
    appConfig,
    isOnboarding = false,
    setTabs,
    onOpenLocalTerminal
}) => {
    const { isUpdateAvailable: hasUpdate } = updater;
    const isMountedRef = React.useRef(true);
    const dragTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeDragIdRef = React.useRef<string | null>(null);
    const tabsContainerRef = React.useRef<HTMLDivElement | null>(null);
    const [isMaximized, setIsMaximized] = React.useState(false);

    React.useEffect(() => {
        isMountedRef.current = true;
        const unsub = ipcRenderer?.onWindowMaximizedState?.((maximized: boolean) => {
            if (isMountedRef.current) {
                setIsMaximized(maximized);
            }
        });

        const handleWindowFocus = () => {
            if (document.activeElement instanceof HTMLElement) {
                if (document.activeElement.matches('.window-control-btn, .nav-item, .add-tab-btn, .tab-close-btn')) {
                    document.activeElement.blur();
                }
            }
        };

        window.addEventListener('focus', handleWindowFocus);

        return () => {
            isMountedRef.current = false;
            if (unsub) unsub();
            if (dragTimeoutRef.current) {
                clearTimeout(dragTimeoutRef.current);
                dragTimeoutRef.current = null;
            }
            window.removeEventListener('focus', handleWindowFocus);
        };
    }, []);

    const connectionTabs = tabs.filter(t => t.type !== 'home' && t.type !== 'settings');

    const handleTabPointerDown = (e: React.PointerEvent<HTMLDivElement>, tab: Tab) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('.tab-close-btn')) return;

        if (dragTimeoutRef.current) {
            clearTimeout(dragTimeoutRef.current);
            dragTimeoutRef.current = null;
        }

        const startX = e.clientX;
        const startY = e.clientY;
        const draggedElement = e.currentTarget;
        const pointerId = e.pointerId;
        const draggedTabId = tab.id;

        let hasDragStarted = false;
        let containerRect: DOMRect | null = null;
        let tabElements: HTMLElement[] = [];
        let initialTabsData: { element: HTMLElement; left: number; width: number; tabId: string }[] = [];
        let draggedWidth = 0;
        let initialLeft = 0;
        let gap = 4;
        let cursorOffsetWithinTab = 0;
        let currentX = e.clientX;
        let targetTabId = draggedTabId;
        let draggedIndex = connectionTabs.findIndex(t => t.id === draggedTabId);
        let animationFrameId: number | null = null;

        const startDrag = () => {
            const container = tabsContainerRef.current;
            if (!container) return false;

            draggedIndex = connectionTabs.findIndex(t => t.id === draggedTabId);
            if (draggedIndex === -1) return false;

            containerRect = container.getBoundingClientRect();
            tabElements = Array.from(container.querySelectorAll('.header-tab')) as HTMLElement[];

            if (tabElements.length !== connectionTabs.length) return false;

            initialTabsData = tabElements.map((el, i) => {
                const rect = el.getBoundingClientRect();
                return {
                    element: el,
                    left: rect.left - containerRect!.left,
                    width: rect.width,
                    tabId: connectionTabs[i].id
                };
            });

            if (draggedIndex >= initialTabsData.length) return false;

            draggedWidth = initialTabsData[draggedIndex].width;
            initialLeft = initialTabsData[draggedIndex].left;
            gap = initialTabsData.length > 1
                ? (initialTabsData[1].left - (initialTabsData[0].left + initialTabsData[0].width))
                : 4;

            cursorOffsetWithinTab = startX - draggedElement.getBoundingClientRect().left;

            activeDragIdRef.current = draggedTabId;
            try {
                draggedElement.setPointerCapture(pointerId);
            } catch {
                // ignore
            }

            document.body.style.userSelect = 'none';
            hasDragStarted = true;
            return true;
        };

        const removeListeners = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerCancel);
        };

        const handlePointerMove = (moveEvent: PointerEvent) => {
            if (!hasDragStarted) {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                if (Math.hypot(dx, dy) >= 5) {
                    if (!startDrag()) return;
                } else {
                    return;
                }
            }

            if (!containerRect) return;

            currentX = moveEvent.clientX;

            if (animationFrameId === null) {
                animationFrameId = requestAnimationFrame(() => {
                    animationFrameId = null;
                    if (!hasDragStarted || !containerRect) return;

                    let draggedLeft = currentX - containerRect.left - cursorOffsetWithinTab;
                    const minLeft = 0;
                    const maxLeft = containerRect.width - draggedWidth;
                    draggedLeft = Math.max(minLeft, Math.min(maxLeft, draggedLeft));

                    draggedElement.style.transform = `translate3d(${draggedLeft - initialLeft}px, 0, 0)`;
                    draggedElement.style.zIndex = '10';
                    draggedElement.style.transition = 'none';

                    let nextTargetIndex = draggedIndex;

                    for (let i = 0; i < initialTabsData.length; i++) {
                        if (i === draggedIndex) continue;
                        const neighbor = initialTabsData[i];
                        const neighborCenter = neighbor.left + neighbor.width / 2;

                        if (i < draggedIndex) {
                            if (draggedLeft < neighborCenter) {
                                nextTargetIndex = Math.min(nextTargetIndex, i);
                            }
                        } else {
                            if (draggedLeft + draggedWidth > neighborCenter) {
                                nextTargetIndex = Math.max(nextTargetIndex, i);
                            }
                        }
                    }

                    targetTabId = initialTabsData[nextTargetIndex]?.tabId || draggedTabId;

                    for (let i = 0; i < initialTabsData.length; i++) {
                        if (i === draggedIndex) continue;
                        const neighbor = initialTabsData[i];
                        let shift = 0;

                        if (i < draggedIndex && i >= nextTargetIndex) {
                            shift = draggedWidth + gap;
                        } else if (i > draggedIndex && i <= nextTargetIndex) {
                            shift = -(draggedWidth + gap);
                        }

                        neighbor.element.style.transform = `translate3d(${shift}px, 0, 0)`;
                        neighbor.element.style.transition = 'transform 0.2s cubic-bezier(0.2, 1, 0.2, 1)';
                    }
                });
            }
        };

        const handlePointerCancel = (cancelEvent: PointerEvent) => {
            removeListeners();

            if (!hasDragStarted) return;

            activeDragIdRef.current = null;
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }

            try {
                draggedElement.releasePointerCapture(cancelEvent.pointerId);
            } catch {
                // ignore
            }

            document.body.style.userSelect = '';

            tabElements.forEach((el) => {
                el.style.transform = '';
                el.style.transition = '';
                el.style.zIndex = '';
            });
        };

        const handlePointerUp = (upEvent: PointerEvent) => {
            removeListeners();

            if (!hasDragStarted) {
                return;
            }

            activeDragIdRef.current = null;
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }

            try {
                draggedElement.releasePointerCapture(upEvent.pointerId);
            } catch {
                // ignore
            }

            document.body.style.userSelect = '';

            const targetIndex = initialTabsData.findIndex(d => d.tabId === targetTabId);
            let targetTranslation = 0;
            if (targetIndex !== -1 && targetIndex < draggedIndex) {
                targetTranslation = initialTabsData[targetIndex].left - initialLeft;
            } else if (targetIndex !== -1 && targetIndex > draggedIndex) {
                targetTranslation = (initialTabsData[targetIndex].left + initialTabsData[targetIndex].width - draggedWidth) - initialLeft;
            }

            draggedElement.style.transition = 'transform 0.2s cubic-bezier(0.2, 1, 0.2, 1)';
            draggedElement.style.transform = `translate3d(${targetTranslation}px, 0, 0)`;

            if (dragTimeoutRef.current) {
                clearTimeout(dragTimeoutRef.current);
            }

            dragTimeoutRef.current = setTimeout(() => {
                dragTimeoutRef.current = null;
                if (!isMountedRef.current) return;

                tabElements.forEach((el) => {
                    el.style.transform = '';
                    el.style.transition = '';
                    el.style.zIndex = '';
                });

                if (targetTabId !== draggedTabId && setTabs) {
                    setTabs(prev => {
                        const idx1 = prev.findIndex(t => t.id === draggedTabId);
                        const idx2 = prev.findIndex(t => t.id === targetTabId);
                        if (idx1 === -1 || idx2 === -1 || idx1 === idx2) return prev;

                        const newTabs = [...prev];
                        const [movedTab] = newTabs.splice(idx1, 1);
                        newTabs.splice(idx2, 0, movedTab);
                        return newTabs;
                    });
                }
            }, 200);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerCancel);
    };

    const platform = ipcRenderer?.platform;
    const isMac = platform === 'darwin';

    return (
        <div className="title-bar" style={{
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: isMac ? '76px' : '8px',
            paddingRight: isMac ? '8px' : '0px',
            WebkitAppRegion: 'drag',
            background: 'var(--background)',
            borderBottom: '1px solid var(--border)',
            justifyContent: 'space-between',
            userSelect: 'none',
            gap: '8px',
            boxSizing: 'border-box'
        } as React.CSSProperties} ref={menuRef}>
            <div style={{
                display: 'flex',
                gap: '4px',
                alignItems: 'center',
                height: '100%',
                flex: 1,
                minWidth: 0
            } as React.CSSProperties}>
                <img src="./icons/48x48.png" style={{ width: '20px', height: '20px', marginRight: '6px', flexShrink: 0 }}
                    alt="Logo" draggable="false" />

                {!isOnboarding && (
                    <>
                        <button
                            className={`nav-item ${activeView === 'home' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveView('home');
                            }}
                            style={{
                                width: '28px',
                                height: '28px',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '4px',
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s, color 0.2s',
                                WebkitAppRegion: 'no-drag',
                                flexShrink: 0
                            } as React.CSSProperties}
                        >
                            <Home size={18} />
                        </button>

                        {onOpenLocalTerminal && (
                            <button
                                className="nav-item"
                                onClick={() => {
                                    onOpenLocalTerminal();
                                }}
                                style={{
                                    width: '28px',
                                    height: '28px',
                                    padding: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '4px',
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                    transition: 'background-color 0.2s, color 0.2s',
                                    WebkitAppRegion: 'no-drag',
                                    flexShrink: 0
                                } as React.CSSProperties}
                            >
                                <Terminal size={18} />
                            </button>
                        )}

                        <button
                            className={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveView('settings');
                            }}
                            style={{
                                width: '28px',
                                height: '28px',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '4px',
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s, color 0.2s',
                                WebkitAppRegion: 'no-drag',
                                position: 'relative',
                                flexShrink: 0
                            } as React.CSSProperties}
                        >
                            <Settings size={18} />
                            {hasUpdate && (
                                <span style={{
                                    position: 'absolute',
                                    top: '2px',
                                    right: '2px',
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    backgroundColor: '#EFC55A',
                                    pointerEvents: 'none'
                                }} />
                            )}
                        </button>

                        <button
                            className={`nav-item ${activeView === 'support' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveView('support');
                            }}
                            style={{
                                width: '28px',
                                height: '28px',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '4px',
                                background: 'transparent',
                                border: 'none',
                                color: activeView === 'support' ? '#ef4444' : 'var(--text-primary)',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s, color 0.2s',
                                WebkitAppRegion: 'no-drag',
                                flexShrink: 0
                            } as React.CSSProperties}
                        >
                            <Heart size={18} fill={activeView === 'support' ? 'currentColor' : 'none'} />
                        </button>
                    </>
                )}

                <div style={{ width: '1px', height: '16px', background: 'var(--border)', margin: '0 6px', display: isOnboarding ? 'none' : 'block', flexShrink: 0 }} />

                {!isOnboarding && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0, height: '100%' }}>
                        <div
                            ref={tabsContainerRef}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', overflowX: 'auto', paddingBottom: '0', height: '100%', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                            className="no-scrollbar"
                        >
                            {connectionTabs.map((tab) => {
                                const isActive = activeView === 'tab' && activeTabId === tab.id;
                                const useActiveColor = isActive && appConfig?.activeTabColorEnabled;
                                const alwaysHover = !isActive && appConfig?.alwaysShowHoverOnInactiveTabs;
                                const isMcpTab = tab.type === 'mcp';

                                return (
                                    <div
                                        key={tab.id}
                                        className={`header-tab ${isActive ? 'active' : ''} ${alwaysHover ? 'always-hover' : ''} ${useActiveColor ? 'active-colored' : ''} ${isMcpTab && isActive ? 'mcp-tab-glow' : ''}`}
                                        onClick={() => {
                                            setActiveTabId(tab.id);
                                            setActiveView('tab');
                                        }}
                                        onPointerDown={(e) => handleTabPointerDown(e, tab)}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                            onTabContextMenu?.({ clientX: rect.left, clientY: rect.bottom }, tab);
                                        }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            padding: '0 10px',
                                            height: '28px',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            fontSize: '0.90rem',
                                            fontWeight: 400,
                                            background: useActiveColor ? 'var(--accent)' : (isActive || alwaysHover ? 'var(--hover-surface)' : 'transparent'),
                                            color: useActiveColor ? 'white' : (isActive ? 'var(--text-primary)' : 'var(--text-secondary)'),
                                            transition: 'background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',                                            whiteSpace: 'nowrap',
                                            minWidth: '48px',
                                            maxWidth: '500px',
                                            flexShrink: 1,
                                            flex: '0 1 auto',
                                            boxShadow: useActiveColor ? '0 2px 8px rgba(var(--accent-rgb), 0.3)' : 'none',
                                            position: 'relative',
                                            touchAction: 'none',
                                            WebkitAppRegion: 'no-drag'
                                        } as React.CSSProperties}
                                    >
                                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {tab.title}
                                        </span>
                                        <div className="tab-close-btn" onClick={(e) => { e.stopPropagation(); closeTab(e, tab.id); }} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: '14px',
                                            height: '14px',
                                            borderRadius: '3px',
                                            opacity: 0.6,
                                            flexShrink: 0
                                        }}>
                                            <X size={12} strokeWidth={2.5} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <button
                            className="add-tab-btn"
                            onClick={() => {
                                setActiveView('home');
                            }}
                            style={{
                                width: '28px',
                                height: '28px',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '4px',
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                WebkitAppRegion: 'no-drag',
                                flexShrink: 0
                            } as React.CSSProperties}
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                )}
                {isOnboarding && <div style={{ flex: 1 }} />}
            </div>

            {!isMac && (
                <div className="window-controls-container">
                    <button
                        className="window-control-btn"
                        onClick={(e) => {
                            (e.currentTarget as HTMLElement)?.blur();
                            ipcRenderer?.minimize?.();
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                            <line x1="3" y1="8" x2="13" y2="8" />
                        </svg>
                    </button>
                    <button
                        className="window-control-btn"
                        onClick={(e) => {
                            (e.currentTarget as HTMLElement)?.blur();
                            ipcRenderer?.maximize?.();
                        }}
                    >
                        {isMaximized ? (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <rect x="2.5" y="4.5" width="8" height="8" rx="2" />
                                <path d="M5.5 4.5V3a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 14.5 3v6a1.5 1.5 0 0 1-1.5 1.5H11.5" />
                            </svg>
                        ) : (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <rect x="3" y="3" width="10" height="10" rx="2.5" />
                            </svg>
                        )}
                    </button>
                    <button
                        className="window-control-btn close"
                        onClick={(e) => {
                            (e.currentTarget as HTMLElement)?.blur();
                            ipcRenderer?.close?.();
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                            <path d="M4 4l8 8M12 4l-8 8" />
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
});
