import { useState, useEffect, useLayoutEffect } from 'react';
import type { AppConfig } from '../types';
import { generateId } from '../utils';

const { ipcRenderer } = window;

export const useConfig = () => {
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [resolvedTheme, setResolvedTheme] = useState<string>('Gruvbox Light');

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
                    favorites: [],
                });
            });
            return;
        }
        ipcRenderer.invoke('get-config').then((res: unknown) => {
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

            if (changed) {
                const updatedConfig = { ...loadedConfig, favorites: migratedFavorites };
                setConfig(updatedConfig);
                ipcRenderer.invoke('save-config', updatedConfig);
            } else {
                setConfig(loadedConfig);
            }
        });
    }, []);

    useLayoutEffect(() => {
        if (config) {
            const root = document.documentElement;

            const applyTheme = (theme: string) => {
                let actualTheme = theme || 'Gruvbox Light';
                if (theme === 'Auto') {
                    actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'Dark' : 'Gruvbox Light';
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

    const updateConfig = (newConfig: AppConfig) => {
        setConfig(newConfig);
        ipcRenderer?.invoke('save-config', newConfig);
    };

    return { config, setConfig: updateConfig, resolvedTheme };
};
