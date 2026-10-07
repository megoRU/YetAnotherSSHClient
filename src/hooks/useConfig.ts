import { useState, useLayoutEffect, useCallback, useMemo } from 'react';
import type { AppConfig } from '../types';
import { generateId } from '../utils';
import { MCP_LISTEN_ADDRESS_LOCAL, resolveMcpListenAddress } from '../utils/mcpListen';

const { ipcRenderer } = window;

/**
 * Пауза перед записью конфига на диск.
 *
 * `saveConfig` в main-процессе не просто пишет файл: он заново читает и
 * парсит существующий конфиг, мигрирует ключи и синхронизирует секреты с
 * вольтом. Без паузы каждое движение ползунка громкости SFTP
 * (`SFTPSection.tsx`, `step="0.01"`) порождало полный цикл чтения-парсинга-
 * сериализации-записи. 250 мс достаточно, чтобы увидеть один результат.
 */
const SAVE_DEBOUNCE_MS = 250;

/**
 * Отложенная запись конфига: хранит последний снимок и пишет его, когда
 * изменения перестали поступать.
 *
 * Два правила, без которых дебаунс опасен:
 * * сохраняется **только последний** снимок — промежуточные не нужны, они всё
 *   равно были бы перезаписаны следующим;
 * * перед уходом со страницы ожидающая запись досылается немедленно, иначе
 *   последние правки настроек потерялись бы при закрытии окна.
 */
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
        allowPreReleaseUpdates: false,
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

            if (initialConfig.allowPreReleaseUpdates === undefined) {
                initialConfig.allowPreReleaseUpdates = false;
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
                initialConfig.mcpDangerousCommandMode !== 'ask'
                && initialConfig.mcpDangerousCommandMode !== 'allow'
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

            // Fallback-цепочка после выбранного шрифта обязательна: с `font-display: swap`
            // текст рисуется системным шрифтом, пока TTF ещё грузится. Без явного
            // fallback браузер подставил бы шрифт по умолчанию (serif), поэтому для
            // моноширинных шрифтов задаём моноширинную цепочку, для остальных — sans-serif.
            const uiFontName = config.uiFontName || 'Inter';
            const uiFallback = /mono|code/i.test(uiFontName)
                ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
                : 'system-ui, -apple-system, sans-serif';
            root.style.setProperty('--ui-font-family', `'${uiFontName}', ${uiFallback}`);
            root.style.setProperty('--ui-font-size', `${config.uiFontSize}px`);
            try {
                localStorage.setItem('last-theme', config.theme);
                localStorage.setItem('last-lang', config.language);
            } catch {
                // Недоступное хранилище не должно блокировать показ приложения.
            }

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
                if (updated) configWriter.schedule(updated);
                return updated;
            });
        } else {
            setConfig(newConfig);
            configWriter.schedule(newConfig);
        }
    }, []);

    return useMemo(() => ({
        config,
        setConfig: updateConfig,
        resolvedTheme
    }), [config, updateConfig, resolvedTheme]);
};
