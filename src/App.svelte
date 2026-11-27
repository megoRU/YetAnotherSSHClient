<script module lang="ts">
    import TerminalComponent from './components/Terminal.svelte';

    import LocalTerminalComponent from './components/LocalTerminal.svelte';

    import SFTPBrowser from './components/SFTPBrowser.svelte';

    import ConnectionForm from './components/ConnectionForm.svelte';

    import ContextMenu from './components/layout/ContextMenu.svelte';

    import { Pen, File, Folder, CircleSlash, Play, Trash2, Share2, Copy, Terminal, Bot } from '@lucide/svelte';

    import McpTab from './components/McpTab.svelte';

    import TitleBar from './components/layout/TitleBar.svelte';

    import Sidebar from './components/layout/Sidebar.svelte';

    import HomeView from './components/views/HomeView.svelte';

    import SettingsView from './components/views/SettingsView.svelte';

    import PortForwardingView from './components/views/PortForwardingView.svelte';

    import OnboardingView from './components/views/OnboardingView.svelte';

    import RecoveryKeyModal from './components/modals/RecoveryKeyModal.svelte';

    import VaultUnlockModal from './components/modals/VaultUnlockModal.svelte';

    import DeleteServerModal from './components/modals/DeleteServerModal.svelte';

    import NotificationModal from './components/modals/NotificationModal.svelte';

    import ToastNotification from './components/modals/ToastNotification.svelte';

    import type { SessionCredentials } from './ipc';

    import { useConfig } from './hooks/useConfig.svelte';

    import { createI18n } from './utils/i18n';

    import { useTabs } from './hooks/useTabs.svelte';

    import { useSystemFonts } from './hooks/useSystemFonts';

    import { useUpdateChecker } from './hooks/useUpdateChecker.svelte';

    import { useGlobalShortcuts } from './hooks/useGlobalShortcuts.svelte';

    import { shortcutMatchers } from './utils/shortcuts';

    import type {
        AppConfig,
        EncryptedSecret,
        McpStatus,
        NotificationAction,
        SSHConfig,
        NotificationType,
        Tab,
    } from './types';

    import { generateId, upsertFavorite } from './utils';

    import './styles/light.css';

    import './styles/dark.css';

    import './styles/gruvbox-light.css';

    import './styles/gruvbox-dark.css';

    import './styles/windows-terminal.css';

    import './App.css';

    import { onMount, untrack } from 'svelte';

    import { type MenuIcon, type RefObject, type SetStateAction, inlineStyle } from './utils/dom';

    const { ipcRenderer } = window;

    const FONT_LOAD_EMERGENCY_TIMEOUT_MS = 1000;

    const CRITICAL_FONT_FACES = [
        { family: 'Inter', weight: 400 },
        { family: 'Inter', weight: 500 },
        { family: 'Inter', weight: 700 },
        { family: 'JetBrains Mono', weight: 400 },
        { family: 'JetBrains Mono', weight: 500 },
        { family: 'JetBrains Mono', weight: 700 },
    ] as const;

    async function notifyContentReady(
        rendererContentReady: () => void,
        isCancelled: () => boolean,
    ): Promise<void> {
        const fonts = typeof document !== 'undefined' ? document.fonts : undefined;

        if (fonts) {
            let timer = 0;
            const timeout = new Promise<void>((resolve) => {
                timer = window.setTimeout(resolve, FONT_LOAD_EMERGENCY_TIMEOUT_MS);
            });

            try {
                await Promise.race([
                    Promise.all(
                        CRITICAL_FONT_FACES.map(({ family, weight }) => fonts.load(`${weight} 14px "${family}"`)),
                    ).then(() => {
                        const missingFaces = CRITICAL_FONT_FACES.filter(
                            ({ family, weight }) => !fonts.check(`${weight} 14px "${family}"`),
                        );
                        if (missingFaces.length > 0) {
                            console.warn('Critical startup fonts are unavailable:', missingFaces);
                        }
                    }),
                    timeout,
                ]);
            } catch {
                /* Шрифты не загрузились — показываем окно с системным fallback. */
            } finally {
                window.clearTimeout(timer);
            }
        }

        if (isCancelled()) {
            return;
        }

        rendererContentReady();
    }
</script>

