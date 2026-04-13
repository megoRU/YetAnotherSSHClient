import { useState, useEffect, useLayoutEffect } from 'react';
import type { AppConfig } from '../types';
import { generateId } from '../utils';

const { ipcRenderer } = window;

export const useConfig = () => {
    const [config, setConfig] = useState<AppConfig | null>(null);

    useEffect(() => {
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
            const themeClass = config.theme.toLowerCase().replace(' ', '-');
            document.body.className = themeClass;
            document.documentElement.className = themeClass;
            root.style.setProperty('--ui-font-family', config.uiFontName);
            root.style.setProperty('--ui-font-size', `${config.uiFontSize}px`);
            localStorage.setItem('last-theme', config.theme);
        }
    }, [config]);

    const updateConfig = (newConfig: AppConfig) => {
        setConfig(newConfig);
        ipcRenderer.invoke('save-config', newConfig);
    };

    return { config, setConfig: updateConfig };
};
