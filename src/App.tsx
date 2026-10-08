import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { TerminalComponent } from './components/Terminal';
import { LocalTerminalComponent } from './components/LocalTerminal';
import { SFTPBrowser } from './components/SFTPBrowser';
import { ConnectionForm } from './components/ConnectionForm';
import { ContextMenu } from './components/layout/ContextMenu';
import { Edit2, File, Folder, CircleSlash, Play, Trash2, Share2, Copy, Terminal, Bot } from 'lucide-react';
import { McpTab } from './components/McpTab';

import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { HomeView } from './components/views/HomeView';
import { SettingsView } from './components/views/SettingsView';
import { PortForwardingView } from './components/views/PortForwardingView';
import { OnboardingView } from './components/views/OnboardingView';
import { RecoveryKeyModal } from './components/modals/RecoveryKeyModal';
import { VaultUnlockModal } from './components/modals/VaultUnlockModal';
import { DeleteServerModal } from './components/modals/DeleteServerModal';
import { NotificationModal } from './components/modals/NotificationModal';
import { ToastNotification } from './components/modals/ToastNotification';
import type { SessionCredentials } from './ipc';

import { useConfig } from './hooks/useConfig';
import { useI18n } from './utils/i18n';
import { useTabs } from './hooks/useTabs';
import { useSystemFonts } from './hooks/useSystemFonts';
import { useUpdateChecker } from './hooks/useUpdateChecker';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { shortcutMatchers, type ShortcutDefinition } from './utils/shortcuts';
import type { AppConfig, EncryptedSecret, McpStatus, NotificationAction, SSHConfig, NotificationType, Tab } from './types';
import { generateId, upsertFavorite } from './utils';
import { validateLicense } from './utils/license';

import './styles/light.css';
import './styles/dark.css';
import './styles/gruvbox-light.css';
import './styles/gruvbox-dark.css';
import './styles/windows-terminal.css';
import './App.css';

const { ipcRenderer } = window;

/**
 * Сообщает main, что контент отрисован, но только после загрузки критических шрифтов.
 *
 * Все `@font-face` в проекте объявлены с `font-display: block` (см.
 * `src/index.css`), поэтому перед показом окна запрашиваются нужные начертания
 * Inter и JetBrains Mono через `document.fonts.load`. Остальные варианты
 * шрифтов в ожидание не входят.
 *
 * Ожидание ограничено по времени: если шрифт не придёт (обрыв локального
 * ресурса, неудачный `document.fonts`), приложение всё равно должно показать
 * окно — иначе его увидит только fallback-таймер в `lib.rs`.
 */
const FONT_LOAD_EMERGENCY_TIMEOUT_MS = 1000;

const CRITICAL_FONT_FACES = [
    { family: 'Inter', weight: 400 },
    { family: 'Inter', weight: 500 },
    { family: 'Inter', weight: 700 },
    { family: 'JetBrains Mono', weight: 400 },
    { family: 'JetBrains Mono', weight: 500 },
    { family: 'JetBrains Mono', weight: 700 }
] as const;

