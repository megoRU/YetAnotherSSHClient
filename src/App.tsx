import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TerminalComponent } from './components/Terminal';
import { SFTPBrowser } from './components/SFTPBrowser';
import { ConnectionForm } from './components/ConnectionForm';
import { ContextMenu } from './components/layout/ContextMenu';
import { Edit2, Folder, Play, Trash2, Share2, Copy } from 'lucide-react';

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
import { ReloadConfirmModal } from './components/modals/ReloadConfirmModal';
import { NotificationModal } from './components/modals/NotificationModal';

import { useConfig } from './hooks/useConfig';
import { useI18n } from './utils/i18n';
import { useTabs } from './hooks/useTabs';
import { useSystemFonts } from './hooks/useSystemFonts';
import { useUpdateChecker } from './hooks/useUpdateChecker';
import type { SSHConfig, NotificationType } from './types';
import { generateId } from './utils';

import './styles/light.css';
import './styles/dark.css';
import './styles/gruvbox-light.css';
import './styles/gruvbox-dark.css';
import './styles/windows-terminal.css';
import './App.css';

const { ipcRenderer } = window;

function App() {
    const { config, setConfig, resolvedTheme } = useConfig();
    const { t } = useI18n(config?.language || 'ru');
    const systemFonts = useSystemFonts();
    const updater = useUpdateChecker();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeView, setActiveView] = useState<'home' | 'settings' | 'tab'>('home');

    const {
        tabs,
        activeTabId,
        setActiveTabId,
        addTab: originalAddTab,
        closeTab: originalCloseTab,
        setTabs
    } = useTabs([]);

    const addTab = useCallback((type: 'home' | 'settings' | 'ssh' | 'connection' | 'sftp', title: string, sshConfig?: SSHConfig, subType?: string) => {
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

    const closeTab = useCallback((e: React.MouseEvent, id: string) => {
        originalCloseTab(e, id);
        if (tabs.length <= 1) {
            setActiveView('home');
        }
    }, [originalCloseTab, tabs.length]);

    useEffect(() => {
        if (config) {
            setTabs(prev => prev.map(tab => {
                if (tab.type === 'connection' && !tab.config) return { ...tab, title: t('tabs.connection') };
                return tab;
            }));
        }
    }, [config, setTabs, t]);

    const [serverToDelete, setServerToDelete] = useState<SSHConfig | null>(null);
    const [showReloadModal, setShowReloadModal] = useState(false);
    const [vaultStatus, setVaultStatus] = useState<{ isUnlocked: boolean, isInitialized: boolean }>({ isUnlocked: true, isInitialized: false });
    const [recoveryKeyToShow, setRecoveryKeyModal] = useState<string | null>(null);
    const [notification, setNotification] = useState<{ title: string, message: string, type?: NotificationType, action?: { label: string, onClick: () => void } } | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, options?: { label: string, icon: React.ReactNode, onClick: () => void, danger?: boolean }[], config?: SSHConfig } | null>(null);

    const isConnectingRef = useRef(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const refreshVaultStatus = useCallback(async () => {
        if (!ipcRenderer || !config) return;
        const status = await ipcRenderer.vaultGetStatus();
        setVaultStatus(status);

        // Show recovery key only if vault is unlocked, NOT acknowledged yet, AND onboarding is done.
        // We also check recoveryKeyToShow to avoid double-setting state if it's already visible.
        if (status.isUnlocked && !config.hasAcknowledgedRecoveryKey && config.isOnboardingCompleted && !recoveryKeyToShow) {
            const key = await ipcRenderer.vaultGetRecoveryKey();
            if (key) {
                setRecoveryKeyModal(key);
            } else {
                // If we can't get the key (e.g. safeStorage issue) but it's marked as unacknowledged,
                // we should probably not block the user forever.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                setConfig((prev: any) => prev ? { ...prev, hasAcknowledgedRecoveryKey: true } : prev);
            }
        }
    }, [config, recoveryKeyToShow, setConfig]);

    useEffect(() => {
        Promise.resolve().then(() => {
            refreshVaultStatus();
        });

        const handleShowRecoveryKey = (e: Event) => {
            setRecoveryKeyModal((e as CustomEvent).detail);
        };
        window.addEventListener('show-recovery-key', handleShowRecoveryKey);

        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                // menuRef is used for TitleBar, but since we removed menus from it,
                // we might not need this anymore or can keep it if we plan to add menus back.
            }
        };
        document.addEventListener('mousedown', handleClickOutside);

        const unsubReload = ipcRenderer?.onAppReloadRequest?.(() => {
            // Если фокус в терминале, мы принудительно посылаем Ctrl+R в сессию вместо перезагрузки
            if (document.activeElement?.closest('.terminal-container')) {
                window.dispatchEvent(new CustomEvent('terminal-force-ctrl-r'));
            } else {
                setShowReloadModal(true);
            }
        });

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('show-recovery-key', handleShowRecoveryKey);
            if (typeof unsubReload === 'function') unsubReload();
        };
    }, [config, refreshVaultStatus]);

    const saveFavorite = useCallback((sshConfig: SSHConfig) => {
        const name = sshConfig.name || `${sshConfig.user}@${sshConfig.host}`;
        const newFavorite = {
            ...sshConfig,
            id: sshConfig.id || generateId(),
            name,
            password: sshConfig.password || ''
        };

        setConfig(prev => {
            if (!prev) return null;
            const existingIndex = prev.favorites.findIndex(f =>
                f.id === newFavorite.id ||
                (f.host === newFavorite.host && f.user === newFavorite.user && f.port === newFavorite.port)
            );

            let newFavorites;
            if (existingIndex > -1) {
                newFavorites = [...prev.favorites];
                newFavorites[existingIndex] = newFavorite;
            } else {
                newFavorites = [...prev.favorites, newFavorite];
            }
            return { ...prev, favorites: newFavorites };
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
        const name = finalConfig.name || `${finalConfig.user}@${finalConfig.host}`;
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

    const handleEditConnection = useCallback(async (sshConfig: SSHConfig) => {
        const name = sshConfig.name || `${sshConfig.user}@${sshConfig.host}`;

        let password = '';
        if (sshConfig.id) {
            const vaultPass = await ipcRenderer?.vaultGetPassword?.(sshConfig.id);
            if (vaultPass) {
                password = vaultPass;
            }
        }

        addTab('connection', t('tabs.editConnection', { name }), {
            ...sshConfig,
            password
        });
    }, [addTab, t]);

    const handleDuplicateFavorite = useCallback(async (sshConfig: SSHConfig) => {
        const newId = generateId();
        const newFavorite: SSHConfig = {
            ...sshConfig,
            id: newId,
            name: `${sshConfig.name || sshConfig.host} - ${t('common.copySuffix') || 'Copy'}`
        };

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await ipcRenderer?.vaultInit?.() as { recoveryKey: string, config: any } | null;
        if (result) {
            setRecoveryKeyModal(result.recoveryKey);
            setVaultStatus({ isUnlocked: true, isInitialized: true });
            // Use the config returned from main process to avoid state desync
            setConfig({ ...result.config, isOnboardingCompleted: true });
        } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setConfig((prev: any) => prev ? { ...prev, isOnboardingCompleted: true } : prev);
        }
    }, [setConfig]);

    const handleVaultUnlock = async (key: string) => {
        const success = await ipcRenderer?.vaultUnlock?.(key);
        if (success) {
            setVaultStatus({ isUnlocked: true, isInitialized: true });
        }
        return success;
    };

    if (!config) return null;

    // Check for special views (like port forwarding window)
    const urlParams = new URLSearchParams(window.location?.search);
    const view = urlParams.get('view');

    if (view === 'port-forwarding') {
        const sshConfig: SSHConfig = {
            host: urlParams.get('host') || '',
            user: urlParams.get('user') || '',
            port: parseInt(urlParams.get('port') || '22'),
            name: urlParams.get('name') || '',
            password: urlParams.get('password') || '',
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

    return (
        <div className="app-container"
            style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>

            <TitleBar
                tabs={tabs}
                activeTabId={activeTabId}
                activeView={activeView}
                setActiveTabId={setActiveTabId}
                setActiveView={setActiveView}
                closeTab={closeTab}
                updater={updater}
                menuRef={menuRef}
                appConfig={config}
                isOnboarding={!config.isOnboardingCompleted}
            />

            <div style={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: config.sidebarPosition === 'right' ? 'row-reverse' : 'row' }}>
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

                    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                        {!vaultStatus.isUnlocked && vaultStatus.isInitialized && config.isOnboardingCompleted && (
                            <VaultUnlockModal
                                onUnlock={handleVaultUnlock}
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
                                showNotification={(title, message, type, action) => setNotification({ title, message, type, action })}
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
                                        />
                                    ) : (
                                        <TerminalComponent
                                            id={tab.id}
                                            theme={resolvedTheme}
                                            config={tab.config}
                                            terminalFontName={config.terminalFontName}
                                            terminalFontSize={config.terminalFontSize}
                                            terminalScrollSensitivity={config.terminalScrollSensitivity}
                                            keywordHighlighting={config.keywordHighlighting}
                                            visible={activeTabId === tab.id}
                                            onOSInfo={(info) => handleOSInfo(tab.config!, info)}
                                            enableContextMenu={config.enableTerminalContextMenu}
                                            onEditConfig={handleEditConnection}
                                            onClose={() => closeTab({ stopPropagation: () => { } } as React.MouseEvent, tab.id)}
                                            appConfig={config}
                                        />
                                    )
                                )}
                                {tab.type === 'sftp' && tab.config && (
                                    <SFTPBrowser
                                        id={tab.id}
                                        config={tab.config}
                                        visible={activeTabId === tab.id}
                                        onEditConfig={handleEditConnection}
                                        onClose={() => closeTab({ stopPropagation: () => { } } as React.MouseEvent, tab.id)}
                                        appConfig={config}
                                    />
                                )}
                                {tab.type === 'connection' && (
                                    <ConnectionForm
                                        onConnect={handleFormConnect}
                                        initialConfig={tab.config}
                                        appConfig={config}
                                        onClose={() => closeTab({ stopPropagation: () => { } } as React.MouseEvent, tab.id)}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

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
                            label: 'SFTP',
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

            {showReloadModal && (
                <ReloadConfirmModal
                    onConfirm={() => window.location?.reload()}
                    onCancel={() => setShowReloadModal(false)}
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
