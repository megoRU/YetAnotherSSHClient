import type { AppConfig } from '../types';

import { generateId } from '../utils';

import { MCP_LISTEN_ADDRESS_LOCAL, resolveMcpListenAddress } from '../utils/mcpListen';

import { untrack } from 'svelte';

import { type SetStateAction } from '../utils/dom';

const { ipcRenderer } = window;

const SAVE_DEBOUNCE_MS = 250;

function createConfigWriter() {
    let pending: AppConfig | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let installed = false;

    const write = (config: AppConfig) => {
        void ipcRenderer?.saveConfig?.(config);
    };

    const flush = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        if (!pending) {
            return;
        }
        const config = pending;
        pending = null;
        write(config);
    };

    const schedule = (config: AppConfig) => {
        pending = config;

        if (!installed) {
            installed = true;
            // `pagehide` надёжнее `beforeunload` в WebView2: срабатывает и при
            // закрытии окна, и при уходе со страницы без диалога подтверждения.
            window.addEventListener('pagehide', flush);
            window.addEventListener('beforeunload', flush);
        }

        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    };

    return { schedule, flush };
}

const configWriter = createConfigWriter();

const createBrowserFallbackConfig = (): AppConfig => {
    return {
        terminalTheme: 'Interface',
        terminalFontName: 'JetBrains Mono',
        terminalFontSize: 17,
        uiFontName: 'JetBrains Mono',
        uiFontSize: 14,
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
        terminalScrollback: 10000,
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
        mcpListenAddress: MCP_LISTEN_ADDRESS_LOCAL,
        mcpToken: '',
        mcpDangerousCommandMode: 'ask',
        mcpDisabledDangerCommands: [],
        mcpAllowedServerIds: [],
        clientId: '',
        telemetryEnabled: true,
        favorites: [],
    };
};