<script lang="ts">
    const appSettings = useConfig();

    const { t } = $derived(createI18n(appSettings.config?.language || 'ru'));

    const systemFonts = useSystemFonts();

    const updater = useUpdateChecker();

    let searchQuery = $state.raw('');
    function setSearchQuery(next: SetStateAction<typeof searchQuery>) {
        searchQuery = typeof next === 'function' ? next(searchQuery) : next;
    }

    let activeView = $state.raw<'home' | 'settings' | 'tab'>('home');
    function setActiveView(next: SetStateAction<'home' | 'settings' | 'tab'>) {
        activeView = typeof next === 'function' ? next(activeView) : next;
    }

    let activeTabIsAltScreen = $state.raw(false);
    function setActiveTabIsAltScreen(next: SetStateAction<typeof activeTabIsAltScreen>) {
        activeTabIsAltScreen = typeof next === 'function' ? next(activeTabIsAltScreen) : next;
    }

    let externalDrag = $state.raw<{
        items: Array<{ path: string; name: string; isDir: boolean; icon: string | null }>;
        x: number;
        y: number;
    } | null>(null);
    function setExternalDrag(
        next: SetStateAction<{
            items: Array<{ path: string; name: string; isDir: boolean; icon: string | null }>;
            x: number;
            y: number;
        } | null>,
    ) {
        externalDrag = typeof next === 'function' ? next(externalDrag) : next;
    }

    const externalDragSequence = { current: 0 };

    const sftpOutboundDragActive = { current: false };

    const tabsState = useTabs([]);

    onMount(() => {
        const handlePreview = (event: Event) => {
            if (sftpOutboundDragActive.current) return;
            const detail = (
                event as CustomEvent<{ paths: string[]; icons: Array<string | null>; x: number; y: number }>
            ).detail;
            const sequence = ++externalDragSequence.current;
            const initialItems = detail.paths.map((path, index) => ({
                path,
                name: path.split(/[\\/]/).filter(Boolean).pop() || path,
                isDir: false,
                icon: detail.icons[index] ?? null,
            }));
            setExternalDrag({
                items: initialItems,
                x: detail.x,
                y: detail.y,
            });
            void Promise.all(
                initialItems.map(async (item) => ({
                    ...item,
                    isDir: (await ipcRenderer?.fsStat?.(item.path))?.isDir ?? false,
                })),
            ).then((items) => {
                if (sequence !== externalDragSequence.current) return;
                const directoryFlags = new Map(items.map((item) => [item.path, item.isDir]));
                setExternalDrag((current) =>
                    current
                        ? {
                              ...current,
                              items: current.items.map((item) => ({
                                  ...item,
                                  isDir: directoryFlags.get(item.path) ?? item.isDir,
                              })),
                          }
                        : current,
                );
            });
        };
        const handleIcons = (event: Event) => {
            const { paths, icons } = (event as CustomEvent<{ paths: string[]; icons: Array<string | null> }>)
                .detail;
            setExternalDrag((current) => {
                if (
                    !current ||
                    current.items.length !== paths.length ||
                    !current.items.every((item, index) => item.path === paths[index])
                ) {
                    return current;
                }
                return {
                    ...current,
                    items: current.items.map((item, index) => ({ ...item, icon: icons[index] ?? null })),
                };
            });
        };
        const handlePosition = (event: Event) => {
            if (sftpOutboundDragActive.current) return;
            const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
            setExternalDrag((current) => (current ? { ...current, x, y } : current));
        };
        const handleDragState = (event: Event) => {
            if (sftpOutboundDragActive.current) return;
            if (!(event as CustomEvent<boolean>).detail) {
                externalDragSequence.current++;
                setExternalDrag(null);
            }
        };
        const handleSftpOutboundDragState = (event: Event) => {
            sftpOutboundDragActive.current = (event as CustomEvent<boolean>).detail;
            if (sftpOutboundDragActive.current) {
                externalDragSequence.current++;
                setExternalDrag(null);
            }
        };
        window.addEventListener('yash-files-drag-preview', handlePreview);
        window.addEventListener('yash-files-drag-icons', handleIcons);
        window.addEventListener('yash-files-drag-position', handlePosition);
        window.addEventListener('yash-files-drag-state', handleDragState);
        window.addEventListener('yash-sftp-outbound-drag-state', handleSftpOutboundDragState);
        return () => {
            window.removeEventListener('yash-files-drag-preview', handlePreview);
            window.removeEventListener('yash-files-drag-icons', handleIcons);
            window.removeEventListener('yash-files-drag-position', handlePosition);
            window.removeEventListener('yash-files-drag-state', handleDragState);
            window.removeEventListener('yash-sftp-outbound-drag-state', handleSftpOutboundDragState);
        };
    });

    const addTab = (
        type: 'home' | 'settings' | 'ssh' | 'connection' | 'sftp' | 'mcp' | 'local-terminal',
        title: string,
        sshConfig?: SSHConfig,
        subType?: string,
    ) => {
        if (type === 'home') {
            setActiveView('home');
            return;
        }
        if (type === 'settings') {
            setActiveView('settings');
            return;
        }
        tabsState.addTab(type, title, sshConfig, subType);
        setActiveView('tab');
    };

    const closeTab = (e?: MouseEvent | { stopPropagation?: () => void }, id?: string) => {
        tabsState.closeTab(e, id);
        if (tabsState.tabs.length <= 1) {
            setActiveView('home');
        }
    };

    const handleNextTab = () => {
        if (tabsState.tabs.length === 0) return;

        let nextIndex = 0;
        if (activeView === 'tab') {
            const currentIndex = tabsState.tabs.findIndex((t) => t.id === tabsState.activeTabId);
            if (currentIndex !== -1) {
                nextIndex = (currentIndex + 1) % tabsState.tabs.length;
            }
        }

        const targetTab = tabsState.tabs[nextIndex];
        if (targetTab) {
            tabsState.setActiveTabId(targetTab.id);
            setActiveView('tab');
        }
    };

    const handlePrevTab = () => {
        if (tabsState.tabs.length === 0) return;

        let prevIndex = tabsState.tabs.length - 1;
        if (activeView === 'tab') {
            const currentIndex = tabsState.tabs.findIndex((t) => t.id === tabsState.activeTabId);
            if (currentIndex !== -1) {
                prevIndex = (currentIndex - 1 + tabsState.tabs.length) % tabsState.tabs.length;
            }
        }

        const targetTab = tabsState.tabs[prevIndex];
        if (targetTab) {
            tabsState.setActiveTabId(targetTab.id);
            setActiveView('tab');
        }
    };

    const handleOpenLocalTerminal = () => {
        addTab('local-terminal', t('localTerminal.tabTitle'));
    };

    const handleCloseTabShortcut = () => {
        if (activeView === 'tab' && tabsState.activeTabId) {
            closeTab(undefined, tabsState.activeTabId);
        }
    };

    const globalShortcuts = $derived([
        {
            id: 'close-tab',
            name: 'Close Tab',
            match: shortcutMatchers.closeTab,
            handler: handleCloseTabShortcut,
            allowInInput: false,
        },
        {
            id: 'next-tab',
            name: 'Next Tab',
            match: shortcutMatchers.nextTab,
            handler: handleNextTab,
            allowInInput: false,
        },
        {
            id: 'prev-tab',
            name: 'Previous Tab',
            match: shortcutMatchers.prevTab,
            handler: handlePrevTab,
            allowInInput: false,
        },
    ]);

    useGlobalShortcuts(
        () => globalShortcuts,
        () => ({ isAltScreen: activeTabIsAltScreen }),
    );

    $effect(() => {
        void [tabsState.setTabs, t];
        return untrack(() => {
            const connectionTitle = t('tabs.connection');
            tabsState.setTabs((prev) => {
                const needsUpdate = prev.some(
                    (tab) => tab.type === 'connection' && !tab.config && tab.title !== connectionTitle,
                );

                if (!needsUpdate) return prev;

                return prev.map((tab) => {
                    if (tab.type === 'connection' && !tab.config && tab.title !== connectionTitle) {
                        return { ...tab, title: connectionTitle };
                    }
                    return tab;
                });
            });
        });
    });

    let serverToDelete = $state.raw<SSHConfig | null>(null);

    let vaultStatus = $state.raw<{ isUnlocked: boolean; isInitialized: boolean; secretsAvailable: boolean }>({
        isUnlocked: true,
        isInitialized: false,
        secretsAvailable: true,
    });
    function setVaultStatus(
        next: SetStateAction<{ isUnlocked: boolean; isInitialized: boolean; secretsAvailable: boolean }>,
    ) {
        vaultStatus = typeof next === 'function' ? next(vaultStatus) : next;
    }

    let recoveryKeyToShow = $state.raw<string | null>(null);
    function setRecoveryKeyModal(next: SetStateAction<string | null>) {
        recoveryKeyToShow = typeof next === 'function' ? next(recoveryKeyToShow) : next;
    }

    let notification = $state.raw<{
        title: string;
        message: string;
        type?: NotificationType;
        action?: NotificationAction;
    } | null>(null);

    let toast = $state.raw<{ message: string; type?: NotificationType } | null>(null);

    const showNotification = (
        title: string,
        message: string,
        type?: NotificationType,
        action?: NotificationAction,
    ) => {
        if (!action && type === 'success') {
            toast = { message, type };
        } else {
            notification = { title, message, type, action };
        }
    };

    let pendingMcpConnectionIds = $state.raw<string[]>([]);
    function setPendingMcpConnectionIds(next: SetStateAction<string[]>) {
        pendingMcpConnectionIds = typeof next === 'function' ? next(pendingMcpConnectionIds) : next;
    }

    const lastMcpStartupError: RefObject<string | null> = { current: null };

    onMount(() => {
        let statusEventRevision = 0;
        const handleStatus = (status: McpStatus) => {
            if (status.state === 'failed' && status.error) {
                if (lastMcpStartupError.current !== status.error) {
                    lastMcpStartupError.current = status.error;
                    toast = { message: status.error, type: 'error' };
                }
            } else {
                lastMcpStartupError.current = null;
            }

            const pending = status.pendingConfirmations;
            if (Array.isArray(pending)) {
                const nextIds = pending.map((req) => req.connectionId);
                setPendingMcpConnectionIds((prev) =>
                    prev.length === nextIds.length && prev.every((id, index) => id === nextIds[index])
                        ? prev
                        : nextIds,
                );
            }
        };

        const unsubscribe = ipcRenderer?.onMcpStatusChanged?.((status) => {
            statusEventRevision += 1;
            handleStatus(status);
        });
        if (ipcRenderer?.mcpGetStatus) {
            const revisionAtRequest = statusEventRevision;
            void ipcRenderer
                .mcpGetStatus()
                .then((status) => {
                    if (statusEventRevision === revisionAtRequest) handleStatus(status);
                })
                .catch((error) => {
                    console.error('[MCP] Failed to get status for startup notification:', error);
                });
        }
        return () => {
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    });

    $effect(() => {
        void [appSettings.config?.favorites, tabsState.setTabs];
        return untrack(() => {
            const unsubscribe = ipcRenderer?.onMcpRequestConfirmation?.((req) => {
                const server = appSettings.config?.favorites.find((fav) => fav.id === req.connectionId);
                if (!server?.id) return;
                const title = `MCP: ${server.name || `${server.user}@${server.host}`}`;
                tabsState.setTabs((prev) =>
                    prev.some((existing) => existing.type === 'mcp' && existing.config?.id === server.id)
                        ? prev
                        : [...prev, { id: generateId(), type: 'mcp', title, config: server }],
                );
            });
            return () => {
                if (typeof unsubscribe === 'function') unsubscribe();
            };
        });
    });

    let contextMenu = $state.raw<{
        x: number;
        y: number;
        options?: { label: string; icon?: MenuIcon; onClick: () => void; danger?: boolean }[];
        config?: SSHConfig;
    } | null>(null);

    $effect(() => {
        void [appSettings.config];
        return untrack(() => {
            if (!appSettings.config) {
                return;
            }

            if (!ipcRenderer || typeof ipcRenderer.rendererContentReady !== 'function') {
                return;
            }

            let firstAnimationFrameId = 0;
            let secondAnimationFrameId = 0;
            let cancelled = false;

            firstAnimationFrameId = window.requestAnimationFrame(() => {
                secondAnimationFrameId = window.requestAnimationFrame(() => {
                    void notifyContentReady(ipcRenderer.rendererContentReady, () => cancelled);
                });
            });

            return () => {
                cancelled = true;
                if (firstAnimationFrameId !== 0) {
                    window.cancelAnimationFrame(firstAnimationFrameId);
                }

                if (secondAnimationFrameId !== 0) {
                    window.cancelAnimationFrame(secondAnimationFrameId);
                }
            };
        });
    });

    const handleEditConnection = async (sshConfig: SSHConfig) => {
        const name = sshConfig.name || `${sshConfig.user}@${sshConfig.host}`;

        const editableConfig: SSHConfig = { ...sshConfig };
        if (sshConfig.id) {
            const [vaultPass, keyPassphrase] = await Promise.all([
                ipcRenderer?.vaultGetPassword?.(sshConfig.id),
                ipcRenderer?.vaultGetKeyPassphrase?.(sshConfig.id),
            ]);
            if (vaultPass) {
                editableConfig.password = vaultPass;
            } else {
                // Пустое поле при недоступном/закрытом хранилище не означает,
                // что сохранённый пароль нужно удалить. Отсутствующее поле
                // backend трактует как «секрет не менялся».
                delete editableConfig.password;
            }
            if (keyPassphrase) {
                editableConfig.keyPassphrase = keyPassphrase;
            } else {
                delete editableConfig.keyPassphrase;
            }
        }

        addTab('connection', t('tabs.editConnection', { name }), editableConfig);
    };

    const openMcpTab = (server: SSHConfig) => {
        const existing = server.id
            ? tabsState.tabs.find((tab) => tab.type === 'mcp' && tab.config?.id === server.id)
            : undefined;
        if (existing) {
            tabsState.setActiveTabId(existing.id);
            setActiveView('tab');
            return;
        }
        const name = server.name || `${server.user}@${server.host}`;
        addTab('mcp', `MCP: ${name}`, server);
    };

    const handleTabContextMenu = (e: MouseEvent | { clientX: number; clientY: number }, tab: Tab) => {
        if (!tab.config) return;

        const options = [];

        if (tab.type === 'mcp') {
            const name = tab.config.name || `${tab.config.user}@${tab.config.host}`;
            options.push({
                label: t('sftp.connectSsh'),
                icon: { component: Terminal, size: 14 },
                onClick: () => {
                    addTab('ssh', name, tab.config);
                },
            });
            options.push({
                label: t('sftp.openSftp'),
                icon: { component: Folder, size: 14 },
                onClick: () => {
                    addTab('sftp', t('tabs.sftp', { name }), tab.config);
                },
            });
            options.push({
                label: t('common.edit'),
                icon: { component: Pen, size: 14 },
                onClick: () => {
                    void handleEditConnection(tab.config!);
                },
            });

            contextMenu = {
                x: e.clientX,
                y: e.clientY,
                options,
            };
            return;
        }

        // Открыть SFTP / Подключиться по SSH / Открыть MCP
        if (tab.type === 'ssh') {
            options.push({
                label: t('sftp.openSftp'),
                icon: { component: Folder, size: 14 },
                onClick: () => {
                    const name = tab.config!.name || `${tab.config!.user}@${tab.config!.host}`;
                    addTab('sftp', t('tabs.sftp', { name }), tab.config);
                },
            });
            options.push({
                label: t('mcp.openForMcp'),
                icon: { component: Bot, size: 14 },
                onClick: () => openMcpTab(tab.config!),
            });
        } else if (tab.type === 'sftp') {
            options.push({
                label: t('sftp.connectSsh'),
                icon: { component: Terminal, size: 14 },
                onClick: () => {
                    const name = tab.config!.name || `${tab.config!.user}@${tab.config!.host}`;
                    addTab('ssh', name, tab.config);
                },
            });
            options.push({
                label: t('mcp.openForMcp'),
                icon: { component: Bot, size: 14 },
                onClick: () => openMcpTab(tab.config!),
            });
        }

        // Проброс портов
        if (tab.subType !== 'port-forwarding') {
            options.push({
                label: t('forward.title'),
                icon: { component: Share2, size: 14 },
                onClick: () => {
                    const name = tab.config!.name || `${tab.config!.user}@${tab.config!.host}`;
                    addTab('ssh', t('forward.title') + ': ' + name, tab.config, 'port-forwarding');
                },
            });
        }

        // Редактировать
        if (tab.type === 'ssh' || tab.type === 'sftp') {
            options.push({
                label: t('common.edit'),
                icon: { component: Pen, size: 14 },
                onClick: () => {
                    void handleEditConnection(tab.config!);
                },
            });
        }

        // Дублировать подключение
        if (tab.subType !== 'port-forwarding') {
            options.push({
                label: t('common.duplicateConnection'),
                icon: { component: Copy, size: 14 },
                onClick: () => {
                    addTab(tab.type, tab.title, tab.config, tab.subType);
                },
            });
        }

        contextMenu = {
            x: e.clientX,
            y: e.clientY,
            options,
        };
    };

    const isConnectingRef = { current: false };

    const menuRef: RefObject<HTMLDivElement | null> = { current: null };

    const configRef = { current: appSettings.config };

    const activeTab = $derived(
        activeView === 'tab' ? tabsState.tabs.find((tab) => tab.id === tabsState.activeTabId) : undefined,
    );

    const isTerminalTab = $derived(
        activeTab?.type === 'local-terminal' ||
            (activeTab?.type === 'ssh' && activeTab.config && activeTab.subType !== 'port-forwarding'),
    );

    const titleBarTheme = $derived(
        appSettings.config?.isOnboardingCompleted && isTerminalTab
            ? appSettings.resolvedTerminalTheme
            : appSettings.resolvedTheme,
    );

    $effect(() => {
        void [titleBarTheme];
        return untrack(() => {
            if (ipcRenderer?.platform !== 'linux' || !menuRef.current) return;
            const color = getComputedStyle(menuRef.current).getPropertyValue('--text-primary').trim();
            if (color) ipcRenderer.setWindowCaptionColor(color);
        });
    });

    $effect(() => {
        void [appSettings.config];
        return untrack(() => {
            configRef.current = appSettings.config;
        });
    });

    const refreshVaultStatus = async () => {
        if (!ipcRenderer || !configRef.current) return;
        const status = await ipcRenderer.vaultGetStatus();
        setVaultStatus(status);

        const { hasAcknowledgedRecoveryKey, isOnboardingCompleted } = configRef.current;

        // Show recovery key only if vault is unlocked, NOT acknowledged yet, AND onboarding is done.
        if (status.isUnlocked && !hasAcknowledgedRecoveryKey && isOnboardingCompleted && !recoveryKeyToShow) {
            const key = await ipcRenderer.vaultGetRecoveryKey();
            if (key) {
                setRecoveryKeyModal(key);
            } else {
                appSettings.setConfig((prev: AppConfig | null) =>
                    prev ? { ...prev, hasAcknowledgedRecoveryKey: true } : prev,
                );
            }
        }
    };

    $effect(() => {
        void [refreshVaultStatus, appSettings.setConfig];
        return untrack(() => {
            Promise.resolve().then(() => {
                void refreshVaultStatus();
            });

            const handleShowRecoveryKey = (e: Event) => {
                setRecoveryKeyModal((e as CustomEvent).detail);
            };
            window.addEventListener('show-recovery-key', handleShowRecoveryKey);

            const unsubReload = ipcRenderer?.onAppReloadRequest?.(() => {
                if (document.activeElement?.closest('.terminal-container')) {
                    window.dispatchEvent(new CustomEvent('terminal-force-ctrl-r'));
                }
            });

            // Отпечаток подтверждает main-процесс, а снимок избранного в webview
            // после этого устаревает: без события редактор сервера продолжал бы
            // показывать, что ключ не подтверждён. Терминальные вкладки не трогаем —
            // изменение их конфига пересоздало бы терминал посреди подключения.
            const unsubFingerprint = ipcRenderer?.onSSHFingerprintSaved?.(({ id, fingerprint }) => {
                appSettings.setConfig((prev) => {
                    if (!prev) return null;
                    if (!prev.favorites.some((fav) => fav.id === id)) return prev;
                    return {
                        ...prev,
                        favorites: prev.favorites.map((fav) => (fav.id === id ? { ...fav, fingerprint } : fav)),
                    };
                });
            });

            // Перенос секретов в системное хранилище идёт в фоне после показа окна:
            // он трогает системное хранилище и KDF, а оба делания не должны стоять
            // на пути к первому кадру. Статус приходит событием — без него окно ввода
            // ключа мигнул бы у того, кому ключ уже не нужен.
            let disposed = false;
            let unsubVaultStatus: (() => void) | undefined;
            const vaultStatusSubscription = ipcRenderer?.onVaultStatusChanged?.((status) => {
                setVaultStatus(status);
                void refreshVaultStatus();
            });
            if (vaultStatusSubscription) {
                void vaultStatusSubscription
                    .then((unsubscribe) => {
                        if (disposed) {
                            unsubscribe();
                        } else {
                            unsubVaultStatus = unsubscribe;
                        }
                    })
                    .catch((error) => {
                        console.error('[Vault] Failed to subscribe to status changes:', error);
                    });
            }

            return () => {
                disposed = true;
                window.removeEventListener('show-recovery-key', handleShowRecoveryKey);
                if (typeof unsubReload === 'function') unsubReload();
                if (typeof unsubFingerprint === 'function') unsubFingerprint();
                unsubVaultStatus?.();
            };
        });
    });

    const saveFavorite = (sshConfig: SSHConfig) => {
        const name = sshConfig.name || (sshConfig.user ? `${sshConfig.user}@${sshConfig.host}` : sshConfig.host);
        const newFavorite = {
            ...sshConfig,
            id: sshConfig.id || generateId(),
            name,
        };

        appSettings.setConfig((prev) => {
            if (!prev) return null;
            return { ...prev, favorites: upsertFavorite(prev.favorites, newFavorite) };
        });

        return newFavorite;
    };

    const handleFormConnect = (sshConfig: SSHConfig, shouldSave: boolean) => {
        if (isConnectingRef.current) return;
        isConnectingRef.current = true;

        let finalConfig: SSHConfig;
        if (shouldSave) {
            const savedConfig = saveFavorite(sshConfig);
            if (!savedConfig) {
                isConnectingRef.current = false;
                return;
            }
            finalConfig = savedConfig;
        } else {
            finalConfig = {
                ...sshConfig,
                password: sshConfig.password || '',
            };
        }

        console.log('[App] Connecting to server...', finalConfig.host);
        // Без логина подключение начнётся после его ввода, имя вкладки строим по хосту
        const name =
            finalConfig.name || (finalConfig.user ? `${finalConfig.user}@${finalConfig.host}` : finalConfig.host);
        const newTabId = generateId();

        tabsState.setTabs((prev) => {
            const otherTabs = prev.filter((t) => t.id !== tabsState.activeTabId);
            return [...otherTabs, { id: newTabId, type: 'ssh', title: name, config: finalConfig }];
        });
        tabsState.setActiveTabId(newTabId);

        setTimeout(() => {
            isConnectingRef.current = false;
        }, 1000);
    };

    const handleFormSave = (sshConfig: SSHConfig) => {
        saveFavorite(sshConfig);
    };

    const handleCredentialsEntered = (sshConfig: SSHConfig, credentials: SessionCredentials) => {
        const serverId = sshConfig.id;
        if (!serverId) return;
        if (!credentials.user && !credentials.password && !credentials.keyPassphrase) return;

        // Сервер отклонил ключ и запросил пароль: метод авторизации меняется на парольный,
        // сохранённый ключ больше не используется
        const dropKey = !!credentials.replaceKeyAuth && !!credentials.password && sshConfig.authType === 'key';
        const applyCredentials = (target: SSHConfig): SSHConfig => {
            const next: SSHConfig = {
                ...target,
                user: credentials.user || target.user,
                ...(credentials.password ? { password: credentials.password } : {}),
                ...(credentials.keyPassphrase ? { keyPassphrase: credentials.keyPassphrase } : {}),
            };
            if (dropKey) {
                next.authType = 'password';
                delete next.privateKey;
                delete next.privateKeyPath;
                delete next.keyPassphrase;
            }
            return next;
        };

        appSettings.setConfig((prev) => {
            if (!prev) return null;
            return {
                ...prev,
                favorites: prev.favorites.map((fav) => (fav.id === serverId ? applyCredentials(fav) : fav)),
            };
        });

        tabsState.setTabs((prev) =>
            prev.map((tab) => {
                // Терминальную вкладку не трогаем: введённые данные уже применены к текущему
                // подключению, а изменение её конфига пересоздало бы терминал и сбросило
                // счётчик попыток ввода. Остальные вкладки сервера (SFTP, проброс портов)
                // подхватывают их сразу.
                if (tab.type === 'ssh' || !tab.config || tab.config.id !== serverId) return tab;
                return { ...tab, config: applyCredentials(tab.config) };
            }),
        );
    };

    const handlePrivateKeyEntered = (sshConfig: SSHConfig, privateKey: EncryptedSecret) => {
        const serverId = sshConfig.id;
        if (!serverId) return;

        appSettings.setConfig((prev) => {
            if (!prev) return null;
            return {
                ...prev,
                favorites: prev.favorites.map((fav) => {
                    if (fav.id !== serverId) return fav;
                    const next: SSHConfig = { ...fav, authType: 'key', privateKey };
                    delete next.privateKeyPath;
                    return next;
                }),
            };
        });

        tabsState.setTabs((prev) =>
            prev.map((tab) => {
                // Как и при вводе логина/пароля, терминальную вкладку не обновляем,
                // чтобы не пересоздавать терминал посреди подключения
                if (tab.type === 'ssh' || !tab.config || tab.config.id !== serverId) return tab;
                const next: SSHConfig = { ...tab.config, authType: 'key', privateKey };
                delete next.privateKeyPath;
                return { ...tab, config: next };
            }),
        );
    };

    const handleOSInfo = (sshConfig: SSHConfig, osInfo: string) => {
        const prettyNameMatch = osInfo.match(/PRETTY_NAME="([^"]+)"/);
        const osPrettyName = prettyNameMatch ? prettyNameMatch[1] : undefined;

        if (osPrettyName && sshConfig.osPrettyName !== osPrettyName) {
            console.log(`[App] Updating OS info for ${sshConfig.host}: ${osPrettyName}`);

            appSettings.setConfig((prev) => {
                if (!prev) return null;
                const newFavorites = prev.favorites.map((fav) => {
                    if (fav.id === sshConfig.id) {
                        return { ...fav, osPrettyName };
                    }
                    return fav;
                });
                return { ...prev, favorites: newFavorites };
            });

            // Update tabs with new OS info
            tabsState.setTabs((prev) =>
                prev.map((tab) => {
                    if (
                        tab.type === 'ssh' &&
                        tab.config &&
                        (tab.config.id === sshConfig.id ||
                            (tab.config.host === sshConfig.host &&
                                tab.config.user === sshConfig.user &&
                                tab.config.port === sshConfig.port))
                    ) {
                        return { ...tab, config: { ...tab.config, osPrettyName } };
                    }
                    return tab;
                }),
            );
        }
    };

    const confirmDeleteFavorite = () => {
        const server = serverToDelete;
        if (!server) return;

        appSettings.setConfig((prev) => {
            if (!prev) return null;
            const newFavorites = prev.favorites.filter((f) => f.id !== server.id);
            return { ...prev, favorites: newFavorites };
        });
        serverToDelete = null;
    };

    const handleDuplicateFavorite = async (sshConfig: SSHConfig) => {
        const newId = generateId();
        const newFavorite: SSHConfig = {
            ...sshConfig,
            id: newId,
            name: `${sshConfig.name || sshConfig.host} - ${t('common.copySuffix')}`,
        };

        // Отпечаток принадлежит конкретному серверу, подтверждённому на сервере.
        // У копии он не подтверждён: `preserve_fingerprints` всё равно отбросил бы
        // значение для нового `id`, поэтому убираем его явно, чтобы копия не
        // выглядела подтверждённой до первого подключения.
        delete newFavorite.fingerprint;

        // Клонируем пароль в вольте если он есть
        if (sshConfig.id) {
            const vaultPass = await ipcRenderer?.vaultGetPassword?.(sshConfig.id);
            if (vaultPass) {
                // В данном случае мы полагаемся на то, что saveConfig на бэкенде
                // примет этот пароль в favorites и переложит в вольт под новым ID.
                newFavorite.password = vaultPass;
            }
        }

        appSettings.setConfig((prev) => {
            if (!prev) return null;
            return { ...prev, favorites: [...prev.favorites, newFavorite] };
        });
    };

    const handleOnboardingComplete = async () => {
        // Initialize vault on first run
        const result = (await ipcRenderer?.vaultInit?.()) as { recoveryKey: string; config: AppConfig } | null;
        if (result) {
            setRecoveryKeyModal(result.recoveryKey);
            setVaultStatus({ isUnlocked: true, isInitialized: true, secretsAvailable: true });
            // Use the config returned from main process to avoid state desync
            appSettings.setConfig({ ...result.config, isOnboardingCompleted: true });
        } else {
            appSettings.setConfig((prev: AppConfig | null) =>
                prev ? { ...prev, isOnboardingCompleted: true } : prev,
            );
        }
    };

    const handleVaultUnlock = async (key: string) => {
        const success = await ipcRenderer?.vaultUnlock?.(key);
        if (success) {
            setVaultStatus({ isUnlocked: true, isInitialized: true, secretsAvailable: true });
        }
        return success;
    };

    const handleVaultResetPasswords = async () => {
        const result = (await ipcRenderer?.vaultReset?.()) as { recoveryKey: string; config: AppConfig } | null;
        if (result) {
            appSettings.setConfig(result.config);
            setRecoveryKeyModal(result.recoveryKey);
            setVaultStatus({ isUnlocked: true, isInitialized: true, secretsAvailable: true });
        }
        await refreshVaultStatus();
    };