async function notifyContentReady(
    rendererContentReady: () => void,
    isCancelled: () => boolean
): Promise<void> {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;

    if (fonts) {
        let timer = 0;
        const timeout = new Promise<void>(resolve => {
            timer = window.setTimeout(resolve, FONT_LOAD_EMERGENCY_TIMEOUT_MS);
        });

        try {
            await Promise.race([
                Promise.all(CRITICAL_FONT_FACES.map(({ family, weight }) =>
                    fonts.load(`${weight} 14px "${family}"`)
                )).then(() => {
                    const missingFaces = CRITICAL_FONT_FACES.filter(({ family, weight }) =>
                        !fonts.check(`${weight} 14px "${family}"`)
                    );
                    if (missingFaces.length > 0) {
                        console.warn('Critical startup fonts are unavailable:', missingFaces);
                    }
                }),
                timeout
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

function App() {
    const { config, setConfig, resolvedTheme } = useConfig();
    const { t } = useI18n(config?.language || 'ru');
    const systemFonts = useSystemFonts();
    const updater = useUpdateChecker();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeView, setActiveView] = useState<'home' | 'settings' | 'tab'>('home');
    const [activeTabIsAltScreen, setActiveTabIsAltScreen] = useState(false);
    const [externalDrag, setExternalDrag] = useState<{ items: Array<{ path: string; name: string; isDir: boolean; icon: string | null }>; x: number; y: number } | null>(null);
    const externalDragSequence = useRef(0);

    const {
        tabs,
        activeTabId,
        setActiveTabId,
        addTab: originalAddTab,
        closeTab: originalCloseTab,
        setTabs
    } = useTabs([]);

    useEffect(() => {
        const handlePreview = (event: Event) => {
            const detail = (event as CustomEvent<{ paths: string[]; icons: Array<string | null>; x: number; y: number }>).detail;
            const sequence = ++externalDragSequence.current;
            const initialItems = detail.paths.map((path, index) => ({
                path,
                name: path.split(/[\\/]/).filter(Boolean).pop() || path,
                isDir: false,
                icon: detail.icons[index] ?? null
            }));
            setExternalDrag({
                items: initialItems,
                x: detail.x,
                y: detail.y
            });
            void Promise.all(initialItems.map(async item => ({
                ...item,
                isDir: (await ipcRenderer?.fsStat?.(item.path))?.isDir ?? false
            }))).then(items => {
                if (sequence !== externalDragSequence.current) return;
                const directoryFlags = new Map(items.map(item => [item.path, item.isDir]));
                setExternalDrag(current => current ? {
                    ...current,
                    items: current.items.map(item => ({
                        ...item,
                        isDir: directoryFlags.get(item.path) ?? item.isDir
                    }))
                } : current);
            });
        };
        const handleIcons = (event: Event) => {
            const { paths, icons } = (event as CustomEvent<{ paths: string[]; icons: Array<string | null> }>).detail;
            setExternalDrag(current => {
                if (!current || current.items.length !== paths.length || !current.items.every((item, index) => item.path === paths[index])) {
                    return current;
                }
                return {
                    ...current,
                    items: current.items.map((item, index) => ({ ...item, icon: icons[index] ?? null }))
                };
            });
        };
        const handlePosition = (event: Event) => {
            const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
            setExternalDrag(current => current ? { ...current, x, y } : current);
        };
        const handleDragState = (event: Event) => {
            if (!(event as CustomEvent<boolean>).detail) {
                externalDragSequence.current++;
                setExternalDrag(null);
            }
        };
        window.addEventListener('yash-files-drag-preview', handlePreview);
        window.addEventListener('yash-files-drag-icons', handleIcons);
        window.addEventListener('yash-files-drag-position', handlePosition);
        window.addEventListener('yash-files-drag-state', handleDragState);
        return () => {
            window.removeEventListener('yash-files-drag-preview', handlePreview);
            window.removeEventListener('yash-files-drag-icons', handleIcons);
            window.removeEventListener('yash-files-drag-position', handlePosition);
            window.removeEventListener('yash-files-drag-state', handleDragState);
        };
    }, []);

    const addTab = useCallback((type: 'home' | 'settings' | 'ssh' | 'connection' | 'sftp' | 'mcp' | 'local-terminal', title: string, sshConfig?: SSHConfig, subType?: string) => {
        if (type === 'home') {
            setActiveView('home');
            return;
        }
        if (type === 'settings') {
            setActiveView('settings');
            return;
        }
        originalAddTab(type, title, sshConfig, subType);
        setActiveView('tab');
    }, [originalAddTab]);

    const closeTab = useCallback((e?: MouseEvent | { stopPropagation?: () => void }, id?: string) => {
        originalCloseTab(e, id);
        if (tabs.length <= 1) {
            setActiveView('home');
        }
    }, [originalCloseTab, tabs]);

    const handleNextTab = useCallback(() => {
        if (tabs.length === 0) return;

        let nextIndex = 0;
        if (activeView === 'tab') {
            const currentIndex = tabs.findIndex(t => t.id === activeTabId);
            if (currentIndex !== -1) {
                nextIndex = (currentIndex + 1) % tabs.length;
            }
        }

        const targetTab = tabs[nextIndex];
        if (targetTab) {
            setActiveTabId(targetTab.id);
            setActiveView('tab');
        }
    }, [tabs, activeView, activeTabId, setActiveTabId, setActiveView]);

    const handlePrevTab = useCallback(() => {
        if (tabs.length === 0) return;

        let prevIndex = tabs.length - 1;
        if (activeView === 'tab') {
            const currentIndex = tabs.findIndex(t => t.id === activeTabId);
            if (currentIndex !== -1) {
                prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
            }
        }

        const targetTab = tabs[prevIndex];
        if (targetTab) {
            setActiveTabId(targetTab.id);
            setActiveView('tab');
        }
    }, [tabs, activeView, activeTabId, setActiveTabId, setActiveView]);

    const handleOpenLocalTerminal = useCallback(() => {
        addTab('local-terminal', t('localTerminal.tabTitle'));
    }, [addTab, t]);

    const handleCloseTabShortcut = useCallback(() => {
        if (activeView === 'tab' && activeTabId) {
            closeTab(undefined, activeTabId);
        }
    }, [activeView, activeTabId, closeTab]);

    const globalShortcuts = useMemo<ShortcutDefinition[]>(() => [
        {
            id: 'close-tab',
            name: 'Close Tab',
            match: shortcutMatchers.closeTab,
            handler: handleCloseTabShortcut,
            allowInInput: false
        },
        {
            id: 'next-tab',
            name: 'Next Tab',
            match: shortcutMatchers.nextTab,
            handler: handleNextTab,
            allowInInput: false
        },
        {
            id: 'prev-tab',
            name: 'Previous Tab',
            match: shortcutMatchers.prevTab,
            handler: handlePrevTab,
            allowInInput: false
        }
    ], [handleCloseTabShortcut, handleNextTab, handlePrevTab]);

    useGlobalShortcuts(globalShortcuts, { isAltScreen: activeTabIsAltScreen });

    useEffect(() => {
        const connectionTitle = t('tabs.connection');
        setTabs(prev => {
            const needsUpdate = prev.some(tab =>
                tab.type === 'connection' && !tab.config && tab.title !== connectionTitle
            );

            if (!needsUpdate) return prev;

            return prev.map(tab => {
                if (tab.type === 'connection' && !tab.config && tab.title !== connectionTitle) {
                    return { ...tab, title: connectionTitle };
                }
                return tab;
            });
        });
    }, [setTabs, t]);

    const lastCheckedKeyRef = useRef<string | null>(null);
    useEffect(() => {
        const licenseKey = config?.licenseKey;
        if (!licenseKey) {
            lastCheckedKeyRef.current = null;
            return;
        }

        if (lastCheckedKeyRef.current === licenseKey) {
            return;
        }

        lastCheckedKeyRef.current = licenseKey;

        let isSubscribed = true;
        const checkLicense = async () => {
            const result = await validateLicense(licenseKey);

            if (!isSubscribed) return;

            if (result.errorType === 'INVALID_KEY' || result.errorType === 'EXPIRED_LICENSE') {
                setConfig(prev => {
                    if (!prev || !prev.licenseKey) return prev;
                    const updated = { ...prev };
                    delete updated.licenseKey;
                    delete updated.licenseExpiresAt;
                    return updated;
                });
            } else if (result.success && result.expiresAt !== undefined) {
                const expiresAt = result.expiresAt;
                setConfig(prev => {
                    if (!prev || prev.licenseExpiresAt === expiresAt) return prev;
                    return { ...prev, licenseExpiresAt: expiresAt };
                });
            }
        };

        void checkLicense();

        return () => {
            isSubscribed = false;
        };
    }, [config?.licenseKey, setConfig]);

    const [serverToDelete, setServerToDelete] = useState<SSHConfig | null>(null);
    // `secretsAvailable` вместо `isUnlocked`: после переноса секретов в системное
    // хранилище вольт намеренно закрыт, и по одному `isUnlocked` окно ввода ключа
    // появлялось бы у того, кому ключ уже не нужен.
    const [vaultStatus, setVaultStatus] = useState<{ isUnlocked: boolean, isInitialized: boolean, secretsAvailable: boolean }>({ isUnlocked: true, isInitialized: false, secretsAvailable: true });
    const [recoveryKeyToShow, setRecoveryKeyModal] = useState<string | null>(null);
    const [notification, setNotification] = useState<{ title: string, message: string, type?: NotificationType, action?: NotificationAction } | null>(null);
    const [toast, setToast] = useState<{ message: string, type?: NotificationType } | null>(null);

    const showNotification = useCallback((title: string, message: string, type?: NotificationType, action?: NotificationAction) => {
        if (!action && (type === 'success' || message === t('support.licenseError'))) {
            setToast({ message, type });
        } else {
            setNotification({ title, message, type, action });
        }
    }, [t]);

    // Соединения MCP с запросами, ожидающими подтверждения: по ним мигает
    // неактивная MCP-вкладка сервера, пока на неё не переключились или пока
    // запрос не снимут (см. TitleBar и `.header-tab.pending-confirmation`).
    const [pendingMcpConnectionIds, setPendingMcpConnectionIds] = useState<string[]>([]);
    const lastMcpStartupError = useRef<string | null>(null);
    useEffect(() => {
        let statusEventRevision = 0;
        const handleStatus = (status: McpStatus) => {
            if (status.state === 'failed' && status.error) {
                if (lastMcpStartupError.current !== status.error) {
                    lastMcpStartupError.current = status.error;
                    setToast({ message: status.error, type: 'error' });
                }
            } else {
                lastMcpStartupError.current = null;
            }

            const pending = status.pendingConfirmations;
            if (Array.isArray(pending)) {
                const nextIds = pending.map(req => req.connectionId);
                setPendingMcpConnectionIds(prev => (
                    prev.length === nextIds.length && prev.every((id, index) => id === nextIds[index])
                        ? prev
                        : nextIds
                ));
            }
        };

        const unsubscribe = ipcRenderer?.onMcpStatusChanged?.(status => {
            statusEventRevision += 1;
            handleStatus(status);
        });
        if (ipcRenderer?.mcpGetStatus) {
            const revisionAtRequest = statusEventRevision;
            void ipcRenderer.mcpGetStatus().then(status => {
                if (statusEventRevision === revisionAtRequest) handleStatus(status);
            }).catch(error => {
                console.error('[MCP] Failed to get status for startup notification:', error);
            });
        }
        return () => {
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, []);

    // Запрос подтверждения от MCP-агента открывает MCP-вкладку сервера в фоне:
    // вкладка появляется в панели, но активный вид и фокус не меняются, а
    // существующая вкладка этого сервера не открывается повторно.
    useEffect(() => {
        const unsubscribe = ipcRenderer?.onMcpRequestConfirmation?.(req => {
            const server = config?.favorites.find(fav => fav.id === req.connectionId);
            if (!server?.id) return;
            const title = `MCP: ${server.name || `${server.user}@${server.host}`}`;
            setTabs(prev => prev.some(existing => existing.type === 'mcp' && existing.config?.id === server.id)
                ? prev
                : [...prev, { id: generateId(), type: 'mcp', title, config: server }]);
        });
        return () => {
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [config?.favorites, setTabs]);

    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, options?: { label: string, icon?: ReactNode, onClick: () => void, danger?: boolean }[], config?: SSHConfig } | null>(null);

    useLayoutEffect(() => {
        if (!config) {
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
    }, [config]);

    const handleEditConnection = useCallback(async (sshConfig: SSHConfig) => {
        const name = sshConfig.name || `${sshConfig.user}@${sshConfig.host}`;

        const editableConfig: SSHConfig = { ...sshConfig };
        if (sshConfig.id) {
            const [vaultPass, keyPassphrase] = await Promise.all([
                ipcRenderer?.vaultGetPassword?.(sshConfig.id),
                ipcRenderer?.vaultGetKeyPassphrase?.(sshConfig.id)
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
    }, [addTab, t]);

    /**
     * Открывает MCP-вкладку сервера (пункт «Открыть для MCP»).
     *
     * Если вкладка этого сервера уже открыта — переключается на неё вместо
     * создания дубликата. Сопоставление идёт по `SSHConfig.id`: контекстное
     * меню открывается для сервера из избранного, у которого id есть всегда.
     */
    const openMcpTab = useCallback((server: SSHConfig) => {
        const existing = server.id
            ? tabs.find(tab => tab.type === 'mcp' && tab.config?.id === server.id)
            : undefined;
        if (existing) {
            setActiveTabId(existing.id);
            setActiveView('tab');
            return;
        }
        const name = server.name || `${server.user}@${server.host}`;
        addTab('mcp', `MCP: ${name}`, server);
    }, [tabs, addTab, setActiveTabId]);

    const handleTabContextMenu = useCallback((e: MouseEvent | { clientX: number, clientY: number }, tab: Tab) => {
        if (!tab.config) return;

        const options = [];

        if (tab.type === 'mcp') {
            const name = tab.config.name || `${tab.config.user}@${tab.config.host}`;
            options.push({
                label: t('sftp.connectSsh'),
                icon: <Terminal size={14} />,
                onClick: () => {
                    addTab('ssh', name, tab.config);
                }
            });
            options.push({
                label: t('sftp.openSftp'),
                icon: <Folder size={14} />,
                onClick: () => {
                    addTab('sftp', t('tabs.sftp', { name }), tab.config);
                }
            });
            options.push({
                label: t('common.edit'),
                icon: <Edit2 size={14} />,
                onClick: () => {
                    void handleEditConnection(tab.config!);
                }
            });

            setContextMenu({
                x: e.clientX,
                y: e.clientY,
                options
            });
            return;
        }

        // Открыть SFTP / Подключиться по SSH
        if (tab.type === 'ssh') {
            options.push({
                label: t('sftp.openSftp'),
                icon: <Folder size={14} />,
                onClick: () => {
                    const name = tab.config!.name || `${tab.config!.user}@${tab.config!.host}`;
                    addTab('sftp', t('tabs.sftp', { name }), tab.config);
                }
            });
        } else if (tab.type === 'sftp') {
            options.push({
                label: t('sftp.connectSsh'),
                icon: <Terminal size={14} />,
                onClick: () => {
                    const name = tab.config!.name || `${tab.config!.user}@${tab.config!.host}`;
                    addTab('ssh', name, tab.config);
                }
            });
        }

        // Проброс портов
        if (tab.subType !== 'port-forwarding') {
            options.push({
                label: t('forward.title'),
                icon: <Share2 size={14} />,
                onClick: () => {
                    const name = tab.config!.name || `${tab.config!.user}@${tab.config!.host}`;
                    addTab('ssh', t('forward.title') + ': ' + name, tab.config, 'port-forwarding');
                }
            });
        }

        // Редактировать
        if (tab.type === 'ssh' || tab.type === 'sftp') {
            options.push({
                label: t('common.edit'),
                icon: <Edit2 size={14} />,
                onClick: () => {
                    void handleEditConnection(tab.config!);
                }
            });
        }

        // Дублировать подключение
        if (tab.subType !== 'port-forwarding') {
            options.push({
                label: t('common.duplicateConnection'),
                icon: <Copy size={14} />,
                onClick: () => {
                    addTab(tab.type, tab.title, tab.config, tab.subType);
                }
            });
        }

        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            options
        });
    }, [addTab, handleEditConnection, t]);

    const isConnectingRef = useRef(false);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const configRef = useRef(config);

    useEffect(() => {
        configRef.current = config;
    }, [config]);

    const refreshVaultStatus = useCallback(async () => {
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
                setConfig((prev: AppConfig | null) => prev ? { ...prev, hasAcknowledgedRecoveryKey: true } : prev);
            }
        }
    }, [recoveryKeyToShow, setConfig]);

    useEffect(() => {
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
            setConfig(prev => {
                if (!prev) return null;
                if (!prev.favorites.some(fav => fav.id === id)) return prev;
                return {
                    ...prev,
                    favorites: prev.favorites.map(fav => fav.id === id ? { ...fav, fingerprint } : fav)
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
            void vaultStatusSubscription.then(unsubscribe => {
                if (disposed) {
                    unsubscribe();
                } else {
                    unsubVaultStatus = unsubscribe;
                }
            }).catch(error => {
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
    // `setConfig` стабилен (`useConfig` оборачивает его в `useCallback` с пустым
    // списком), поэтому добавление в зависимости не переподписывает эффект.
    }, [refreshVaultStatus, setConfig]);

    const saveFavorite = useCallback((sshConfig: SSHConfig) => {
        const name = sshConfig.name || (sshConfig.user ? `${sshConfig.user}@${sshConfig.host}` : sshConfig.host);
        const newFavorite = {
            ...sshConfig,
            id: sshConfig.id || generateId(),
            name
        };

        setConfig(prev => {
            if (!prev) return null;
            return { ...prev, favorites: upsertFavorite(prev.favorites, newFavorite) };
        });

        return newFavorite;
    }, [setConfig]);

    const handleFormConnect = useCallback((sshConfig: SSHConfig, shouldSave: boolean) => {
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
                password: sshConfig.password || ''
            };
        }

        console.log('[App] Connecting to server...', finalConfig.host);
        // Без логина подключение начнётся после его ввода, имя вкладки строим по хосту
        const name = finalConfig.name || (finalConfig.user ? `${finalConfig.user}@${finalConfig.host}` : finalConfig.host);
        const newTabId = generateId();

        setTabs(prev => {
            const otherTabs = prev.filter(t => t.id !== activeTabId);
            return [...otherTabs, { id: newTabId, type: 'ssh', title: name, config: finalConfig }];
        });
        setActiveTabId(newTabId);

        setTimeout(() => {
            isConnectingRef.current = false;
        }, 1000);
    }, [activeTabId, setTabs, setActiveTabId, saveFavorite]);

    /** Сохраняет сервер в избранное без открытия вкладки подключения */
    const handleFormSave = useCallback((sshConfig: SSHConfig) => {
        saveFavorite(sshConfig);
    }, [saveFavorite]);

    /**
     * Сохраняет логин/пароль/парольную фразу, введённые при подключении к серверу,
     * у которого они не были сохранены ранее. Секреты уходят в вольт при следующем
     * сохранении конфига (save-config переносит plaintext-значения в хранилище).
     */
    const handleCredentialsEntered = useCallback((sshConfig: SSHConfig, credentials: SessionCredentials) => {
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
                ...(credentials.keyPassphrase ? { keyPassphrase: credentials.keyPassphrase } : {})
            };
            if (dropKey) {
                next.authType = 'password';
                delete next.privateKey;
                delete next.privateKeyPath;
                delete next.keyPassphrase;
            }
            return next;
        };

        setConfig(prev => {
            if (!prev) return null;
            return {
                ...prev,
                favorites: prev.favorites.map(fav => fav.id === serverId ? applyCredentials(fav) : fav)
            };
        });

        setTabs(prev => prev.map(tab => {
            // Терминальную вкладку не трогаем: введённые данные уже применены к текущему
            // подключению, а изменение её конфига пересоздало бы терминал и сбросило
            // счётчик попыток ввода. Остальные вкладки сервера (SFTP, проброс портов)
            // подхватывают их сразу.
            if (tab.type === 'ssh' || !tab.config || tab.config.id !== serverId) return tab;
            return { ...tab, config: applyCredentials(tab.config) };
        }));
    }, [setConfig, setTabs]);

    /**
     * Сохраняет приватный ключ, введённый вместо пароля: сервер переключается
     * на авторизацию по ключу, ключ шифруется и кладётся в вольт.
     */
    const handlePrivateKeyEntered = useCallback((sshConfig: SSHConfig, privateKey: EncryptedSecret) => {
        const serverId = sshConfig.id;
        if (!serverId) return;

        setConfig(prev => {
            if (!prev) return null;
            return {
                ...prev,
                favorites: prev.favorites.map(fav => {
                    if (fav.id !== serverId) return fav;
                    const next: SSHConfig = { ...fav, authType: 'key', privateKey };
                    delete next.privateKeyPath;
                    return next;
                })
            };
        });

        setTabs(prev => prev.map(tab => {
            // Как и при вводе логина/пароля, терминальную вкладку не обновляем,
            // чтобы не пересоздавать терминал посреди подключения
            if (tab.type === 'ssh' || !tab.config || tab.config.id !== serverId) return tab;
            const next: SSHConfig = { ...tab.config, authType: 'key', privateKey };
            delete next.privateKeyPath;
            return { ...tab, config: next };
        }));
    }, [setConfig, setTabs]);

    const handleOSInfo = useCallback((sshConfig: SSHConfig, osInfo: string) => {
        const prettyNameMatch = osInfo.match(/PRETTY_NAME="([^"]+)"/);
        const osPrettyName = prettyNameMatch ? prettyNameMatch[1] : undefined;

        if (osPrettyName && sshConfig.osPrettyName !== osPrettyName) {
            console.log(`[App] Updating OS info for ${sshConfig.host}: ${osPrettyName}`);

            setConfig(prev => {
                if (!prev) return null;
                const newFavorites = prev.favorites.map(fav => {
                    if (fav.id === sshConfig.id) {
                        return { ...fav, osPrettyName };
                    }
                    return fav;
                });
                return { ...prev, favorites: newFavorites };
            });

            // Update tabs with new OS info
            setTabs(prev => prev.map(tab => {
                if (tab.type === 'ssh' && tab.config &&
                    (tab.config.id === sshConfig.id ||
                        (tab.config.host === sshConfig.host &&
                            tab.config.user === sshConfig.user &&
                            tab.config.port === sshConfig.port))) {
                    return { ...tab, config: { ...tab.config, osPrettyName } };
                }
                return tab;
            }));
        }
    }, [setConfig, setTabs]);


    const confirmDeleteFavorite = () => {
        if (!serverToDelete) return;

        setConfig(prev => {
            if (!prev) return null;
            const newFavorites = prev.favorites.filter(f => f.id !== serverToDelete.id);
            return { ...prev, favorites: newFavorites };
        });
        setServerToDelete(null);
    };


    const handleDuplicateFavorite = useCallback(async (sshConfig: SSHConfig) => {
        const newId = generateId();
        const newFavorite: SSHConfig = {
            ...sshConfig,
            id: newId,
            name: `${sshConfig.name || sshConfig.host} - ${t('common.copySuffix')}`
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

        setConfig(prev => {
            if (!prev) return null;
            return { ...prev, favorites: [...prev.favorites, newFavorite] };
        });
    }, [setConfig, t]);

    const handleOnboardingComplete = useCallback(async () => {
        // Initialize vault on first run
        const result = await ipcRenderer?.vaultInit?.() as { recoveryKey: string, config: AppConfig } | null;
        if (result) {
            setRecoveryKeyModal(result.recoveryKey);
            setVaultStatus({ isUnlocked: true, isInitialized: true, secretsAvailable: true });
            // Use the config returned from main process to avoid state desync
            setConfig({ ...result.config, isOnboardingCompleted: true });
        } else {
            setConfig((prev: AppConfig | null) => prev ? { ...prev, isOnboardingCompleted: true } : prev);
        }
    }, [setConfig]);

    const handleVaultUnlock = async (key: string) => {
        const success = await ipcRenderer?.vaultUnlock?.(key);
        if (success) {
            setVaultStatus({ isUnlocked: true, isInitialized: true, secretsAvailable: true });
        }
        return success;
    };

    const handleVaultResetPasswords = async () => {
        const result = await ipcRenderer?.vaultReset?.() as { recoveryKey: string, config: AppConfig } | null;
        if (result) {
            setConfig(result.config);
            setRecoveryKeyModal(result.recoveryKey);
            setVaultStatus({ isUnlocked: true, isInitialized: true, secretsAvailable: true });
        }
        await refreshVaultStatus();
    };

    if (!config) {
        return (
            <div className="app-container" role="status" aria-live="polite">
                {t('common.loading')}
            </div>
        );
    }

    // Check for special views (like port forwarding window)
    const urlParams = new URLSearchParams(window.location?.search);
    const view = urlParams.get('view');

    if (view === 'port-forwarding') {
        const sshConfig: SSHConfig = {
            id: urlParams.get('id') || undefined,
            host: urlParams.get('host') || '',
            user: urlParams.get('user') || '',
            port: parseInt(urlParams.get('port') || '22'),
            name: urlParams.get('name') || '',
            authType: (urlParams.get('authType') as 'password' | 'key') || 'password',
            privateKeyPath: urlParams.get('privateKeyPath') || ''
        };

        return (
            <PortForwardingView
                sshConfig={sshConfig}
                theme={config.theme}
                language={config.language}
            />
        );
    }

    const activeDropTab = activeView === 'tab' ? tabs.find(tab => tab.id === activeTabId) : undefined;
    const isSftpDropTarget = config.isOnboardingCompleted && activeDropTab?.type === 'sftp';

    return (
        <div className="app-container main-window-layout">

            <TitleBar
                tabs={tabs}
                activeTabId={activeTabId}
                activeView={activeView}
                setActiveTabId={setActiveTabId}
                setActiveView={setActiveView}
                closeTab={closeTab}
                onTabContextMenu={handleTabContextMenu}
                updater={updater}
                menuRef={menuRef}
                appConfig={config}
                isOnboarding={!config.isOnboardingCompleted}
                setTabs={setTabs}
                onOpenLocalTerminal={handleOpenLocalTerminal}
                pendingMcpConnections={pendingMcpConnectionIds}
            />

            <div className={`app-body-container ${config.sidebarPosition === 'right' ? 'reverse' : ''}`}>
                {config.sidebarEnabled && activeView === 'tab' && (
                    <Sidebar
                        config={config}
                        addTab={addTab}
                        onContextMenu={(e, fav) => {
                            e.preventDefault();
                            setContextMenu({ x: e.clientX, y: e.clientY, config: fav });
                        }}
                    />
                )}
                <div className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

                    <div className="view-viewport-container">
                        {!vaultStatus.secretsAvailable && vaultStatus.isInitialized && config.isOnboardingCompleted && (
                            <VaultUnlockModal
                                onUnlock={handleVaultUnlock}
                                onResetPasswords={handleVaultResetPasswords}
                                appConfig={config}
                            />
                        )}

                        {recoveryKeyToShow && (
                            <RecoveryKeyModal
                                recoveryKey={recoveryKeyToShow}
                                appConfig={config}
                                onConfirm={() => {
                                    setRecoveryKeyModal(null);
                                    setConfig(prev => prev ? { ...prev, hasAcknowledgedRecoveryKey: true } : null);
                                }}
                            />
                        )}

                        {!config.isOnboardingCompleted && (
                            <OnboardingView
                                config={config}
                                onUpdate={(updates) => setConfig({ ...config, ...updates })}
                                onComplete={handleOnboardingComplete}
                                systemFonts={systemFonts}
                            />
                        )}

                        {config.isOnboardingCompleted && activeView === 'home' && (
                            <HomeView
                                config={config}
                                setConfig={setConfig}
                                addTab={addTab}
                                searchQuery={searchQuery}
                                setSearchQuery={setSearchQuery}
                                onContextMenu={(e, fav) => {
                                    e.preventDefault();
                                    setContextMenu({ x: e.clientX, y: e.clientY, config: fav });
                                }}
                            />
                        )}

                        {config.isOnboardingCompleted && activeView === 'settings' && (
                            <SettingsView
                                config={config}
                                setConfig={setConfig}
                                systemFonts={systemFonts}
                                showNotification={showNotification}
                                refreshVaultStatus={refreshVaultStatus}
                            />
                        )}

                        {config.isOnboardingCompleted && tabs.map(tab => (
                            <div key={tab.id}
                                className={activeView === 'tab' && activeTabId === tab.id ? 'tab-content-active' : ''}
                                style={{
                                    display: activeView === 'tab' && activeTabId === tab.id ? 'block' : 'none',
                                    height: '100%',
                                    width: '100%'
                                }}>
                                {tab.type === 'ssh' && tab.config && (
                                    tab.subType === 'port-forwarding' ? (
                                        <PortForwardingView
                                            sshConfig={tab.config}
                                            theme={config.theme}
                                            language={config.language}
                                            appConfig={config}
                                        />
                                    ) : (
                                        <TerminalComponent
                                            id={tab.id}
                                            theme={resolvedTheme}
                                            config={tab.config}
                                            terminalFontName={config.terminalFontName}
                                            terminalFontSize={config.terminalFontSize}
                                            terminalScrollSensitivity={config.terminalScrollSensitivity}
                                            terminalScrollback={config.terminalScrollback}
                                            keywordHighlighting={config.keywordHighlighting}
                                            visible={activeTabId === tab.id}
                                            onOSInfo={(info) => handleOSInfo(tab.config!, info)}
                                            onCredentialsEntered={handleCredentialsEntered}
                                            onPrivateKeyEntered={handlePrivateKeyEntered}
                                            enableContextMenu={config.enableTerminalContextMenu}
                                            onEditConfig={handleEditConnection}
                                            onClose={() => closeTab({ stopPropagation: () => { } } as MouseEvent, tab.id)}
                                            appConfig={config}
                                            onAlternateScreenChange={setActiveTabIsAltScreen}
                                        />
                                    )
                                )}
                                {tab.type === 'local-terminal' && (
                                    <LocalTerminalComponent
                                        id={tab.id}
                                        theme={resolvedTheme}
                                        terminalFontName={config.terminalFontName}
                                        terminalFontSize={config.terminalFontSize}
                                        terminalScrollSensitivity={config.terminalScrollSensitivity}
                                        terminalScrollback={config.terminalScrollback}
                                        visible={activeView === 'tab' && activeTabId === tab.id}
                                        enableContextMenu={config.enableTerminalContextMenu}
                                        appConfig={config}
                                        onClose={() => closeTab({ stopPropagation: () => { } } as MouseEvent, tab.id)}
                                        onAlternateScreenChange={setActiveTabIsAltScreen}
                                    />
                                )}
                                {tab.type === 'sftp' && tab.config && (
                                    <SFTPBrowser
                                        id={tab.id}
                                        config={tab.config}
                                        visible={activeTabId === tab.id}
                                        onEditConfig={handleEditConnection}
                                        onClose={() => closeTab({ stopPropagation: () => { } } as MouseEvent, tab.id)}
                                        appConfig={config}
                                        onAppConfigUpdate={setConfig}
                                    />
                                )}
                                {tab.type === 'connection' && (
                                    <ConnectionForm
                                        onConnect={handleFormConnect}
                                        onSave={handleFormSave}
                                        initialConfig={tab.config}
                                        appConfig={config}
                                        onClose={() => closeTab({ stopPropagation: () => { } } as MouseEvent, tab.id)}
                                    />
                                )}
                                {tab.type === 'mcp' && tab.config && (
                                    <McpTab
                                        config={tab.config}
                                        appConfig={config}
                                        visible={activeView === 'tab' && activeTabId === tab.id}
                                        onClose={() => closeTab({ stopPropagation: () => { } } as MouseEvent, tab.id)}
                                        onAppConfigUpdate={setConfig}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {externalDrag && externalDrag.items.length > 0 && (
                <div
                    aria-hidden="true"
                    style={{
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
                        pointerEvents: 'none'
                    }}
                >
                    {externalDrag.items.map((item, index) => (
                        <div key={`${item.name}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 27 }}>
                            <span style={{ display: 'flex', position: 'relative', flexShrink: 0 }}>
                                {item.icon ? (
                                    <img src={item.icon} alt="" width={20} height={20} draggable={false} />
                                ) : item.isDir ? <Folder size={18} color="#d79921" /> : <File size={18} />}
                                {index === 0 && !isSftpDropTarget && <CircleSlash size={14} color="#ef4444" style={{ position: 'absolute', right: -7, bottom: -5, background: 'var(--bg-color)', borderRadius: '50%' }} />}
                            </span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{item.name}</span>
                        </div>
                    ))}
                </div>
            )}

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                    options={contextMenu.options || [
                        {
                            label: t('common.connect'),
                            icon: <Play size={14} />,
                            onClick: () => addTab('ssh', contextMenu.config!.name || contextMenu.config!.host, contextMenu.config)
                        },
                        {
                            label: t('sftp.openSftp'),
                            icon: <Folder size={14} />,
                            onClick: () => {
                                const name = contextMenu.config!.name || `${contextMenu.config!.user}@${contextMenu.config!.host}`;
                                addTab('sftp', t('tabs.sftp', { name }), {
                                    ...contextMenu.config!,
                                    password: contextMenu.config!.password
                                });
                            }
                        },
                        {
                            label: t('mcp.openForMcp'),
                            icon: <Bot size={14} />,
                            onClick: () => openMcpTab(contextMenu.config!)
                        },
                        {
                            label: t('forward.title'),
                            icon: <Share2 size={14} />,
                            onClick: () => {
                                const name = contextMenu.config!.name || `${contextMenu.config!.user}@${contextMenu.config!.host}`;
                                addTab('ssh', t('forward.title') + ': ' + name, contextMenu.config, 'port-forwarding');
                            }
                        },
                        {
                            label: t('common.edit'),
                            icon: <Edit2 size={14} />,
                            onClick: () => handleEditConnection(contextMenu.config!)
                        },
                        {
                            label: t('common.duplicate'),
                            icon: <Copy size={14} />,
                            onClick: () => handleDuplicateFavorite(contextMenu.config!)
                        },
                        {
                            label: t('common.delete'),
                            icon: <Trash2 size={14} />,
                            danger: true,
                            onClick: () => setServerToDelete(contextMenu.config!)
                        }
                    ]}
                />
            )}

            {serverToDelete && (
                <DeleteServerModal
                    server={serverToDelete}
                    onConfirm={confirmDeleteFavorite}
                    onCancel={() => setServerToDelete(null)}
                    appConfig={config}
                />
            )}

            {notification && (
                <NotificationModal
                    title={notification?.title}
                    message={notification?.message}
                    type={notification?.type}
                    action={notification?.action}
                    onClose={() => setNotification(null)}
                />
            )}

            {toast && (
                <ToastNotification
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
        </div>
    );
}

export default function AppWrapper() {
    return (
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    );
}
