import React, { type FC, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject, type CSSProperties } from 'react';
import { Home, Settings, Plus, Terminal, X } from 'lucide-react';

import type { Tab, AppConfig } from '../../types';
import { useUpdateChecker } from '../../hooks/useUpdateChecker';
import { useI18n } from '../../utils/i18n';

const { ipcRenderer } = window;

const TITLEBAR_FOCUS_SELECTOR = '.window-control-btn, .nav-item, .add-tab-btn, .tab-close-btn';

interface TitleBarProps {
    tabs: Tab[];
    activeTabId: string;
    activeView: 'home' | 'settings' | 'tab';
    setActiveTabId: (id: string) => void;
    setActiveView: (view: 'home' | 'settings' | 'tab') => void;
    closeTab: (e: MouseEvent, id: string) => void;
    onTabContextMenu?: (e: MouseEvent | { clientX: number, clientY: number }, tab: Tab) => void;
    updater: ReturnType<typeof useUpdateChecker>;
    menuRef: RefObject<HTMLDivElement | null>;
    appConfig?: AppConfig;
    isOnboarding?: boolean;
    setTabs?: (updater: (prev: Tab[]) => Tab[]) => void;
    onOpenLocalTerminal?: () => void;
    /**
     * `connectionId` серверов с запросом MCP, ожидающим подтверждения: по ним
     * мигает неактивная MCP-вкладка, пока на неё не переключились.
     */
    pendingMcpConnections?: string[];
}

