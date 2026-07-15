import { useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import type { AppConfig } from '../types';
import { generateId } from '../utils';

const { ipcRenderer } = window;

function isInitialAppConfig(value: unknown): value is AppConfig {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<AppConfig>;
    if (typeof candidate.theme !== 'string') {
        return false;
    }

    if (typeof candidate.language !== 'string') {
        return false;
    }

    if (typeof candidate.uiFontName !== 'string') {
        return false;
    }

    if (typeof candidate.uiFontSize !== 'number') {
        return false;
    }

    if (!Array.isArray(candidate.favorites)) {
        return false;
    }

    return true;
}

function getInitialConfigFromPreload(): AppConfig | null {
    if (typeof ipcRenderer === 'undefined') {
        return null;
    }

    if (typeof ipcRenderer.getInitialConfig !== 'function') {
        return null;
    }

    const initialConfig = ipcRenderer.getInitialConfig();
    if (!isInitialAppConfig(initialConfig)) {
        return null;
    }

    return initialConfig;
}

function getInitialResolvedTheme(initialConfig: AppConfig | null): string {
    if (!initialConfig) {
        return 'Light';
    }

    if (initialConfig.theme === 'Auto') {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'Dark';
        }

        return 'Light';
    }

    return initialConfig.theme;
}

export const useConfig = () => {
    const initialConfig = useMemo(() => getInitialConfigFromPreload(), []);
    const [config, setConfig] = useState<AppConfig | null>(() => initialConfig);
    const [resolvedTheme, setResolvedTheme] = useState<string>(() => getInitialResolvedTheme(initialConfig));

    useEffect(() => {
        if (typeof ipcRenderer === 'undefined') {
            // Фолбек для окружения без Electron (тесты/Playwright в вебе)
            // Используем Promise.resolve, чтобы избежать синхронного вызова setState в эффекте
            Promise.resolve().then(() => {
                setConfig({
                    terminalFontName: 'JetBrains Mono',
                    terminalFontSize: 17,
                    uiFontName: 'JetBrains Mono',
                    uiFontSize: 13,
                    theme: 'Dark',
                    language: 'ru',
                    x: 304,
                    y: 121,
                    width: 1392,
                    height: 941,
                    maximized: false,
                    lastUpdateCheck: 29041999,
                    enableTerminalContextMenu: false,
                    terminalScrollSensitivity: 2,
                    keywordHighlighting: true,
                    sftpSoundEnabled: true,
                    sftpSoundVolume: 0.5,
                    sftpFlashIcon: true,
                    activeTabColorEnabled: false,
                    alwaysShowHoverOnInactiveTabs: false,
                    serverCardSize: 'standard',
                    isOnboardingCompleted: true, // В вебе/тестах считаем завершенным
                    hasAcknowledgedRecoveryKey: true,
                    sidebarEnabled: false,
                    sidebarPosition: 'left',
                    fileAssociations: {},
                    favorites: [],
                });
            });
            return;
        }
        ipcRenderer?.getConfig?.().then((res: unknown) => {
            const loadedConfig = res as AppConfig;
            let changed = false;
            const migratedFavorites = (loadedConfig.favorites || []).map(fav => {
                if (!fav.id) {
                    changed = true;
                    return { ...fav, id: generateId() };
                }
                return fav;
            });

            if (!loadedConfig.serverCardSize) {
                loadedConfig.serverCardSize = 'standard';
                changed = true;
            }

            if (loadedConfig.sidebarEnabled === undefined) {
                loadedConfig.sidebarEnabled = false;
                changed = true;
            }

            if (loadedConfig.sidebarPosition === undefined) {
                loadedConfig.sidebarPosition = 'left';
                changed = true;
            }

            if (loadedConfig.fileAssociations === undefined) {
                loadedConfig.fileAssociations = {};
                changed = true;
            }

            if (changed) {
                const updatedConfig = { ...loadedConfig, favorites: migratedFavorites };
                setConfig(updatedConfig);
                ipcRenderer?.saveConfig?.(updatedConfig);
            } else {
                setConfig(loadedConfig);
            }
        });
    }, []);

    useLayoutEffect(() => {
        if (config) {
            const root = document.documentElement;

            const applyTheme = (theme: string) => {
                let actualTheme = theme || 'Light';
                if (theme === 'Auto') {
                    actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'Dark' : 'Light';
                }
                setResolvedTheme(actualTheme);
                const themeClass = actualTheme.toLowerCase().replace(' ', '-');
                document.body.className = themeClass;
                document.documentElement.className = themeClass;
            };

            applyTheme(config.theme);

            root.style.setProperty('--ui-font-family', config.uiFontName);
            root.style.setProperty('--ui-font-size', `${config.uiFontSize}px`);
            localStorage.setItem('last-theme', config.theme);
            localStorage.setItem('last-lang', config.language);

            if (config.theme === 'Auto') {
                const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
                const handleChange = () => applyTheme('Auto');
                mediaQuery.addEventListener('change', handleChange);
                return () => mediaQuery.removeEventListener('change', handleChange);
            }
        }
    }, [config]);

    const updateConfig = useCallback((newConfig: AppConfig | ((prev: AppConfig | null) => AppConfig | null)) => {
        if (typeof newConfig === 'function') {
            setConfig(prev => {
                const updated = newConfig(prev);
                if (updated) ipcRenderer?.saveConfig?.(updated);
                return updated;
            });
        } else {
            setConfig(newConfig);
            ipcRenderer?.saveConfig?.(newConfig);
        }
    }, []);

    return useMemo(() => ({
        config,
        setConfig: updateConfig,
        resolvedTheme
    }), [config, updateConfig, resolvedTheme]);
};
