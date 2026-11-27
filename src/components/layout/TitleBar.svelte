<script module lang="ts">
    import { House, Settings, Plus, Terminal, X } from '@lucide/svelte';

    import type { Tab, AppConfig } from '../../types';

    import { useUpdateChecker } from '../../hooks/useUpdateChecker.svelte';

    import { createI18n } from '../../utils/i18n';

    import { onMount } from 'svelte';

    import {
        activateOnKeydown,
        type CSSProperties,
        type ElementEvent,
        type RefObject,
        type SetStateAction,
        inlineStyle,
    } from '../../utils/dom';

    const { ipcRenderer } = window;

    const TITLEBAR_FOCUS_SELECTOR = '.window-control-btn, .nav-item, .add-tab-btn, .tab-close-btn';

    interface TitleBarProps {
        tabs: Tab[];
        activeTabId: string;
        activeView: 'home' | 'settings' | 'tab';
        theme: string;
        setActiveTabId: (id: string) => void;
        setActiveView: (view: 'home' | 'settings' | 'tab') => void;
        closeTab: (e: MouseEvent, id: string) => void;
        onTabContextMenu?: (e: MouseEvent | { clientX: number; clientY: number }, tab: Tab) => void;
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
</script>

<script lang="ts">
    let {
        tabs,
        activeTabId,
        activeView,
        theme,
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
        pendingMcpConnections = [],
    }: TitleBarProps = $props();

    const { isUpdateAvailable: hasUpdate } = $derived(updater);

    const isMountedRef = { current: true };

    const dragTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null> = { current: null };

    const activeDragIdRef: RefObject<string | null> = { current: null };

    const tabsContainerRef: RefObject<HTMLDivElement | null> = $state({ current: null });

    let isWindowFocused = $state.raw(document.hasFocus());

    let isMaximized = $state.raw(false);
    function setIsMaximized(next: SetStateAction<typeof isMaximized>) {
        isMaximized = typeof next === 'function' ? next(isMaximized) : next;
    }

    let isMinimizeHovered = $state.raw(false);
    function setIsMinimizeHovered(next: SetStateAction<typeof isMinimizeHovered>) {
        isMinimizeHovered = typeof next === 'function' ? next(isMinimizeHovered) : next;
    }

    let isCaptionHovered = $state.raw(false);
    function setIsCaptionHovered(next: SetStateAction<typeof isCaptionHovered>) {
        isCaptionHovered = typeof next === 'function' ? next(isCaptionHovered) : next;
    }

    let isCloseHovered = $state.raw(false);
    function setIsCloseHovered(next: SetStateAction<typeof isCloseHovered>) {
        isCloseHovered = typeof next === 'function' ? next(isCloseHovered) : next;
    }

    const { t } = $derived(createI18n(appConfig?.language ?? 'ru'));

    const getTabTitle = (tab: Tab): string => {
        if (!tab.config) return tab.title;
        const name = tab.config.name || `${tab.config.user}@${tab.config.host}`;
        if (tab.type === 'sftp') return t('tabs.sftp', { name });
        if (tab.type === 'ssh' && tab.subType === 'port-forwarding') {
            return `${t('forward.title')}: ${name}`;
        }
        return tab.title;
    };

    onMount(() => {
        isMountedRef.current = true;
        const unsub = ipcRenderer?.onWindowMaximizedState?.((maximized: boolean) => {
            if (isMountedRef.current) {
                setIsMaximized(maximized);
            }
        });

        // На Windows поверх кнопок окна лежит прозрачный нативный оверлей:
        // он открывает Snap Layouts, а сворачивание, развёртывание и закрытие
        // обрабатывает без зависимости от WebView. Rust сообщает UI о наведении,
        // чтобы сохранить подсветку.
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
            isWindowFocused = true;
            if (document.activeElement instanceof HTMLElement) {
                if (document.activeElement.matches(TITLEBAR_FOCUS_SELECTOR)) {
                    document.activeElement.blur();
                }
            }
        };
        const handleWindowBlur = () => {
            isWindowFocused = false;
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
    });

    const connectionTabs = $derived(tabs.filter((t) => t.type !== 'home' && t.type !== 'settings'));

    const handleTabPointerDown = (e: ElementEvent<PointerEvent, HTMLDivElement>, tab: Tab) => {
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
        let draggedIndex = connectionTabs.findIndex((t) => t.id === draggedTabId);
        let animationFrameId: number | null = null;

        const startDrag = () => {
            const container = tabsContainerRef.current;
            if (!container) return false;

            draggedIndex = connectionTabs.findIndex((t) => t.id === draggedTabId);
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
                    tabId: connectionTabs[i].id,
                };
            });

            if (draggedIndex >= initialTabsData.length) return false;

            draggedWidth = initialTabsData[draggedIndex].width;
            initialLeft = initialTabsData[draggedIndex].left;
            gap =
                initialTabsData.length > 1
                    ? initialTabsData[1].left - (initialTabsData[0].left + initialTabsData[0].width)
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

            const targetIndex = initialTabsData.findIndex((d) => d.tabId === targetTabId);
            let targetTranslation = 0;
            if (targetIndex !== -1 && targetIndex < draggedIndex) {
                targetTranslation = initialTabsData[targetIndex].left - initialLeft;
            } else if (targetIndex !== -1 && targetIndex > draggedIndex) {
                targetTranslation =
                    initialTabsData[targetIndex].left +
                    initialTabsData[targetIndex].width -
                    draggedWidth -
                    initialLeft;
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
                    setTabs((prev) => {
                        const idx1 = prev.findIndex((t) => t.id === draggedTabId);
                        const idx2 = prev.findIndex((t) => t.id === targetTabId);
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

    const isLinux = platform === 'linux';

    const DOUBLE_CLICK_BLOCKER = 'button, a, input, select, textarea, .header-tab, .tab-close-btn';

    const handleTitleBarDoubleClick = (event: ElementEvent<MouseEvent, HTMLDivElement>) => {
        if (isMac) return;
        if ((event.target as HTMLElement).closest(DOUBLE_CLICK_BLOCKER)) return;
        ipcRenderer?.maximize?.();
    };
</script>

<div
    role="presentation"
    class={`title-bar${isWindowFocused ? '' : ' inactive'}`}
    data-theme={theme}
    data-tauri-drag-region="deep"
    ondblclick={handleTitleBarDoubleClick}
    style={inlineStyle({
        height: isLinux ? 'var(--linux-titlebar-height, 40px)' : '40px',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: isMac ? '76px' : '8px',
        paddingRight: isLinux ? 'calc(var(--linux-caption-width, 132px) + 8px)' : isMac ? '8px' : '0px',
        WebkitAppRegion: 'drag',
        background: 'var(--background)',
        borderBottom: '1px solid var(--border)',
        justifyContent: 'space-between',
        userSelect: 'none',
        gap: '8px',
        boxSizing: 'border-box',
    } as CSSProperties)}
    bind:this={menuRef.current}
>
    <div style="display: flex; gap: 4px; align-items: center; height: 100%; flex: 1; min-width: 0">
        <img
            src="./icons/48x48.png"
            style="width: 20px; height: 20px; margin-right: 6px; flex-shrink: 0"
            alt="Logo"
            draggable="false"
        />

        {#if !isOnboarding}
            <button
                class={`nav-item ${activeView === 'home' ? 'active' : ''}`}
                onclick={() => {
                    setActiveView('home');
                }}
                style="width: 28px; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 4px; background: transparent; border: none; color: var(--text-primary); cursor: pointer; transition: background-color 0.2s, color 0.2s; -webkit-app-region: no-drag; flex-shrink: 0"
            >
                <House size={18} />
            </button>

            {#if onOpenLocalTerminal}<button
                    class="nav-item"
                    onclick={() => {
                        onOpenLocalTerminal();
                    }}
                    style="width: 28px; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 4px; background: transparent; border: none; color: var(--text-primary); cursor: pointer; transition: background-color 0.2s, color 0.2s; -webkit-app-region: no-drag; flex-shrink: 0"
                >
                    <Terminal size={18} />
                </button>{/if}

            <button
                class={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
                onclick={() => {
                    setActiveView('settings');
                }}
                style="width: 28px; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 4px; background: transparent; border: none; color: var(--text-primary); cursor: pointer; transition: background-color 0.2s, color 0.2s; -webkit-app-region: no-drag; position: relative; flex-shrink: 0"
            >
                <Settings size={18} />
                {#if hasUpdate}<span
                        style="position: absolute; top: 2px; right: 2px; width: 8px; height: 8px; border-radius: 50%; background-color: #EFC55A; pointer-events: none"
                    ></span>{/if}
            </button>
        {/if}

        <div
            style={inlineStyle({
                width: '1px',
                height: '16px',
                background: 'var(--border)',
                margin: '0 6px',
                display: isOnboarding ? 'none' : 'block',
                flexShrink: 0,
            })}
        ></div>

        {#if !isOnboarding}<div
                style="display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; height: 100%"
            >
                <div
                    role="tablist"
                    aria-label={t('settings.tabs')}
                    bind:this={tabsContainerRef.current}
                    data-tauri-drag-region="false"
                    style="display: flex; align-items: center; gap: 4px; overflow-x: auto; padding-bottom: 0; height: 100%; -webkit-app-region: no-drag"
                    class="no-scrollbar"
                >
                    {#each connectionTabs as tab (tab.id)}{@const isActive =
                            activeView === 'tab' && activeTabId === tab.id}{@const useActiveColor =
                            isActive && appConfig?.activeTabColorEnabled}{@const alwaysHover =
                            !isActive && appConfig?.alwaysShowHoverOnInactiveTabs}{@const isMcpTab =
                            tab.type === 'mcp'}{@const mcpConnectionId = isMcpTab
                            ? tab.config?.id
                            : undefined}{@const pendingConfirmation =
                            !isActive &&
                            mcpConnectionId !== undefined &&
                            pendingMcpConnections.includes(mcpConnectionId)}
                        {@const selectTab = () => {
                            setActiveTabId(tab.id);
                            setActiveView('tab');
                        }}
                        <div
                            role="tab"
                            aria-selected={isActive}
                            tabindex={0}
                            data-tauri-drag-region="false"
                            class={`header-tab ${isActive ? 'active' : ''} ${alwaysHover ? 'always-hover' : ''} ${useActiveColor ? 'active-colored' : ''} ${isMcpTab && isActive ? 'mcp-tab-glow' : ''} ${pendingConfirmation ? 'pending-confirmation' : ''}`}
                            onclick={selectTab}
                            onkeydown={(event) => activateOnKeydown(event, selectTab)}
                            onpointerdown={(e) => handleTabPointerDown(e, tab)}
                            oncontextmenu={(e) => {
                                e.preventDefault();
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                onTabContextMenu?.({ clientX: rect.left, clientY: rect.bottom }, tab);
                            }}
                            style={inlineStyle({
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '0 10px',
                                height: '28px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: 'calc(var(--font-size-base) - 1px)',
                                fontWeight: 400,
                                background: useActiveColor
                                    ? 'var(--accent)'
                                    : isActive || alwaysHover
                                      ? 'var(--hover-surface)'
                                      : 'transparent',
                                color: useActiveColor
                                    ? 'white'
                                    : isActive
                                      ? 'var(--text-primary)'
                                      : 'var(--text-secondary)',
                                whiteSpace: 'nowrap',
                                minWidth: '48px',
                                maxWidth: '500px',
                                flexShrink: 1,
                                flex: '0 1 auto',
                                boxShadow: useActiveColor ? '0 2px 8px rgba(var(--accent-rgb), 0.3)' : 'none',
                                position: 'relative',
                                touchAction: 'none',
                                WebkitAppRegion: 'no-drag',
                            } as CSSProperties)}
                        >
                            <span style="flex: 1; overflow: hidden; text-overflow: ellipsis">
                                {getTabTitle(tab)}
                            </span>
                            <button
                                type="button"
                                aria-label={t('settings.closeTab', { name: getTabTitle(tab) })}
                                class="plain-button tab-close-btn"
                                onclick={(e) => {
                                    e.stopPropagation();
                                    closeTab(e, tab.id);
                                }}
                                style="display: flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 3px; opacity: 0.6; flex-shrink: 0"
                            >
                                <X size={12} strokeWidth={2.5} />
                            </button>
                        </div>{/each}
                </div>
                <button
                    class="add-tab-btn"
                    onclick={() => {
                        setActiveView('home');
                    }}
                    style="width: 28px; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 4px; background: transparent; border: none; color: var(--text-secondary); cursor: pointer; -webkit-app-region: no-drag; flex-shrink: 0"
                >
                    <Plus size={18} />
                </button>
            </div>{/if}
        {#if isOnboarding}<div style="flex: 1"></div>{/if}
    </div>

    {#if !isMac && !isLinux}<div class="window-controls-container" data-tauri-drag-region="false">
            <button
                class={`window-control-btn${isMinimizeHovered ? ' hovered' : ''}`}
                title={t('window.minimize')}
                aria-label={t('window.minimize')}
                onclick={(e) => {
                    (e.currentTarget as HTMLElement)?.blur();
                    ipcRenderer?.minimize?.();
                }}
            >
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1"
                    aria-hidden="true"
                >
                    <line x1="3.5" y1="8.5" x2="12.5" y2="8.5"></line>
                </svg>
            </button>
            <button
                class={`window-control-btn${isCaptionHovered ? ' hovered' : ''}`}
                title={t(isMaximized ? 'window.restore' : 'window.maximize')}
                aria-label={t(isMaximized ? 'window.restore' : 'window.maximize')}
                aria-pressed={isMaximized}
                onclick={(e) => {
                    (e.currentTarget as HTMLElement)?.blur();
                    ipcRenderer?.maximize?.();
                }}
            >
                {#if isMaximized}<svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1"
                    >
                        <!-- заднее окно -->
                        <path d="M6 3.5H12C12.28 3.5 12.5 3.72 12.5 4V10"></path>

                        <!-- переднее окно -->
                        <rect x="3" y="6" width="7" height="6"></rect>
                    </svg>{:else}<svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1"
                    >
                        <rect x="3" y="3" width="10" height="10" rx="1"></rect>
                    </svg>{/if}
            </button>
            <button
                class={`window-control-btn close${isCloseHovered ? ' hovered' : ''}`}
                title={t('window.close')}
                aria-label={t('window.close')}
                onclick={(e) => {
                    (e.currentTarget as HTMLElement)?.blur();
                    ipcRenderer?.close?.();
                }}
            >
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1"
                    aria-hidden="true"
                >
                    <path d="M3 3l10 10M13 3l-10 10"></path>
                </svg>
            </button>
        </div>{/if}
</div>