export const TitleBar: FC<TitleBarProps> = React.memo(({
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
    onOpenLocalTerminal,
    pendingMcpConnections = []
}) => {
    const { isUpdateAvailable: hasUpdate } = updater;
    const isMountedRef = React.useRef(true);
    const dragTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeDragIdRef = React.useRef<string | null>(null);
    const tabsContainerRef = React.useRef<HTMLDivElement | null>(null);
    const [isWindowFocused, setIsWindowFocused] = React.useState(() => document.hasFocus());
    const [isMaximized, setIsMaximized] = React.useState(false);
    const [isMinimizeHovered, setIsMinimizeHovered] = React.useState(false);
    const [isCaptionHovered, setIsCaptionHovered] = React.useState(false);
    const [isCloseHovered, setIsCloseHovered] = React.useState(false);
    const { t } = useI18n(appConfig?.language ?? 'ru');

    React.useEffect(() => {
        isMountedRef.current = true;
        const unsub = ipcRenderer?.onWindowMaximizedState?.((maximized: boolean) => {
            if (isMountedRef.current) {
                setIsMaximized(maximized);
            }
        });

        // На Windows поверх кнопок окна лежит прозрачный нативный оверлей:
        // он открывает Snap Layouts, а сворачивание, развёртывание и закрытие
        // обрабатывает без зависимости от WebView. Rust сообщает UI о наведении,
        // чтобы сохранить подсветку. На macOS и Linux работает обычный CSS.
        const unsubHover = ipcRenderer?.onWindowCaptionHover?.((hovering: boolean) => {
            if (isMountedRef.current) {
                setIsCaptionHovered(hovering);
            }
        });
        const unsubMinimizeHover = ipcRenderer?.onWindowMinimizeHover?.((hovering: boolean) => {
            if (isMountedRef.current) {
                setIsMinimizeHovered(hovering);
            }
        });
        const unsubCloseHover = ipcRenderer?.onWindowCloseHover?.((hovering: boolean) => {
            if (isMountedRef.current) {
                setIsCloseHovered(hovering);
            }
        });

        // Состояние развёртывания на старте берём не из события, а напрямую:
        // событие приходит из Rust при первом resize, а до него иконка кнопки
        // показывала бы «свёрнуто», даже если окно открылось уже развёрнутым.
        const readMaximized = ipcRenderer?.isMaximized;
        if (typeof readMaximized === 'function') {
            Promise.resolve(readMaximized())
                .then((value) => {
                    if (isMountedRef.current) setIsMaximized(value);
                })
                .catch(() => {});
        }

        const handleWindowFocus = () => {
            setIsWindowFocused(true);
            if (document.activeElement instanceof HTMLElement) {
                if (document.activeElement.matches(TITLEBAR_FOCUS_SELECTOR)) {
                    document.activeElement.blur();
                }
            }
        };
        const handleWindowBlur = () => {
            setIsWindowFocused(false);
            setIsMinimizeHovered(false);
            setIsCaptionHovered(false);
            setIsCloseHovered(false);
        };

        window.addEventListener('focus', handleWindowFocus);
        window.addEventListener('blur', handleWindowBlur);

        return () => {
            isMountedRef.current = false;
            if (unsub) unsub();
            if (unsubHover) unsubHover();
            if (unsubMinimizeHover) unsubMinimizeHover();
            if (unsubCloseHover) unsubCloseHover();
            if (dragTimeoutRef.current) {
                clearTimeout(dragTimeoutRef.current);
                dragTimeoutRef.current = null;
            }
            window.removeEventListener('focus', handleWindowFocus);
            window.removeEventListener('blur', handleWindowBlur);
        };
    }, []);

    const connectionTabs = tabs.filter(t => t.type !== 'home' && t.type !== 'settings');

    const handleTabPointerDown = (e: ReactPointerEvent<HTMLDivElement>, tab: Tab) => {
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

    /**
     * Элементы шапки, на которых двойной клик не должен разворачивать окно.
     *
     * Проверять приходится именно по самим элементам, а не по
     * `data-tauri-drag-region="false"`: контейнер вкладок помечен как
     * «перетаскивание запрещено», и под его метку попадает вся его пустая
     * область справа от последней вкладки — именно то место, где
     * пользователь обычно и кликает дважды.
     */
    const DOUBLE_CLICK_BLOCKER = 'button, a, input, select, textarea, .header-tab, .tab-close-btn';

    /**
     * Двойной клик по свободной области шапки разворачивает окно.
     *
     * У frameless-окна на Windows вся поверхность — клиентская область,
     * поэтому система не присылает `WM_NCLBUTTONDBLCLK`, и двойной клик
     * приходит в webview обычным DOM-событием. tao отправляет
     * `WM_NCLBUTTONDOWN` через `PostMessageW`, то есть асинхронно, —
     * событие доходит до webview.
     *
     * macOS исключён намеренно: там двойной клик по заголовку — системный
     * zoom, и переопределять его своей командой нельзя.
     */
    const handleTitleBarDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
        if (isMac) return;
        if ((event.target as HTMLElement).closest(DOUBLE_CLICK_BLOCKER)) return;
        ipcRenderer?.maximize?.();
    };

    return (
        // `data-tauri-drag-region` — механизм Tauri: `-webkit-app-region` ниже
        // остался от Electron и в WebView2/WebKitGTK/WKWebView ничего не делает.
        // `deep` разрешает перетаскивание за любую свободную область шапки;
        // интерактивные потомки помечены `false` и drag не запускают.
        // `onDoubleClick` — разворот по двойному клику, недоступный frameless-окну
        // от самой Windows.
        <div
            className={`title-bar${isWindowFocused ? '' : ' inactive'}`}
            data-tauri-drag-region="deep"
            onDoubleClick={handleTitleBarDoubleClick}
            style={{
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
            } as CSSProperties}
            ref={menuRef}
        >
            <div style={{
                display: 'flex',
                gap: '4px',
                alignItems: 'center',
                height: '100%',
                flex: 1,
                minWidth: 0
            } as CSSProperties}>
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
                            } as CSSProperties}
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
                                } as CSSProperties}
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
                            } as CSSProperties}
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

                    </>
                )}

                <div style={{ width: '1px', height: '16px', background: 'var(--border)', margin: '0 6px', display: isOnboarding ? 'none' : 'block', flexShrink: 0 }} />

                {!isOnboarding && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0, height: '100%' }}>
                        <div
                            ref={tabsContainerRef}
                            data-tauri-drag-region="false"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', overflowX: 'auto', paddingBottom: '0', height: '100%', WebkitAppRegion: 'no-drag' } as CSSProperties}
                            className="no-scrollbar"
                        >
                            {connectionTabs.map((tab) => {
                                const isActive = activeView === 'tab' && activeTabId === tab.id;
                                const useActiveColor = isActive && appConfig?.activeTabColorEnabled;
                                const alwaysHover = !isActive && appConfig?.alwaysShowHoverOnInactiveTabs;
                                const isMcpTab = tab.type === 'mcp';
                                // Мигает только неактивная MCP-вкладка с
                                // ожидающим подтверждения запросом: после
                                // перехода на неё (или снятия запроса) — нет.
                                const mcpConnectionId = isMcpTab ? tab.config?.id : undefined;
                                const pendingConfirmation = !isActive
                                    && mcpConnectionId !== undefined
                                    && pendingMcpConnections.includes(mcpConnectionId);

                                return (
                                    <div
                                        key={tab.id}
                                        data-tauri-drag-region="false"
                                        className={`header-tab ${isActive ? 'active' : ''} ${alwaysHover ? 'always-hover' : ''} ${useActiveColor ? 'active-colored' : ''} ${isMcpTab && isActive ? 'mcp-tab-glow' : ''} ${pendingConfirmation ? 'pending-confirmation' : ''}`}
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
                                            fontSize: 'calc(var(--font-size-base) - 1px)',
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
                                        } as CSSProperties}
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
                            } as CSSProperties}
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                )}
                {isOnboarding && <div style={{ flex: 1 }} />}
            </div>

            {!isMac && (
                // Глифы повторяют системные caption-кнопки Windows: footprint 10×10
                // в сетке 16×16, штрих 1px, прямые углы и прямые торцы линий.
                // Округлённые углы и штрих 1.75 выглядели как иконка в кнопке,
                // а не как часть окна. Размер и форма заданы в App.css.
                <div className="window-controls-container" data-tauri-drag-region="false">
                    <button
                        className={`window-control-btn${isMinimizeHovered ? ' hovered' : ''}`}
                        title={t('window.minimize')}
                        aria-label={t('window.minimize')}
                        onClick={(e) => {
                            (e.currentTarget as HTMLElement)?.blur();
                            ipcRenderer?.minimize?.();
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
                            <line x1="3.5" y1="8.5" x2="12.5" y2="8.5" />
                        </svg>
                    </button>
                    <button
                        className={`window-control-btn${isCaptionHovered ? ' hovered' : ''}`}
                        title={t(isMaximized ? 'window.restore' : 'window.maximize')}
                        aria-label={t(isMaximized ? 'window.restore' : 'window.maximize')}
                        aria-pressed={isMaximized}
                        onClick={(e) => {
                            (e.currentTarget as HTMLElement)?.blur();
                            ipcRenderer?.maximize?.();
                        }}
                    >
                        {isMaximized ? (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1">
                                {/* заднее окно */}
                                <path d="M6 3.5H12C12.28 3.5 12.5 3.72 12.5 4V10" />

                                {/* переднее окно */}
                                <rect x="3" y="6" width="7" height="6" />
                            </svg>
                        ) : (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1">
                                <rect x="3" y="3" width="10" height="10" rx="1" />
                            </svg>
                        )}
                    </button>
                    <button
                        className={`window-control-btn close${isCloseHovered ? ' hovered' : ''}`}
                        title={t('window.close')}
                        aria-label={t('window.close')}
                        onClick={(e) => {
                            (e.currentTarget as HTMLElement)?.blur();
                            ipcRenderer?.close?.();
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
                            <path d="M3 3l10 10M13 3l-10 10" />
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
});
