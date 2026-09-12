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
    const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => {
        return () => {
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        };
    }, []);

    const connectionTabs = tabs.filter(t => t.type !== 'home' && t.type !== 'settings');

    const activeDragIdRef = React.useRef<string | null>(null);
    const tabsContainerRef = React.useRef<HTMLDivElement | null>(null);

    const handleTabPointerDown = (e: React.PointerEvent<HTMLDivElement>, tab: Tab, draggedIndex: number) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('.tab-close-btn')) return;

        e.preventDefault();
        handleMouseLeave();

        setActiveTabId(tab.id);
        setActiveView('tab');

        const container = tabsContainerRef.current;
        if (!container) return;

        const draggedElement = e.currentTarget;
        const containerRect = container.getBoundingClientRect();
        const tabElements = Array.from(container.querySelectorAll('.header-tab')) as HTMLElement[];

        // Measure and cache all tab positions
        const initialTabsData = tabElements.map((el) => {
            const rect = el.getBoundingClientRect();
            return {
                element: el,
                left: rect.left - containerRect.left,
                width: rect.width
            };
        });

        const draggedWidth = initialTabsData[draggedIndex].width;
        const initialLeft = initialTabsData[draggedIndex].left;
        const gap = initialTabsData.length > 1
            ? (initialTabsData[1].left - (initialTabsData[0].left + initialTabsData[0].width))
            : 4;

        const cursorOffsetWithinTab = e.clientX - draggedElement.getBoundingClientRect().left;

        activeDragIdRef.current = tab.id;
        draggedElement.setPointerCapture(e.pointerId);

        let currentX = e.clientX;
        let isDragging = true;
        let targetIndex = draggedIndex;
        let animationFrameId: number | null = null;

        // Disable standard text selection during drag
        document.body.style.userSelect = 'none';

        const handlePointerMove = (moveEvent: PointerEvent) => {
            if (!isDragging) return;
            currentX = moveEvent.clientX;

            if (animationFrameId === null) {
                animationFrameId = requestAnimationFrame(() => {
                    animationFrameId = null;
                    if (!isDragging) return;

                    // Compute current dragged tab position relative to container
                    let draggedLeft = currentX - containerRect.left - cursorOffsetWithinTab;
                    // Constrain
                    const minLeft = 0;
                    const maxLeft = containerRect.width - draggedWidth;
                    draggedLeft = Math.max(minLeft, Math.min(maxLeft, draggedLeft));

                    // Style the dragged element instantly with hardware-accelerated translate3d
                    draggedElement.style.transform = `translate3d(${draggedLeft - initialLeft}px, 0, 0)`;
                    draggedElement.style.zIndex = '10';
                    draggedElement.style.transition = 'none';

                    // Compute targetIndex dynamically supporting tabs of different sizes flawlessly
                    let nextTargetIndex = draggedIndex;

                    for (let i = 0; i < initialTabsData.length; i++) {
                        if (i === draggedIndex) continue;
                        const neighbor = initialTabsData[i];
                        const neighborCenter = neighbor.left + neighbor.width / 2;

                        if (i < draggedIndex) {
                            // Dragging left: trigger swap when dragged tab's left edge crosses neighbor's midpoint
                            if (draggedLeft < neighborCenter) {
                                nextTargetIndex = Math.min(nextTargetIndex, i);
                            }
                        } else {
                            // Dragging right: trigger swap when dragged tab's right edge crosses neighbor's midpoint
                            if (draggedLeft + draggedWidth > neighborCenter) {
                                nextTargetIndex = Math.max(nextTargetIndex, i);
                            }
                        }
                    }

                    targetIndex = nextTargetIndex;

                    // Style neighbors smoothly sliding them to make room
                    for (let i = 0; i < initialTabsData.length; i++) {
                        if (i === draggedIndex) continue;
                        const neighbor = initialTabsData[i];
                        let shift = 0;

                        if (i < draggedIndex && i >= targetIndex) {
                            shift = draggedWidth + gap;
                        } else if (i > draggedIndex && i <= targetIndex) {
                            shift = -(draggedWidth + gap);
                        }

                        neighbor.element.style.transform = `translate3d(${shift}px, 0, 0)`;
                        neighbor.element.style.transition = 'transform 0.2s cubic-bezier(0.2, 1, 0.2, 1)';
                    }
                });
            }
        };

        const handlePointerUp = (upEvent: PointerEvent) => {
            isDragging = false;
            activeDragIdRef.current = null;
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }

            // Clean up event listeners and pointer capture
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);
            try {
                draggedElement.releasePointerCapture(upEvent.pointerId);
            } catch {
                // ignore
            }

            // Restore user selection
            document.body.style.userSelect = '';

            // Compute target translation to land smoothly in the final slot
            let targetTranslation = 0;
            if (targetIndex < draggedIndex) {
                targetTranslation = initialTabsData[targetIndex].left - initialLeft;
            } else if (targetIndex > draggedIndex) {
                targetTranslation = (initialTabsData[targetIndex].left + initialTabsData[targetIndex].width - draggedWidth) - initialLeft;
            }

            // Smoothly animate the dragged tab to its landing position
            draggedElement.style.transition = 'transform 0.2s cubic-bezier(0.2, 1, 0.2, 1)';
            draggedElement.style.transform = `translate3d(${targetTranslation}px, 0, 0)`;

            // Wait for transition to complete, then update React state
            setTimeout(() => {
                // Clear inline styles for all elements
                tabElements.forEach((el) => {
                    el.style.transform = '';
                    el.style.transition = '';
                    el.style.zIndex = '';
                });

                // Update React state if index changed
                if (targetIndex !== draggedIndex && setTabs) {
                    const fromId = connectionTabs[draggedIndex].id;
                    const toId = connectionTabs[targetIndex].id;

                    setTabs(prev => {
                        const idx1 = prev.findIndex(t => t.id === fromId);
                        const idx2 = prev.findIndex(t => t.id === toId);
                        if (idx1 === -1 || idx2 === -1) return prev;

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
        window.addEventListener('pointercancel', handlePointerUp);
    };

    const handleMouseEnter = (e: React.MouseEvent, tab: Tab) => {
        if (!onTabContextMenu || activeDragIdRef.current) return;

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = rect.left;
        const y = rect.bottom;

        hoverTimerRef.current = setTimeout(() => {
            onTabContextMenu({ clientX: x, clientY: y }, tab);
        }, 1000);
    };

    const handleMouseLeave = () => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
    };

    const platform = ipcRenderer?.platform;
    const isMac = platform === 'darwin';
    const isWin = platform === 'win32';
    const showCustomControls = !isMac && !isWin;

    const [isMaximized, setIsMaximized] = React.useState(false);

    React.useEffect(() => {
        if (showCustomControls && ipcRenderer?.onWindowMaximizedState) {
            const unsub = ipcRenderer.onWindowMaximizedState((maximized: boolean) => {
                setIsMaximized(maximized);
            });
            return () => {
                if (typeof unsub === 'function') unsub();
            };
        }
    }, [showCustomControls]);

    const rightPadding = isMac
        ? '8px'
        : isWin
            ? 'calc(100vw - env(titlebar-area-right, calc(100vw - 138px)))'
            : '0px';

    return (
        <div className="title-bar" style={{
            height: '38px',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: '8px',
            paddingRight: rightPadding,
            WebkitAppRegion: 'drag',
            background: 'var(--background)',
            borderBottom: '1px solid var(--border)',
            justifyContent: 'space-between',
            userSelect: 'none',
            gap: '8px'
        } as React.CSSProperties} ref={menuRef}>
            <div style={{
                display: 'flex',
                gap: '2px',
                alignItems: 'center',
                height: '100%',
                flex: 1,
                minWidth: 0,
                paddingLeft: isMac ? '68px' : '0'
            } as React.CSSProperties}>
                <img src="./icons/48x48.png" style={{ width: '20px', height: '20px', marginRight: '6px' }}
                    alt="Logo" draggable="false" />

                {!isOnboarding && (
                    <>
                        <button
                            className={`nav-item ${activeView === 'home' ? 'active' : ''}`}
                            onClick={() => setActiveView('home')}
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
                                WebkitAppRegion: 'no-drag'
                            } as React.CSSProperties}
                        >
                            <Home size={17} />
                        </button>

                        {onOpenLocalTerminal && (
                            <button
                                className="nav-item"
                                onClick={onOpenLocalTerminal}
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
                                    WebkitAppRegion: 'no-drag'
                                } as React.CSSProperties}
                            >
                                <Terminal size={17} />
                            </button>
                        )}

                        <button
                            className={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
                            onClick={() => setActiveView('settings')}
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
                                position: 'relative'
                            } as React.CSSProperties}
                        >
                            <Settings size={17} />
                            {hasUpdate && (
                                <span style={{
                                    position: 'absolute',
                                    top: '2px',
                                    right: '2px',
                                    width: '10px',
                                    height: '10px',
                                    borderRadius: '50%',
                                    backgroundColor: '#ef4444',
                                    color: '#ffffff',
                                    fontSize: '8px',
                                    fontWeight: 700,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    lineHeight: 1,
                                    pointerEvents: 'none'
                                }}>
                                    1
                                </span>
                            )}
                        </button>

                        <button
                            className={`nav-item ${activeView === 'support' ? 'active' : ''}`}
                            onClick={() => setActiveView('support')}
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
                                WebkitAppRegion: 'no-drag'
                            } as React.CSSProperties}
                        >
                            <Heart size={17} fill={activeView === 'support' ? 'currentColor' : 'none'} />
                        </button>
                    </>
                )}

                <div style={{ width: '1px', height: '16px', background: 'var(--border)', margin: '0 4px', display: isOnboarding ? 'none' : 'block' }} />

                {!isOnboarding && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flex: 1, minWidth: 0, height: '100%' }}>
                        <div
                            ref={tabsContainerRef}
                            style={{ display: 'flex', alignItems: 'center', gap: '3px', overflowX: 'auto', paddingBottom: '0', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                            className="no-scrollbar"
                        >
                            {connectionTabs.map((tab, index) => {
                                const isActive = activeView === 'tab' && activeTabId === tab.id;
                                const useActiveColor = isActive && appConfig?.activeTabColorEnabled;
                                const alwaysHover = !isActive && appConfig?.alwaysShowHoverOnInactiveTabs;
                                const isMcpTab = tab.type === 'mcp';

                                return (
                                    <div
                                        key={tab.id}
                                        className={`header-tab ${isActive ? 'active' : ''} ${alwaysHover ? 'always-hover' : ''} ${useActiveColor ? 'active-colored' : ''} ${isMcpTab && isActive ? 'mcp-tab-glow' : ''}`}
                                        onClick={() => {
                                            handleMouseLeave();
                                            setActiveTabId(tab.id);
                                            setActiveView('tab');
                                        }}
                                        onPointerDown={(e) => handleTabPointerDown(e, tab, index)}
                                        onMouseEnter={(e) => handleMouseEnter(e, tab)}
                                        onMouseLeave={handleMouseLeave}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            handleMouseLeave();
                                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                            onTabContextMenu?.({ clientX: rect.left, clientY: rect.bottom }, tab);
                                        }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            padding: '0 10px',
                                            height: '26px',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            fontSize: '0.82rem',
                                            fontWeight: 500,
                                            background: useActiveColor ? 'var(--accent)' : (isActive || alwaysHover ? 'var(--hover-surface)' : 'transparent'),
                                            color: useActiveColor ? 'white' : (isActive ? 'var(--text-primary)' : 'var(--text-secondary)'),
                                            border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                                            transition: 'background-color 0.2s, color 0.2s, border-color 0.2s, box-shadow 0.2s',
                                            whiteSpace: 'nowrap',
                                            minWidth: '48px',
                                            maxWidth: '170px',
                                            flexShrink: 1,
                                            flex: '1 1 auto',
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
                                            width: '12px',
                                            height: '12px',
                                            borderRadius: '3px',
                                            opacity: 0.6,
                                            flexShrink: 0
                                        }}>
                                            <X size={10} strokeWidth={2.5} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <button
                            className="add-tab-btn"
                            onClick={() => setActiveView('home')}
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
                            <Plus size={17} />
                        </button>
                    </div>
                )}
                {isOnboarding && <div style={{ flex: 1 }} />}

                {showCustomControls && (
                    <div className="window-controls-container">
                        <button
                            className="window-control-btn"
                            onClick={() => ipcRenderer?.minimize?.()}
                            title="Minimize"
                        >
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M4 10H16" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                            </svg>
                        </button>
                        <button
                            className="window-control-btn"
                            onClick={() => ipcRenderer?.maximize?.()}
                            title={isMaximized ? "Restore" : "Maximize"}
                        >
                            {isMaximized ? (
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M6.5 6.5V4.5H15.5V13.5H13.5M4.5 6.5H13.5V15.5H4.5V6.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                                </svg>
                            ) : (
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <rect x="4.5" y="4.5" width="11" height="11" stroke="currentColor" strokeWidth="1.2" rx="1" />
                                </svg>
                            )}
                        </button>
                        <button
                            className="window-control-btn close"
                            onClick={() => ipcRenderer?.close?.()}
                            title="Close"
                        >
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                            </svg>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
});