</script>

{#if !appSettings.config}<div class="app-container" role="status" aria-live="polite">
        {t('common.loading')}
    </div>{:else}{@const urlParams = new URLSearchParams(window.location?.search)}{@const view =
        urlParams.get('view')}{#if view === 'port-forwarding'}{@const sshConfig = {
            id: urlParams.get('id') || undefined,
            host: urlParams.get('host') || '',
            user: urlParams.get('user') || '',
            port: parseInt(urlParams.get('port') || '22'),
            name: urlParams.get('name') || '',
            authType: (urlParams.get('authType') as 'password' | 'key') || 'password',
            privateKeyPath: urlParams.get('privateKeyPath') || '',
        }}<PortForwardingView
            {sshConfig}
            theme={appSettings.config.theme}
            language={appSettings.config.language}
        />{:else}{@const isSftpDropTarget = appSettings.config.isOnboardingCompleted && activeTab?.type === 'sftp'}
        <div class="app-container main-window-layout">
            <TitleBar
                tabs={tabsState.tabs}
                activeTabId={tabsState.activeTabId}
                {activeView}
                theme={titleBarTheme}
                setActiveTabId={tabsState.setActiveTabId}
                {setActiveView}
                {closeTab}
                onTabContextMenu={handleTabContextMenu}
                {updater}
                {menuRef}
                appConfig={appSettings.config}
                isOnboarding={!appSettings.config.isOnboardingCompleted}
                setTabs={tabsState.setTabs}
                onOpenLocalTerminal={handleOpenLocalTerminal}
                pendingMcpConnections={pendingMcpConnectionIds}
            />

            <div class={`app-body-container ${appSettings.config.sidebarPosition === 'right' ? 'reverse' : ''}`}>
                {#if appSettings.config.sidebarEnabled && activeView === 'tab'}<Sidebar
                        config={appSettings.config}
                        {addTab}
                        onContextMenu={(e, fav) => {
                            e.preventDefault();
                            contextMenu = { x: e.clientX, y: e.clientY, config: fav };
                        }}
                    />{/if}
                <div class="main-content" style="flex: 1; display: flex; flex-direction: column; min-width: 0">
                    <div class="view-viewport-container">
                        {#if !vaultStatus.secretsAvailable && vaultStatus.isInitialized && appSettings.config.isOnboardingCompleted}<VaultUnlockModal
                                onUnlock={handleVaultUnlock}
                                onResetPasswords={handleVaultResetPasswords}
                                appConfig={appSettings.config}
                            />{/if}

                        {#if recoveryKeyToShow}<RecoveryKeyModal
                                recoveryKey={recoveryKeyToShow}
                                appConfig={appSettings.config}
                                onConfirm={() => {
                                    setRecoveryKeyModal(null);
                                    appSettings.setConfig((prev) =>
                                        prev ? { ...prev, hasAcknowledgedRecoveryKey: true } : null,
                                    );
                                }}
                            />{/if}

                        {#if !appSettings.config.isOnboardingCompleted}<OnboardingView
                                config={appSettings.config}
                                onUpdate={(updates) =>
                                    appSettings.setConfig((current) => current && { ...current, ...updates })}
                                onComplete={handleOnboardingComplete}
                                {systemFonts}
                            />{/if}

                        {#if appSettings.config.isOnboardingCompleted && activeView === 'home'}<HomeView
                                config={appSettings.config}
                                setConfig={appSettings.setConfig}
                                {addTab}
                                {searchQuery}
                                {setSearchQuery}
                                onContextMenu={(e, fav) => {
                                    e.preventDefault();
                                    contextMenu = { x: e.clientX, y: e.clientY, config: fav };
                                }}
                            />{/if}

                        {#if appSettings.config.isOnboardingCompleted && activeView === 'settings'}<SettingsView
                                config={appSettings.config}
                                setConfig={appSettings.setConfig}
                                {systemFonts}
                                {showNotification}
                                {refreshVaultStatus}
                            />{/if}

                        {#if appSettings.config.isOnboardingCompleted}{#each tabsState.tabs as tab (tab.id)}<div
                                    class={activeView === 'tab' && tabsState.activeTabId === tab.id
                                        ? 'tab-content-active'
                                        : ''}
                                    style={inlineStyle({
                                        display:
                                            activeView === 'tab' && tabsState.activeTabId === tab.id
                                                ? 'block'
                                                : 'none',
                                        height: '100%',
                                        width: '100%',
                                    })}
                                >
                                    {#if tab.type === 'ssh' && tab.config}{#if tab.subType === 'port-forwarding'}<PortForwardingView
                                                sshConfig={tab.config}
                                                theme={appSettings.config.theme}
                                                language={appSettings.config.language}
                                                appConfig={appSettings.config}
                                            />{:else}<TerminalComponent
                                                id={tab.id}
                                                theme={appSettings.resolvedTerminalTheme}
                                                config={tab.config}
                                                terminalFontName={appSettings.config.terminalFontName}
                                                terminalFontSize={appSettings.config.terminalFontSize}
                                                terminalScrollSensitivity={appSettings.config
                                                    .terminalScrollSensitivity}
                                                terminalScrollback={appSettings.config.terminalScrollback}
                                                keywordHighlighting={appSettings.config.keywordHighlighting}
                                                visible={tabsState.activeTabId === tab.id}
                                                onOSInfo={(info) => handleOSInfo(tab.config!, info)}
                                                onCredentialsEntered={handleCredentialsEntered}
                                                onPrivateKeyEntered={handlePrivateKeyEntered}
                                                enableContextMenu={appSettings.config.enableTerminalContextMenu}
                                                onEditConfig={handleEditConnection}
                                                onClose={() =>
                                                    closeTab({ stopPropagation: () => {} } as MouseEvent, tab.id)}
                                                appConfig={appSettings.config}
                                                onAlternateScreenChange={setActiveTabIsAltScreen}
                                            />{/if}{/if}
                                    {#if tab.type === 'local-terminal'}<LocalTerminalComponent
                                            id={tab.id}
                                            theme={appSettings.resolvedTerminalTheme}
                                            terminalFontName={appSettings.config.terminalFontName}
                                            terminalFontSize={appSettings.config.terminalFontSize}
                                            terminalScrollSensitivity={appSettings.config
                                                .terminalScrollSensitivity}
                                            terminalScrollback={appSettings.config.terminalScrollback}
                                            visible={activeView === 'tab' && tabsState.activeTabId === tab.id}
                                            enableContextMenu={appSettings.config.enableTerminalContextMenu}
                                            appConfig={appSettings.config}
                                            onClose={() =>
                                                closeTab({ stopPropagation: () => {} } as MouseEvent, tab.id)}
                                            onAlternateScreenChange={setActiveTabIsAltScreen}
                                        />{/if}
                                    {#if tab.type === 'sftp' && tab.config}<SFTPBrowser
                                            id={tab.id}
                                            config={tab.config}
                                            visible={tabsState.activeTabId === tab.id}
                                            onEditConfig={handleEditConnection}
                                            onClose={() =>
                                                closeTab({ stopPropagation: () => {} } as MouseEvent, tab.id)}
                                            appConfig={appSettings.config}
                                            onAppConfigUpdate={appSettings.setConfig}
                                            onSftpDefaultDirectoryChange={(path) => {
                                                if (!tab.config?.id) return;
                                                const updatedConfig = { ...tab.config };
                                                if (path) updatedConfig.sftpDefaultDirectory = path;
                                                else delete updatedConfig.sftpDefaultDirectory;
                                                tabsState.setTabs((prev) =>
                                                    prev.map((openTab) =>
                                                        openTab.id === tab.id
                                                            ? { ...openTab, config: updatedConfig }
                                                            : openTab,
                                                    ),
                                                );
                                                appSettings.setConfig((prev) =>
                                                    prev
                                                        ? {
                                                              ...prev,
                                                              favorites: prev.favorites.map((favorite) => {
                                                                  if (favorite.id !== updatedConfig.id)
                                                                      return favorite;
                                                                  const updated = { ...favorite };
                                                                  if (path) updated.sftpDefaultDirectory = path;
                                                                  else delete updated.sftpDefaultDirectory;
                                                                  return updated;
                                                              }),
                                                          }
                                                        : prev,
                                                );
                                            }}
                                        />{/if}
                                    {#if tab.type === 'connection'}<ConnectionForm
                                            onConnect={handleFormConnect}
                                            onSave={handleFormSave}
                                            initialConfig={tab.config}
                                            appConfig={appSettings.config}
                                            onClose={() =>
                                                closeTab({ stopPropagation: () => {} } as MouseEvent, tab.id)}
                                        />{/if}
                                    {#if tab.type === 'mcp' && tab.config}<McpTab
                                            config={tab.config}
                                            appConfig={appSettings.config}
                                            visible={activeView === 'tab' && tabsState.activeTabId === tab.id}
                                            onClose={() =>
                                                closeTab({ stopPropagation: () => {} } as MouseEvent, tab.id)}
                                            onAppConfigUpdate={appSettings.setConfig}
                                        />{/if}
                                </div>{/each}{/if}
                    </div>
                </div>
            </div>

            {#if externalDrag && externalDrag.items.length > 0}<div
                    aria-hidden="true"
                    style={inlineStyle({
                        position: 'fixed',
                        left: externalDrag.x / (window.devicePixelRatio || 1) + 16,
                        top: externalDrag.y / (window.devicePixelRatio || 1) + 16,
                        zIndex: 10000,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        maxWidth: 280,
                        maxHeight: 240,
                        overflowY: 'auto',
                        padding: '5px 8px',
                        borderRadius: 8,
                        color: 'var(--text-color)',
                        background: 'var(--bg-color)',
                        border: `1px solid ${isSftpDropTarget ? 'var(--primary-color)' : '#ef4444'}`,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                        pointerEvents: 'none',
                    })}
                >
                    {#each externalDrag.items as item, index (`${item.name}-${index}`)}<div
                            style="display: flex; align-items: center; gap: 8px; min-height: 27px"
                        >
                            <span style="display: flex; position: relative; flex-shrink: 0">
                                {#if item.icon}<img
                                        src={item.icon}
                                        alt=""
                                        width={20}
                                        height={20}
                                        draggable={false}
                                    />{:else if item.isDir}<Folder size={18} color="#d79921" />{:else}<File
                                        size={18}
                                    />{/if}
                                {#if index === 0 && !isSftpDropTarget}<CircleSlash
                                        size={14}
                                        color="#ef4444"
                                        style={inlineStyle({
                                            position: 'absolute',
                                            right: -7,
                                            bottom: -5,
                                            background: 'var(--bg-color)',
                                            borderRadius: '50%',
                                        })}
                                    />{/if}
                            </span>
                            <span
                                style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px"
                                >{item.name}</span
                            >
                        </div>{/each}
                </div>{/if}

            {#if contextMenu}{@const menu = contextMenu}<ContextMenu
                    x={menu.x}
                    y={menu.y}
                    onClose={() => (contextMenu = null)}
                    options={menu.options || [
                        {
                            label: t('common.connect'),
                            icon: { component: Play, size: 14 },
                            onClick: () => addTab('ssh', menu.config!.name || menu.config!.host, menu.config),
                        },
                        {
                            label: t('sftp.openSftp'),
                            icon: { component: Folder, size: 14 },
                            onClick: () => {
                                const name = menu.config!.name || `${menu.config!.user}@${menu.config!.host}`;
                                addTab('sftp', t('tabs.sftp', { name }), {
                                    ...menu.config!,
                                    password: menu.config!.password,
                                });
                            },
                        },
                        {
                            label: t('mcp.openForMcp'),
                            icon: { component: Bot, size: 14 },
                            onClick: () => openMcpTab(menu.config!),
                        },
                        {
                            label: t('forward.title'),
                            icon: { component: Share2, size: 14 },
                            onClick: () => {
                                const name = menu.config!.name || `${menu.config!.user}@${menu.config!.host}`;
                                addTab('ssh', t('forward.title') + ': ' + name, menu.config, 'port-forwarding');
                            },
                        },
                        {
                            label: t('common.edit'),
                            icon: { component: Pen, size: 14 },
                            onClick: () => handleEditConnection(menu.config!),
                        },
                        {
                            label: t('common.duplicate'),
                            icon: { component: Copy, size: 14 },
                            onClick: () => handleDuplicateFavorite(menu.config!),
                        },
                        {
                            label: t('common.delete'),
                            icon: { component: Trash2, size: 14 },
                            danger: true,
                            onClick: () => (serverToDelete = menu.config!),
                        },
                    ]}
                />{/if}

            {#if serverToDelete}<DeleteServerModal
                    server={serverToDelete}
                    onConfirm={confirmDeleteFavorite}
                    onCancel={() => (serverToDelete = null)}
                    appConfig={appSettings.config}
                />{/if}

            {#if notification}<NotificationModal
                    title={notification?.title}
                    message={notification?.message}
                    type={notification?.type}
                    action={notification?.action}
                    onClose={() => (notification = null)}
                />{/if}

            {#if toast}<ToastNotification
                    message={toast.message}
                    closeLabel={t('common.close')}
                    type={toast.type}
                    onClose={() => (toast = null)}
                />{/if}
        </div>{/if}{/if}
