import React, { useState, useMemo, useCallback } from 'react';
import { Settings, Monitor, Terminal, Keyboard, Info, Database, Share2, Layout, ShieldCheck, FileSymlink } from 'lucide-react';
import type { AppConfig, NotificationAction, NotificationType } from '../../types';
import { useUpdateChecker } from '../../hooks/useUpdateChecker';
import { stripHtml } from '../../utils';
import { useI18n } from '../../utils/i18n';

import './settings/SettingsView.css';
import { InterfaceSection } from './settings/InterfaceSection';
import { TerminalSection } from './settings/TerminalSection';
import { TabsSection } from './settings/TabsSection';
import { SFTPSection } from './settings/SFTPSection';
import { FileAssociationsSection } from './settings/FileAssociationsSection';
import { ShortcutsSection } from './settings/ShortcutsSection';
import { SecuritySection } from './settings/SecuritySection';
import { BackupSection } from './settings/BackupSection';
import { AboutSection } from './settings/AboutSection';

const { ipcRenderer } = window;

type SettingsTabId = 'interface' | 'terminal' | 'tabs' | 'sftp' | 'file-associations' | 'shortcuts' | 'security' | 'backup' | 'about';

interface SettingsViewProps {
    config: AppConfig;
    setConfig: (config: AppConfig | ((prev: AppConfig | null) => AppConfig | null)) => void;
    systemFonts: string[];
    showNotification: (title: string, message: string, type?: NotificationType, action?: NotificationAction) => void;
    refreshVaultStatus: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = React.memo(({ config, setConfig, systemFonts, showNotification, refreshVaultStatus }) => {
    const { t } = useI18n(config.language);
    const { updateInfo, status, progress, error: updateError, startDownload, quitAndInstall } = useUpdateChecker();
    const [isChecking, setIsChecking] = useState(false);
    const [manualCheckResult, setManualCheckResult] = useState<{ available: boolean, version?: string, url?: string, error?: string } | null>(null);
    const [fileAssociationDraftExtension, setFileAssociationDraftExtension] = useState('');

    const [activeTab, setActiveTab] = useState<SettingsTabId>('interface');

    const handleUpdate = useCallback(<K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
        setConfig(prev => prev ? { ...prev, [key]: value } : null);
    }, [setConfig]);

    const navItems = useMemo(() => [
        { id: 'interface' as SettingsTabId, icon: <Monitor size={18} />, label: t('settings.interface') },
        { id: 'terminal' as SettingsTabId, icon: <Terminal size={18} />, label: t('settings.terminal') },
        { id: 'tabs' as SettingsTabId, icon: <Layout size={18} />, label: t('settings.tabs') },
        { id: 'sftp' as SettingsTabId, icon: <Share2 size={18} />, label: 'SFTP' },
        { id: 'file-associations' as SettingsTabId, icon: <FileSymlink size={18} />, label: t('settings.fileAssociations') },
        { id: 'shortcuts' as SettingsTabId, icon: <Keyboard size={18} />, label: t('settings.shortcuts') },
        { id: 'security' as SettingsTabId, icon: <ShieldCheck size={18} />, label: t('settings.auth') },
        { id: 'backup' as SettingsTabId, icon: <Database size={18} />, label: t('settings.backup') },
        { id: 'about' as SettingsTabId, icon: <Info size={18} />, label: t('settings.about') },
    ], [t]);

    const handleCheckUpdates = useCallback(async () => {
        setIsChecking(true);
        setManualCheckResult(null);
        try {
            const result = await ipcRenderer?.checkUpdates?.() as { available: boolean, version?: string, url?: string, error?: string };
            if (result.available) {
                setManualCheckResult(result);
            } else if (result.error) {
                setManualCheckResult({ available: false, error: result.error });
            } else {
                setManualCheckResult({ available: false });
            }
        } catch {
            setManualCheckResult({ available: false, error: t('settings.updateError', { error: '' }) });
        } finally {
            setIsChecking(false);
        }
    }, [t]);

    const handleExport = useCallback(async () => {
        try {
            const result = await ipcRenderer?.exportConfig?.();
            if (result) {
                showNotification(t('settings.export'), t('settings.exportSuccess'), 'success');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            showNotification(t('settings.export'), message, 'error');
        }
    }, [showNotification, t]);

    const handleImport = useCallback(async () => {
        try {
            const importResult = await ipcRenderer?.importConfig?.() as { config: AppConfig } | null;
            if (importResult && importResult.config) {
                setConfig(importResult.config);
                await refreshVaultStatus();
                showNotification(
                    t('settings.import'),
                    t('settings.importSuccess'),
                    'success',
                    {
                        label: t('settings.exitApp'),
                        onClick: () => ipcRenderer?.close?.()
                    }
                );
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            showNotification(t('settings.import'), message, 'error');
        }
    }, [refreshVaultStatus, setConfig, showNotification, t]);

    const isMac = ipcRenderer?.platform === 'darwin';
    const isLinux = ipcRenderer?.platform === 'linux';
    const isWindows = ipcRenderer?.platform === 'win32';

    const shortcuts = useMemo(() => {
        const list = [
            { label: t('settings.searchHistory'), key: 'Ctrl + R' },
        ];

        if (isMac) {
            list.push({ label: t('settings.copyTerminal'), key: 'Cmd + C' });
            list.push({ label: t('settings.pasteTerminal'), key: 'Cmd + V' });
        } else if (isLinux || isWindows) {
            list.push({ label: t('settings.copyTerminal'), key: 'Ctrl + Shift + C' });
            list.push({ label: t('settings.pasteTerminal'), key: 'Ctrl + Shift + V' });
        }

        return list;
    }, [t, isMac, isLinux, isWindows]);

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

    const saveFileAssociation = useCallback((extension: string, applicationPath: string): void => {
        setConfig(prev => {
            if (!prev) return null;
            const nextFileAssociations: Record<string, string> = {
                ...(prev.fileAssociations || {})
            };
            nextFileAssociations[extension] = applicationPath;
            return { ...prev, fileAssociations: nextFileAssociations };
        });
    }, [setConfig]);

    const handleAddFileAssociation = useCallback(async (): Promise<void> => {
        const extension = normalizeExtension(fileAssociationDraftExtension);
        if (!extension) {
            showNotification(t('settings.fileAssociations'), t('settings.fileAssociationInvalidExtension'), 'error');
            return;
        }
        const applicationPath = await ipcRenderer?.selectExecutableFile?.();
        if (!applicationPath) {
            return;
        }
        saveFileAssociation(extension, applicationPath);
        setFileAssociationDraftExtension('');
    }, [fileAssociationDraftExtension, saveFileAssociation, showNotification, t]);

    const handleEditFileAssociation = useCallback(async (extension: string): Promise<void> => {
        const applicationPath = await ipcRenderer?.selectExecutableFile?.();
        if (!applicationPath) {
            return;
        }
        saveFileAssociation(extension, applicationPath);
    }, [saveFileAssociation]);

    const handleDeleteFileAssociation = useCallback((extension: string): void => {
        showNotification(
            t('settings.fileAssociations'),
            t('settings.fileAssociationDeleteConfirm', { extension }),
            'info',
            {
                label: t('common.delete'),
                cancelLabel: t('common.cancel'),
                onClick: () => {
                    setConfig(prev => {
                        if (!prev) return null;
                        const nextFileAssociations: Record<string, string> = {
                            ...(prev.fileAssociations || {})
                        };
                        delete nextFileAssociations[extension];
                        return { ...prev, fileAssociations: nextFileAssociations };
                    });
                }
            }
        );
    }, [setConfig, showNotification, t]);

    const fileAssociationEntries = useMemo(() => {
        return Object.entries(config.fileAssociations || {}).sort((leftEntry, rightEntry) => {
            return leftEntry[0].localeCompare(rightEntry[0]);
        });
    }, [config.fileAssociations]);

    const handleRegenerateKey = useCallback(async () => {
        showNotification(
            t('vault.regenerate'),
            t('vault.regenerateDesc'),
            'info',
            {
                label: t('common.yes'),
                cancelLabel: t('common.cancel'),
                onClick: async () => {
                    const newKey = await ipcRenderer?.vaultRegenerateKey?.();
                    if (newKey) {
                        setConfig((prev: AppConfig | null) => prev ? { ...prev, hasAcknowledgedRecoveryKey: false } : null);
                        window.dispatchEvent(new CustomEvent('show-recovery-key', { detail: newKey }));
                    }
                }
            }
        );
    }, [setConfig, showNotification, t]);

    const languageOptions = useMemo(() => [
        { value: 'ru', label: 'Русский' },
        { value: 'en', label: 'English' }
    ], []);

    const themeOptions = useMemo(() => [
        { value: 'Auto', label: t('settings.themeAuto') },
        { value: 'Light', label: t('settings.themeLight') },
        { value: 'Dark', label: t('settings.themeDark') },
        { value: 'Gruvbox Light', label: t('settings.themeGruvboxLight') },
        { value: 'Gruvbox Dark', label: t('settings.themeGruvboxDark') },
        { value: 'Windows Terminal', label: t('settings.themeWindowsTerminal') }
    ], [t]);

    const uiFontOptions = useMemo(() => systemFonts
        .filter(font => ['Inter', 'JetBrains Mono', 'Fira Mono'].includes(font))
        .map(font => ({ value: font, label: font })), [systemFonts]);

    const serverCardSizeOptions = useMemo(() => [
        { value: 'standard', label: t('settings.serverCardSizeStandard') },
        { value: 'medium', label: t('settings.serverCardSizeMedium') },
        { value: 'compact', label: t('settings.serverCardSizeCompact') }
    ], [t]);

    const sidebarPositionOptions = useMemo(() => [
        { value: 'left', label: t('settings.sidebarPositionLeft') },
        { value: 'right', label: t('settings.sidebarPositionRight') }
    ], [t]);

    const terminalFontOptions = useMemo(() => systemFonts.map(font => ({ value: font, label: font })), [systemFonts]);

    const keywordList = useMemo(() => [
        { label: 'Error', color: '#ef4444' },
        { label: 'Warning / WARN', color: '#fbbf24' },
        { label: 'OK', color: '#10b981' },
        { label: 'Info', color: '#60a5fa' },
        { label: 'Debug', color: '#c084fc' }
    ], []);

    return (
        <div className="settings-view-wrapper">
            <div className="settings-sidebar">
                <div className="settings-sidebar-header">
                    <div className="sidebar-icon-box">
                        <Settings size={18} />
                    </div>
                    <div className="sidebar-title-box">
                        <h3>{t('settings.title')}</h3>
                    </div>
                </div>

                <div className="settings-sidebar-menu">
                    {navItems.map(item => (
                        <button
                            key={item.id}
                            className={`settings-sidebar-item ${activeTab === item.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(item.id)}
                        >
                            <span className="settings-sidebar-item-icon">{item.icon}</span>
                            <span className="settings-sidebar-item-label">{item.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="settings-content-area">
                <div className="settings-content-header">
                    <div className="settings-active-title">
                        {navItems.find(item => item.id === activeTab)?.label}
                    </div>
                </div>

                <div className="settings-tab-content">
                    {activeTab === 'interface' && (
                        <InterfaceSection
                            config={config}
                            handleUpdate={handleUpdate}
                            languageOptions={languageOptions}
                            themeOptions={themeOptions}
                            uiFontOptions={uiFontOptions}
                            serverCardSizeOptions={serverCardSizeOptions}
                            sidebarPositionOptions={sidebarPositionOptions}
                            t={t}
                        />
                    )}

                    {activeTab === 'terminal' && (
                        <TerminalSection
                            config={config}
                            handleUpdate={handleUpdate}
                            terminalFontOptions={terminalFontOptions}
                            keywordList={keywordList}
                            t={t}
                        />
                    )}

                    {activeTab === 'tabs' && (
                        <TabsSection
                            config={config}
                            handleUpdate={handleUpdate}
                            t={t}
                        />
                    )}

                    {activeTab === 'sftp' && (
                        <SFTPSection
                            config={config}
                            handleUpdate={handleUpdate}
                            t={t}
                        />
                    )}

                    {activeTab === 'file-associations' && (
                        <FileAssociationsSection
                            fileAssociationDraftExtension={fileAssociationDraftExtension}
                            setFileAssociationDraftExtension={setFileAssociationDraftExtension}
                            handleAddFileAssociation={handleAddFileAssociation}
                            fileAssociationEntries={fileAssociationEntries}
                            handleEditFileAssociation={handleEditFileAssociation}
                            handleDeleteFileAssociation={handleDeleteFileAssociation}
                            t={t}
                        />
                    )}

                    {activeTab === 'shortcuts' && (
                        <ShortcutsSection
                            shortcuts={shortcuts}
                            t={t}
                        />
                    )}

                    {activeTab === 'security' && (
                        <SecuritySection
                            handleRegenerateKey={handleRegenerateKey}
                            t={t}
                        />
                    )}

                    {activeTab === 'backup' && (
                        <BackupSection
                            handleExport={handleExport}
                            handleImport={handleImport}
                            t={t}
                        />
                    )}

                    {activeTab === 'about' && (
                        <AboutSection
                            handleCheckUpdates={handleCheckUpdates}
                            isChecking={isChecking}
                            updateInfo={updateInfo}
                            status={status}
                            progress={progress}
                            updateError={updateError}
                            startDownload={startDownload}
                            quitAndInstall={quitAndInstall}
                            manualCheckResult={manualCheckResult}
                            showNotification={showNotification}
                            stripHtml={stripHtml}
                            ipcRenderer={ipcRenderer}
                            t={t}
                        />
                    )}
                </div>
            </div>
        </div>
    );
});
