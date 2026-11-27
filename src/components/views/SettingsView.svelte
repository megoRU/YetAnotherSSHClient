<script module lang="ts">
    import {
        Settings,
        Monitor,
        Terminal,
        Keyboard,
        Download,
        Share2,
        PanelsTopLeft,
        FileSymlink,
        RefreshCw,
        FileText,
        KeyRound,
        Activity,
    } from '@lucide/svelte';

    import type { AppConfig, NotificationAction, NotificationType } from '../../types';

    import { useUpdateChecker } from '../../hooks/useUpdateChecker.svelte';

    import { stripHtml } from '../../utils';

    import { createI18n } from '../../utils/i18n';

    import type { VaultRegenerateResult } from '../../ipc';

    import './settings/SettingsView.css';

    import InterfaceSection from './settings/InterfaceSection.svelte';

    import TerminalSection from './settings/TerminalSection.svelte';

    import TabsSection from './settings/TabsSection.svelte';

    import SFTPSection from './settings/SFTPSection.svelte';

    import FileAssociationsSection from './settings/FileAssociationsSection.svelte';

    import ShortcutsSection from './settings/ShortcutsSection.svelte';

    import BackupSection from './settings/BackupSection.svelte';

    import AboutSection from './settings/AboutSection.svelte';

    import McpSection from './settings/McpSection.svelte';

    import LogsSection from './settings/LogsSection.svelte';

    import TelemetrySection from './settings/TelemetrySection.svelte';

    import LicenseSection from './settings/LicenseSection.svelte';

    import { type SetStateAction } from '../../utils/dom';

    const { ipcRenderer } = window;

    type SettingsTabId =
        | 'interface'
        | 'terminal'
        | 'tabs'
        | 'sftp'
        | 'file-associations'
        | 'mcp'
        | 'shortcuts'
        | 'backup'
        | 'logs'
        | 'telemetry'
        | 'license'
        | 'about';

    const SETTINGS_TAB_STORAGE_KEY = 'yash:settings:active-tab';

    const SETTINGS_TAB_IDS: SettingsTabId[] = [
        'interface',
        'terminal',
        'tabs',
        'sftp',
        'file-associations',
        'mcp',
        'shortcuts',
        'backup',
        'logs',
        'telemetry',
        'license',
        'about',
    ];

    interface SettingsViewProps {
        config: AppConfig;
        setConfig: (config: AppConfig | ((prev: AppConfig | null) => AppConfig | null)) => void;
        systemFonts: string[];
        showNotification: (
            title: string,
            message: string,
            type?: NotificationType,
            action?: NotificationAction,
        ) => void;
        refreshVaultStatus: () => Promise<void>;
    }
</script>

