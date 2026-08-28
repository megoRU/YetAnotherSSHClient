import React from 'react';
import { Minus, Square, X, Home, Settings, Plus, Heart } from 'lucide-react';

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
    setTabs
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

    return (
        <div className="title-bar" style={{
            height: '56px',
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            WebkitAppRegion: 'drag',
            background: 'var(--background)',
            borderBottom: '1px solid var(--border)',
            justifyContent: 'space-between',
            userSelect: 'none',
            gap: '20px'
        } as React.CSSProperties} ref={menuRef}>
            <div style={{
                display: 'flex',
                gap: '4px',
                alignItems: 'center',
                height: '100%',
                flex: 1,
                minWidth: 0,
                paddingLeft: ipcRenderer?.platform === 'darwin' ? '70px' : '0'
            } as React.CSSProperties}>
                <img src="./icons/icon48.png" style={{ width: '24px', height: '24px', marginRight: '12px' }}
                    alt="Logo" draggable="false" />

                {!isOnboarding && (
                    <>
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
                                transition: 'background-color 0.2s, color 0.2s',
                                WebkitAppRegion: 'no-drag'
                            } as React.CSSProperties}
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
                                transition: 'background-color 0.2s, color 0.2s',
                                WebkitAppRegion: 'no-drag',
                                position: 'relative'
                            } as React.CSSProperties}
                        >
                            <Settings size={18} />
                            {hasUpdate && (
                                <span style={{
                                    position: 'absolute',
                                    top: '4px',
                                    right: '4px',
                                    width: '14px',
                                    height: '14px',
                                    borderRadius: '50%',
                                    backgroundColor: '#ef4444',
                                    color: '#ffffff',
                                    fontSize: '9px',
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
                                width: '36px',
                                height: '36px',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '8px',
                                background: 'transparent',
                                border: 'none',
                                color: activeView === 'support' ? '#ef4444' : 'var(--text-primary)',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s, color 0.2s',
                                WebkitAppRegion: 'no-drag'
                            } as React.CSSProperties}
                        >
                            <Heart size={18} fill={activeView === 'support' ? 'currentColor' : 'none'} />
                        </button>
                    </>
                )}


                <div style={{ width: '1px', height: '24px', background: 'var(--border)', margin: '0 8px', display: isOnboarding ? 'none' : 'block' }} />

                {!isOnboarding && (
                    <div style={{ display: 'flex', alignItems: 'stretch', gap: '4px', flex: 1, minWidth: 0 }}>
                        <div
                            ref={tabsContainerRef}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', overflowX: 'auto', paddingBottom: '2px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
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
                                        className={`header-tab ${isActive ? 'active' : ''} ${alwaysHover ? 'always-hover' : ''} ${useActiveColor ? 'active-colored' : ''} ${isMcpTab ? 'mcp-tab-glow' : ''}`}
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
                                            gap: '8px',
                                            padding: '0 10px',
                                            height: '32px',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            fontSize: '0.93rem',
                                            fontWeight: isActive ? 600 : 400,
                                            background: useActiveColor ? 'var(--accent)' : (isActive || alwaysHover ? 'var(--hover-surface)' : 'transparent'),
                                            color: useActiveColor ? 'white' : (isActive ? 'var(--text-primary)' : 'var(--text-secondary)'),
                                            border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                                            transition: 'background-color 0.2s, color 0.2s, border-color 0.2s, box-shadow 0.2s',
                                            whiteSpace: 'nowrap',
                                            minWidth: '40px',
                                            flexShrink: 1,
                                            boxShadow: useActiveColor ? '0 2px 8px rgba(var(--accent-rgb), 0.3)' : 'none',
                                            position: 'relative',
                                            touchAction: 'none',
                                            WebkitAppRegion: 'no-drag'
                                        } as React.CSSProperties}
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
                        <button
                            className="add-tab-btn"
                            onClick={() => setActiveView('home')}
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
                            } as React.CSSProperties}
                        >
                            <Plus size={16} />
                        </button>
                    </div>
                )}
                {isOnboarding && <div style={{ flex: 1 }} />}
            </div>

            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flexShrink: 0,
                WebkitAppRegion: 'no-drag'
            } as React.CSSProperties}>
                {ipcRenderer?.platform !== 'darwin' && (
                    <div style={{ display: 'flex', marginLeft: '8px' }}>
                        <div className="win-btn" onClick={() => ipcRenderer?.minimize?.()}
                            style={{
                                padding: '0 12px',
                                cursor: 'pointer',
                                height: '36px',
                                display: 'flex',
                                alignItems: 'center',
                                borderRadius: '6px'
                            }}>
                            <Minus size={16} /></div>
                        <div className="win-btn" onClick={() => ipcRenderer?.maximize?.()}
                            style={{
                                padding: '0 12px',
                                cursor: 'pointer',
                                height: '36px',
                                display: 'flex',
                                alignItems: 'center',
                                borderRadius: '6px'
                            }}>
                            <Square size={14} /></div>
                        <div className="win-btn close" onClick={() => ipcRenderer?.close?.()}
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
});
