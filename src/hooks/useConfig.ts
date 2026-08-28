import { useState, useLayoutEffect, useCallback, useMemo } from 'react';
import type { AppConfig } from '../types';
import { generateId } from '../utils';

const { ipcRenderer } = window;

const createBrowserFallbackConfig = (): AppConfig => {
    return {
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
        enableTerminalContextMenu: true,
        terminalScrollSensitivity: 2,
        keywordHighlighting: true,
        sftpSoundEnabled: true,
        sftpSoundVolume: 0.5,
        sftpFlashIcon: true,
        activeTabColorEnabled: false,
        alwaysShowHoverOnInactiveTabs: false,
        serverCardSize: 'standard',
        isOnboardingCompleted: true,
        hasAcknowledgedRecoveryKey: true,
        sidebarEnabled: false,
        sidebarPosition: 'left',
        fileAssociations: {},
        mcpEnabled: false,
        mcpPort: 3000,
        mcpToken: '',
        mcpRequireConfirmation: true,
        mcpAllowedServerIds: [],
        favorites: [],
    };
};

const readInitialConfig = (): AppConfig | null => {
    if (typeof ipcRenderer === 'undefined') {
        return createBrowserFallbackConfig();
    }

    if (typeof ipcRenderer.getConfigSync !== 'function') {
        return null;
    }

    try {
        const initialConfig = ipcRenderer.getConfigSync() as AppConfig;
        if (initialConfig) {
            let changed = false;

            // Гарантируем, что у избранных есть ID
            if (initialConfig.favorites && Array.isArray(initialConfig.favorites)) {
                for (const fav of initialConfig.favorites) {
                    if (!fav.id) {
                        fav.id = generateId();
                        changed = true;
                    }
                }
            }

            if (!initialConfig.serverCardSize) {
                initialConfig.serverCardSize = 'standard';
                changed = true;
            }

            if (initialConfig.sidebarEnabled === undefined) {
                initialConfig.sidebarEnabled = false;
                changed = true;
            }

            if (initialConfig.sidebarPosition === undefined) {
                initialConfig.sidebarPosition = 'left';
                changed = true;
            }

            if (initialConfig.fileAssociations === undefined) {
                initialConfig.fileAssociations = {};
                changed = true;
            }

            if (initialConfig.mcpEnabled === undefined) {
                initialConfig.mcpEnabled = false;
                changed = true;
            }

            if (!initialConfig.mcpPort) {
                initialConfig.mcpPort = 3000;
                changed = true;
            }

            if (initialConfig.mcpRequireConfirmation === undefined) {
                initialConfig.mcpRequireConfirmation = true;
                changed = true;
            }

            if (!Array.isArray(initialConfig.mcpAllowedServerIds)) {
                initialConfig.mcpAllowedServerIds = [];
                changed = true;
            }

            if (changed) {
                ipcRenderer.saveConfig(initialConfig);
            }
        }
        return initialConfig;
    } catch (e) {
        console.error('[Config] Failed to get initial config:', e);
        return createBrowserFallbackConfig();
    }
};

export const useConfig = () => {
    const [config, setConfig] = useState<AppConfig | null>(() => readInitialConfig());
    const [resolvedTheme, setResolvedTheme] = useState<string>('Light');

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