<script lang="ts">
    let { config, setConfig, systemFonts, showNotification, refreshVaultStatus }: SettingsViewProps = $props();

    const { t } = $derived(createI18n(config.language));

    const updateChecker = useUpdateChecker();

    let fileAssociationDraftExtension = $state.raw('');
    function setFileAssociationDraftExtension(next: SetStateAction<typeof fileAssociationDraftExtension>) {
        fileAssociationDraftExtension = typeof next === 'function' ? next(fileAssociationDraftExtension) : next;
    }

    let activeTab = $state.raw<SettingsTabId>(
        (() => {
            let saved: string | null = null;
            try {
                saved = localStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
            } catch {
                /* ignore */
            }
            return SETTINGS_TAB_IDS.includes(saved as SettingsTabId) ? (saved as SettingsTabId) : 'interface';
        })(),
    );
    function setActiveTab(next: SetStateAction<SettingsTabId>) {
        activeTab = typeof next === 'function' ? next(activeTab) : next;
    }

    const handleTabSwitch = (id: SettingsTabId) => {
        setActiveTab(id);
        try {
            localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, id);
        } catch {
            /* ignore */
        }
    };

    const handleUpdate = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
        setConfig((prev) => (prev ? { ...prev, [key]: value } : null));
    };

    const handleTelemetryToggle = async (enabled: boolean) => {
        handleUpdate('telemetryEnabled', enabled);
        if (enabled) {
            return;
        }

        try {
            const status = await ipcRenderer?.deleteTelemetry?.();
            if (typeof status !== 'number') {
                showNotification(t('settings.telemetry'), t('settings.telemetryDeleteError'), 'error');
            } else if (status === 404) {
                // Записи на сервере не было — для пользователя это тот же
                // результат, что и успешное удаление.
                showNotification(t('settings.telemetry'), t('settings.telemetryNotFound'), 'success');
            } else if (status >= 200 && status < 300) {
                showNotification(t('settings.telemetry'), t('settings.telemetryDeleted'), 'success');
            } else {
                showNotification(
                    t('settings.telemetry'),
                    t('settings.telemetryDeleteFailed', { status: String(status) }),
                    'warning',
                );
            }
        } catch {
            showNotification(t('settings.telemetry'), t('settings.telemetryDeleteError'), 'error');
        }
    };

    const isMcpRunning = $derived(Boolean(config.mcpEnabled));

    const navItems = $derived([
        {
            id: 'interface' as SettingsTabId,
            icon: { component: Monitor, size: 18 },
            label: t('settings.interface'),
        },
        {
            id: 'terminal' as SettingsTabId,
            icon: { component: Terminal, size: 18 },
            label: t('settings.terminal'),
        },
        { id: 'tabs' as SettingsTabId, icon: { component: PanelsTopLeft, size: 18 }, label: t('settings.tabs') },
        { id: 'sftp' as SettingsTabId, icon: { component: Share2, size: 18 }, label: t('settings.sftp') },
        {
            id: 'file-associations' as SettingsTabId,
            icon: { component: FileSymlink, size: 18 },
            label: t('settings.fileAssociations'),
        },
        {
            id: 'mcp' as SettingsTabId,
            icon: { component: Settings, size: 18 },
            label: t('settings.mcpAiAgents'),
            isMcp: true,
        },
        {
            id: 'shortcuts' as SettingsTabId,
            icon: { component: Keyboard, size: 18 },
            label: t('settings.shortcuts'),
        },
        { id: 'backup' as SettingsTabId, icon: { component: Download, size: 18 }, label: t('settings.backup') },
        { id: 'logs' as SettingsTabId, icon: { component: FileText, size: 18 }, label: t('settings.logs') },
        {
            id: 'telemetry' as SettingsTabId,
            icon: { component: Activity, size: 18 },
            label: t('settings.telemetry'),
        },
        {
            id: 'license' as SettingsTabId,
            icon: { component: KeyRound, size: 18 },
            label: t('settings.licenseTab'),
        },
        { id: 'about' as SettingsTabId, icon: { component: RefreshCw, size: 18 }, label: t('settings.updates') },
    ]);

    const handleCheckUpdates = async () => {
        await updateChecker.checkUpdates();
    };

    const handleExport = async () => {
        try {
            const result = await ipcRenderer?.exportConfig?.(t('settings.export'));
            if (result) {
                showNotification(t('settings.export'), t('settings.exportSuccess'), 'success');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            showNotification(t('settings.export'), message, 'error');
        }
    };

    const handleImport = async () => {
        try {
            const importResult = (await ipcRenderer?.importConfig?.(t('settings.import'))) as {
                config: AppConfig;
            } | null;
            if (importResult && importResult.config) {
                setConfig(importResult.config);
                await refreshVaultStatus();
                showNotification(t('settings.import'), t('settings.importSuccess'), 'success', {
                    label: t('settings.exitApp'),
                    onClick: () => ipcRenderer?.close?.(),
                });
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            showNotification(t('settings.import'), message, 'error');
        }
    };

    const handleExportLogs = async () => {
        try {
            const result = await ipcRenderer?.exportLogs?.(t('settings.exportLogs'));
            if (result) {
                showNotification(t('settings.exportLogs'), t('settings.exportLogsSuccess'), 'success');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            showNotification(t('settings.exportLogs'), message, 'error');
        }
    };

    const isMac = ipcRenderer?.platform === 'darwin';

    const isLinux = ipcRenderer?.platform === 'linux';

    const isWindows = ipcRenderer?.platform === 'win32';

    const appShortcuts = $derived([
        { label: t('settings.closeTabShortcut'), key: isMac ? 'Cmd + W' : 'Ctrl + W' },
        { label: t('settings.nextTabShortcut'), key: 'Ctrl + Tab' },
        { label: t('settings.prevTabShortcut'), key: 'Ctrl + Shift + Tab' },
    ]);

    const terminalShortcuts = $derived.by(() => {
        const list = [{ label: t('settings.searchHistory'), key: 'Ctrl + R' }];

        if (isMac) {
            list.push({ label: t('settings.copyTerminal'), key: 'Cmd + C' });
            list.push({ label: t('settings.pasteTerminal'), key: 'Cmd + V' });
        } else if (isLinux || isWindows) {
            list.push({ label: t('settings.copyTerminal'), key: 'Ctrl + Shift + C' });
            list.push({ label: t('settings.pasteTerminal'), key: 'Ctrl + Shift + V' });
        }

        return list;
    });

    const normalizeExtension = (value: string): string => {
        const trimmedValue = value.trim().toLowerCase();
        if (trimmedValue.length === 0) {
            return '';
        }
        if (trimmedValue.startsWith('.')) {
            return trimmedValue;
        }
        return `.${trimmedValue}`;
    };

    const saveFileAssociation = (extension: string, applicationPath: string): void => {
        setConfig((prev) => {
            if (!prev) return null;
            const nextFileAssociations: Record<string, string> = {
                ...(prev.fileAssociations || {}),
            };
            nextFileAssociations[extension] = applicationPath;
            return { ...prev, fileAssociations: nextFileAssociations };
        });
    };

    const handleAddFileAssociation = async (): Promise<void> => {
        const extension = normalizeExtension(fileAssociationDraftExtension);
        if (!extension) {
            showNotification(
                t('settings.fileAssociations'),
                t('settings.fileAssociationInvalidExtension'),
                'error',
            );
            return;
        }
        const applicationPath = await ipcRenderer?.selectExecutableFile?.();
        if (!applicationPath) {
            return;
        }
        saveFileAssociation(extension, applicationPath);
        setFileAssociationDraftExtension('');
    };

    const handleEditFileAssociation = async (extension: string): Promise<void> => {
        const applicationPath = await ipcRenderer?.selectExecutableFile?.();
        if (!applicationPath) {
            return;
        }
        saveFileAssociation(extension, applicationPath);
    };

    const handleDeleteFileAssociation = (extension: string): void => {
        showNotification(
            t('settings.fileAssociations'),
            t('settings.fileAssociationDeleteConfirm', { extension }),
            'info',
            {
                label: t('common.delete'),
                cancelLabel: t('common.cancel'),
                onClick: () => {
                    setConfig((prev) => {
                        if (!prev) return null;
                        const nextFileAssociations: Record<string, string> = {
                            ...(prev.fileAssociations || {}),
                        };
                        delete nextFileAssociations[extension];
                        return { ...prev, fileAssociations: nextFileAssociations };
                    });
                },
            },
        );
    };

    const fileAssociationEntries = $derived.by(() => {
        return Object.entries(config.fileAssociations || {}).sort((leftEntry, rightEntry) => {
            return leftEntry[0].localeCompare(rightEntry[0]);
        });
    });

    const handleRegenerateKey = async () => {
        showNotification(t('vault.regenerate'), t('vault.regenerateDesc'), 'info', {
            label: t('common.yes'),
            cancelLabel: t('common.cancel'),
            onClick: async () => {
                let result: VaultRegenerateResult | undefined;
                try {
                    result = await ipcRenderer?.vaultRegenerateKey?.();
                } catch {
                    showNotification(t('vault.regenerate'), t('vault.regenerateFailed'), 'error');
                    throw new Error('Vault key regeneration failed');
                }

                if (!result) {
                    showNotification(t('vault.regenerate'), t('vault.regenerateLocked'), 'error');
                    throw new Error('Vault is locked');
                }

                try {
                    setConfig({ ...result.config, hasAcknowledgedRecoveryKey: false });
                    await refreshVaultStatus();
                    window.dispatchEvent(new CustomEvent('show-recovery-key', { detail: result.recoveryKey }));
                } catch {
                    showNotification(t('vault.regenerate'), t('vault.regenerateFailed'), 'error');
                    throw new Error('Vault key regeneration failed');
                }
            },
        });
    };

    const languageOptions = $derived([
        { value: 'ru', label: 'Русский' },
        { value: 'en', label: 'English' },
        { value: 'sov', label: 'Советский' },
    ]);

    const themeOptions = $derived([
        { value: 'Auto', label: t('settings.themeAuto') },
        { value: 'Light', label: t('settings.themeLight') },
        { value: 'Dark', label: t('settings.themeDark') },
        { value: 'Gruvbox Light', label: t('settings.themeGruvboxLight') },
        { value: 'Gruvbox Dark', label: t('settings.themeGruvboxDark') },
        { value: 'Windows Terminal', label: t('settings.themeWindowsTerminal') },
    ]);

    const terminalThemeOptions = $derived([
        { value: 'Interface', label: t('settings.terminalThemeInterface') },
        ...themeOptions,
    ]);

    const uiFontOptions = $derived(
        systemFonts
            .filter((font) => ['Inter', 'JetBrains Mono', 'Fira Mono'].includes(font))
            .map((font) => ({ value: font, label: font })),
    );

    const serverCardSizeOptions = $derived([
        { value: 'standard', label: t('settings.serverCardSizeStandard') },
        { value: 'medium', label: t('settings.serverCardSizeMedium') },
        { value: 'compact', label: t('settings.serverCardSizeCompact') },
    ]);

    const sidebarPositionOptions = $derived([
        { value: 'left', label: t('settings.sidebarPositionLeft') },
        { value: 'right', label: t('settings.sidebarPositionRight') },
    ]);

    const terminalFontOptions = $derived(systemFonts.map((font) => ({ value: font, label: font })));

    const keywordList = $derived([
        { label: 'Error', color: '#ef4444' },
        { label: 'Warning / WARN', color: '#fbbf24' },
        { label: 'OK', color: '#10b981' },
        { label: 'Info', color: '#60a5fa' },
        { label: 'Debug', color: '#c084fc' },
    ]);
</script>

<div class="settings-view-wrapper">
    <div class="settings-sidebar">
        <div class="settings-sidebar-header">
            <div class="sidebar-icon-box">
                <Settings size={18} />
            </div>
            <div class="sidebar-title-box">
                <h3>{t('settings.title')}</h3>
            </div>
        </div>

        <div class="settings-sidebar-menu">
            {#each navItems as item (item.id)}
                {@const { component: Icon, size } = item.icon}<button
                    class={`settings-sidebar-item ${activeTab === item.id ? 'active' : ''}`}
                    onclick={() => handleTabSwitch(item.id)}
                >
                    <span class="settings-sidebar-item-icon"><Icon {size} /></span>
                    <span class="settings-sidebar-item-label">{item.label}</span>
                    {#if item.isMcp && isMcpRunning}<span
                            style="margin-left: auto; width: 8px; height: 8px; border-radius: 50%; background-color: #2ea44f; flex-shrink: 0"
                        ></span>{/if}
                    {#if item.id === 'about' && updateChecker.isUpdateAvailable}<span
                            style="margin-left: auto; width: 8px; height: 8px; border-radius: 50%; background-color: #EFC55A; flex-shrink: 0"
                        ></span>{/if}
                </button>{/each}
        </div>
    </div>

    <div class="settings-content-area">
        <div class="settings-tab-content">
            {#if activeTab === 'interface'}<InterfaceSection
                    {config}
                    {handleUpdate}
                    {languageOptions}
                    {themeOptions}
                    {uiFontOptions}
                    {serverCardSizeOptions}
                    {sidebarPositionOptions}
                    {t}
                />{/if}

            {#if activeTab === 'terminal'}<TerminalSection
                    {config}
                    {handleUpdate}
                    {terminalFontOptions}
                    {terminalThemeOptions}
                    {keywordList}
                    {t}
                />{/if}

            {#if activeTab === 'tabs'}<TabsSection {config} {handleUpdate} {t} />{/if}

            {#if activeTab === 'sftp'}<SFTPSection {config} {handleUpdate} {t} />{/if}

            {#if activeTab === 'file-associations'}<FileAssociationsSection
                    {fileAssociationDraftExtension}
                    {setFileAssociationDraftExtension}
                    {handleAddFileAssociation}
                    {fileAssociationEntries}
                    {handleEditFileAssociation}
                    {handleDeleteFileAssociation}
                    {t}
                />{/if}

            {#if activeTab === 'mcp'}<McpSection {config} {setConfig} {showNotification} />{/if}

            {#if activeTab === 'shortcuts'}<ShortcutsSection {appShortcuts} {terminalShortcuts} {t} />{/if}

            {#if activeTab === 'backup'}<BackupSection
                    {handleExport}
                    {handleImport}
                    {handleRegenerateKey}
                    {t}
                />{/if}

            {#if activeTab === 'logs'}<LogsSection {handleExportLogs} {t} />{/if}

            {#if activeTab === 'telemetry'}<TelemetrySection
                    {config}
                    onTelemetryToggle={handleTelemetryToggle}
                    {t}
                />{/if}

            {#if activeTab === 'license'}<LicenseSection {ipcRenderer} {t} />{/if}

            {#if activeTab === 'about'}<AboutSection
                    {handleCheckUpdates}
                    isChecking={updateChecker.isChecking}
                    updateInfo={updateChecker.updateInfo}
                    status={updateChecker.status}
                    progress={updateChecker.progress}
                    updateError={updateChecker.error}
                    startDownload={updateChecker.startDownload}
                    installUpdate={updateChecker.installUpdate}
                    manualCheckResult={updateChecker.manualCheckResult}
                    {showNotification}
                    {stripHtml}
                    {ipcRenderer}
                    {t}
                />{/if}
        </div>
    </div>
</div>
