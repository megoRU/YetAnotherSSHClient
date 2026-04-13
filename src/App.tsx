import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TerminalComponent } from './components/Terminal';
import { SFTPBrowser } from './components/SFTPBrowser';
import { ConnectionForm } from './components/ConnectionForm';
import { ContextMenu } from './components/layout/ContextMenu';
import { Edit2, Folder, Play, Trash2 } from 'lucide-react';

import { TitleBar } from './components/layout/TitleBar';
import { TabBar } from './components/layout/TabBar';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { HomeView } from './components/views/HomeView';
import { SettingsView } from './components/views/SettingsView';
import { DeleteServerModal } from './components/modals/DeleteServerModal';
import { ReloadConfirmModal } from './components/modals/ReloadConfirmModal';
import { NotificationModal } from './components/modals/NotificationModal';

import { useConfig } from './hooks/useConfig';
import { useTabs } from './hooks/useTabs';
import { useSystemFonts } from './hooks/useSystemFonts';
import { useUpdateChecker } from './hooks/useUpdateChecker';
import type { SSHConfig, NotificationType } from './types';
import { generateId, toBase64, fromBase64 } from './utils';

import './styles/light.css';
import './styles/dark.css';
import './styles/gruvbox-light.css';
import './App.css';

const { ipcRenderer } = window;