const readInitialConfig = (): AppConfig | null => {
    if (typeof ipcRenderer === 'undefined') {
        return createBrowserFallbackConfig();
    }

    if (typeof ipcRenderer.getConfigSync !== 'function') {
        console.error('[Config] Synchronous config is unavailable; using safe defaults.');
        return createBrowserFallbackConfig();
    }

    try {
        const storedConfig = ipcRenderer.getConfigSync() as Partial<AppConfig> | null;
        const hasStoredConfig = storedConfig !== null && Object.keys(storedConfig).length > 0;
        const initialConfig: AppConfig = {
            ...createBrowserFallbackConfig(),
            ...storedConfig,
            favorites: Array.isArray(storedConfig?.favorites) ? storedConfig.favorites : [],
        };
        if (hasStoredConfig) {
            let changed = false;

            if (!Array.isArray(storedConfig.favorites)) {
                changed = true;
            }

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

            if (![5000, 10000, 20000, 50000].includes(initialConfig.terminalScrollback)) {
                initialConfig.terminalScrollback = 10000;
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

            // Старые конфиги без адреса прослушивания остаются локальными:
            // сетевой доступ MCP-сервера включается только явным выбором.
            const listenAddress = resolveMcpListenAddress(initialConfig.mcpListenAddress);
            if (initialConfig.mcpListenAddress !== listenAddress) {
                initialConfig.mcpListenAddress = listenAddress;
                changed = true;
            }

            if (
                initialConfig.mcpDangerousCommandMode !== 'ask' &&
                initialConfig.mcpDangerousCommandMode !== 'allow'
            ) {
                initialConfig.mcpDangerousCommandMode = 'ask';
                changed = true;
            }

            if (!Array.isArray(initialConfig.mcpDisabledDangerCommands)) {
                initialConfig.mcpDisabledDangerCommands = [];
                changed = true;
            }

            if (!Array.isArray(initialConfig.mcpAllowedServerIds)) {
                initialConfig.mcpAllowedServerIds = [];
                changed = true;
            }

            if (changed) {
                // Миграция старого конфига идёт через тот же писатель, что и
                // обычные правки: один путь записи вместо обхода дебаунса.
                // Отложенная запись не потеряется — писатель досылает её на
                // `pagehide`.
                configWriter.schedule(initialConfig);
            }
        }
        return initialConfig;
    } catch (e) {
        console.error('[Config] Failed to get initial config:', e);
        return createBrowserFallbackConfig();
    }
};

export const useConfig = () => {
    let config = $state.raw<AppConfig | null>(readInitialConfig());
    function setConfig(next: SetStateAction<AppConfig | null>) {
        config = typeof next === 'function' ? next(config) : next;
    }
    let resolvedTheme = $state.raw<string>('Light');
    function setResolvedTheme(next: SetStateAction<string>) {
        resolvedTheme = typeof next === 'function' ? next(resolvedTheme) : next;
    }
    let systemTheme = $state.raw('Light');
    function setSystemTheme(next: SetStateAction<typeof systemTheme>) {
        systemTheme = typeof next === 'function' ? next(systemTheme) : next;
    }
    const terminalTheme = $derived(config?.terminalTheme);
    const resolvedTerminalTheme = $derived(
        terminalTheme === 'Auto'
            ? systemTheme
            : !terminalTheme || terminalTheme === 'Interface'
              ? resolvedTheme
              : terminalTheme,
    );

    $effect.pre(() => {
        const current = config;
        if (!current) return;
        return untrack(() => {
            const root = document.documentElement;
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

            const applyTheme = () => {
                const preferredTheme = mediaQuery.matches ? 'Dark' : 'Light';
                const actualTheme = current.theme === 'Auto' ? preferredTheme : current.theme || 'Light';
                setSystemTheme(preferredTheme);
                setResolvedTheme(actualTheme);
                const themeClass = actualTheme.toLowerCase().replace(' ', '-');
                document.body.className = themeClass;
                document.documentElement.className = themeClass;
            };

            applyTheme();

            // Fallback-цепочка после выбранного шрифта обязательна: с `font-display: swap`
            // текст рисуется системным шрифтом, пока TTF ещё грузится. Без явного
            // fallback браузер подставил бы шрифт по умолчанию (serif), поэтому для
            // моноширинных шрифтов задаём моноширинную цепочку, для остальных — sans-serif.
            const uiFontName = current.uiFontName || 'Inter';
            const uiFallback = /mono|code/i.test(uiFontName)
                ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
                : 'system-ui, -apple-system, sans-serif';
            root.style.setProperty('--ui-font-family', `'${uiFontName}', ${uiFallback}`);
            root.style.setProperty('--ui-font-size', `${current.uiFontSize}px`);
            root.style.setProperty('--ui-font-size-base', `${current.uiFontSize}px`);
            root.style.setProperty('--ui-font-size-sm', `${Math.max(8, current.uiFontSize - 2)}px`);
            root.style.setProperty('--font-size-base', `${current.uiFontSize}px`);
            root.style.setProperty('--font-size-secondary', `${Math.max(8, current.uiFontSize - 2)}px`);
            try {
                localStorage.setItem('last-theme', current.theme);
                localStorage.setItem('last-lang', current.language);
            } catch {
                // Недоступное хранилище не должно блокировать показ приложения.
            }

            if (current.theme === 'Auto' || current.terminalTheme === 'Auto') {
                mediaQuery.addEventListener('change', applyTheme);
                return () => mediaQuery.removeEventListener('change', applyTheme);
            }
        });
    });

    const updateConfig = (newConfig: AppConfig | ((prev: AppConfig | null) => AppConfig | null)) => {
        if (typeof newConfig === 'function') {
            setConfig((prev) => {
                const updated = newConfig(prev);
                if (updated) configWriter.schedule(updated);
                return updated;
            });
        } else {
            setConfig(newConfig);
            configWriter.schedule(newConfig);
        }
    };

    return {
        get config() {
            return config;
        },
        setConfig: updateConfig,
        get resolvedTheme() {
            return resolvedTheme;
        },
        get resolvedTerminalTheme() {
            return resolvedTerminalTheme;
        },
    };
};