function App() {
    const { config, setConfig } = useConfig();
    const systemFonts = useSystemFonts();
    const updateAvailable = useUpdateChecker();

    const {
        tabs,
        activeTabId,
        setActiveTabId,
        addTab,
        closeTab,
        setTabs
    } = useTabs([{ id: '0', type: 'home', title: 'Главная' }]);

    const [serverToDelete, setServerToDelete] = useState<SSHConfig | null>(null);
    const [showReloadModal, setShowReloadModal] = useState(false);
    const [notification, setNotification] = useState<{ title: string, message: string, type?: NotificationType, action?: { label: string, onClick: () => void } } | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, options?: { label: string, icon: React.ReactNode, onClick: () => void, danger?: boolean }[], config?: SSHConfig } | null>(null);

    const isConnectingRef = useRef(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                // menuRef is used for TitleBar, but since we removed menus from it,
                // we might not need this anymore or can keep it if we plan to add menus back.
            }
        };
        document.addEventListener('mousedown', handleClickOutside);

        const unsubReload = ipcRenderer.on('app-reload-request', () => {
            // Если фокус в терминале, мы принудительно посылаем Ctrl+R в сессию вместо перезагрузки
            if (document.activeElement?.closest('.terminal-container')) {
                window.dispatchEvent(new CustomEvent('terminal-force-ctrl-r'));
            } else {
                setShowReloadModal(true);
            }
        });

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            if (typeof unsubReload === 'function') unsubReload();
        };
    }, []);

    const saveFavorite = useCallback((sshConfig: SSHConfig) => {
        if (!config) return null;
        const name = sshConfig.name || `${sshConfig.user}@${sshConfig.host}`;
        const newFavorite = {
            ...sshConfig,
            id: sshConfig.id || generateId(),
            name,
            password: toBase64(sshConfig.password || '')
        };

        const existingIndex = config.favorites.findIndex(f =>
            f.id === newFavorite.id ||
            (f.host === newFavorite.host && f.user === newFavorite.user && f.port === newFavorite.port)
        );

        let newFavorites;
        if (existingIndex > -1) {
            newFavorites = [...config.favorites];
            newFavorites[existingIndex] = newFavorite;
        } else {
            newFavorites = [...config.favorites, newFavorite];
        }

        setConfig({ ...config, favorites: newFavorites });
        return newFavorite;
    }, [config, setConfig]);

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
                password: toBase64(sshConfig.password || '')
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
        if (!config) return;

        const prettyNameMatch = osInfo.match(/PRETTY_NAME="([^"]+)"/);
        const osPrettyName = prettyNameMatch ? prettyNameMatch[1] : undefined;

        if (osPrettyName && sshConfig.osPrettyName !== osPrettyName) {
            console.log(`[App] Updating OS info for ${sshConfig.host}: ${osPrettyName}`);

            const newFavorites = config.favorites.map(fav => {
                if (fav.id === sshConfig.id) {
                    return { ...fav, osPrettyName };
                }
                return fav;
            });

            const newConfig = { ...config, favorites: newFavorites };
            setConfig(newConfig);

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
    }, [config, setConfig, setTabs]);


    const confirmDeleteFavorite = () => {
        if (!config || !serverToDelete) return;

        const newFavorites = config.favorites.filter(f =>
            f.id !== serverToDelete.id &&
            !(f.host === serverToDelete.host && f.user === serverToDelete.user && f.port === serverToDelete.port)
        );

        setConfig({ ...config, favorites: newFavorites });
        setServerToDelete(null);
    };

    if (!config) return null;

    return (
        <div className="app-container"
            style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>

            <TitleBar
                addTab={addTab}
                updateAvailable={updateAvailable}
                menuRef={menuRef}
            />

            <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
                <div className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

                    <TabBar
                        tabs={tabs}
                        activeTabId={activeTabId}
                        setActiveTabId={setActiveTabId}
                        addTab={addTab}
                        closeTab={closeTab}
                    />

                    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                        {tabs.map(tab => (
                            <div key={tab.id}
                                className={activeTabId === tab.id ? 'tab-content-active' : ''}
                                style={{
                                    display: activeTabId === tab.id ? 'block' : 'none',
                                    height: '100%',
                                    width: '100%'
                                }}>
                                {tab.type === 'home' && (
                                    <HomeView
                                        config={config}
                                        addTab={addTab}
                                        onContextMenu={(e, fav) => {
                                            e.preventDefault();
                                            setContextMenu({ x: e.clientX, y: e.clientY, config: fav });
                                        }}
                                    />
                                )}
                                {tab.type === 'ssh' && tab.config && (
                                    <TerminalComponent
                                        id={tab.id}
                                        theme={config.theme}
                                        config={tab.config}
                                        terminalFontName={config.terminalFontName}
                                        terminalFontSize={config.terminalFontSize}
                                        visible={activeTabId === tab.id}
                                        onOSInfo={(info) => handleOSInfo(tab.config!, info)}
                                        enableContextMenu={config.enableTerminalContextMenu}
                                    />
                                )}
                                {tab.type === 'sftp' && tab.config && (
                                    <SFTPBrowser
                                        id={tab.id}
                                        config={tab.config}
                                        visible={activeTabId === tab.id}
                                    />
                                )}
                                {tab.type === 'connection' && (
                                    <ConnectionForm
                                        onConnect={handleFormConnect}
                                        initialConfig={tab.config}
                                    />
                                )}
                                {(tab.type === 'settings' || tab.type === 'about') && (
                                    <SettingsView
                                        config={config}
                                        setConfig={setConfig}
                                        systemFonts={systemFonts}
                                        showNotification={(title, message, type, action) => setNotification({ title, message, type, action })}
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
                            label: 'Подключиться',
                            icon: <Play size={14} />,
                            onClick: () => addTab('ssh', contextMenu.config!.name, contextMenu.config)
                        },
                        {
                            label: 'Открыть sFTP (Beta)',
                            icon: <Folder size={14} />,
                            onClick: () => {
                                const name = contextMenu.config!.name || `${contextMenu.config!.user}@${contextMenu.config!.host}`;
                                addTab('sftp', `sFTP (Beta): ${name}`, {
                                    ...contextMenu.config!,
                                    password: contextMenu.config!.password
                                });
                            }
                        },
                        {
                            label: 'Редактировать',
                            icon: <Edit2 size={14} />,
                            onClick: () => addTab('connection', `Правка: ${contextMenu.config!.name}`, {
                                ...contextMenu.config!,
                                password: fromBase64(contextMenu.config!.password || '')
                            })
                        },
                        {
                            label: 'Удалить',
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
                />
            )}

            {showReloadModal && (
                <ReloadConfirmModal
                    onConfirm={() => window.location.reload()}
                    onCancel={() => setShowReloadModal(false)}
                />
            )}

            {notification && (
                <NotificationModal
                    title={notification.title}
                    message={notification.message}
                    type={notification.type}
                    action={notification.action}
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
