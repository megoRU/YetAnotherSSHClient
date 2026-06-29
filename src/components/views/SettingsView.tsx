import React, { useState, useMemo } from 'react';
import { Settings, Monitor, Terminal, Keyboard, Info, RefreshCw, Download, UploadCloud, Database, Share2, Layout, Plus, Minus, ShieldCheck, FileSymlink, Edit3, Trash2 } from 'lucide-react';
import type { AppConfig, NotificationAction, NotificationType } from '../../types';
import { VERSION } from '../../types';
import { CustomSelect } from '../layout/CustomSelect';
import { useUpdateChecker } from '../../hooks/useUpdateChecker';
import { stripHtml } from '../../utils';
import { useI18n, type Language } from '../../utils/i18n';

const { ipcRenderer } = window;

interface SettingsViewProps {
    config: AppConfig;
    setConfig: (config: AppConfig | ((prev: AppConfig | null) => AppConfig | null)) => void;
    systemFonts: string[];
    showNotification: (title: string, message: string, type?: NotificationType, action?: NotificationAction) => void;
    refreshVaultStatus: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ config, setConfig, systemFonts, showNotification, refreshVaultStatus }) => {
    const { t } = useI18n(config.language);
    const { updateInfo, status, progress, error: updateError, startDownload, quitAndInstall } = useUpdateChecker();
    const [isChecking, setIsChecking] = useState(false);
    const [manualCheckResult, setManualCheckResult] = useState<{ available: boolean, version?: string, url?: string, error?: string } | null>(null);
    const [fileAssociationDraftExtension, setFileAssociationDraftExtension] = useState('');

    const handleUpdate = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
        setConfig({ ...config, [key]: value });
    };

    const navItems = useMemo(() => [
        { id: 'section-interface', icon: <Monitor size={16} />, label: t('settings.interface') },
        { id: 'section-terminal', icon: <Terminal size={16} />, label: t('settings.terminal') },
        { id: 'section-tabs', icon: <Layout size={16} />, label: t('settings.tabs') },
        { id: 'section-sftp', icon: <Share2 size={16} />, label: 'SFTP' },
        { id: 'section-file-associations', icon: <FileSymlink size={16} />, label: t('settings.fileAssociations') },
        { id: 'section-shortcuts', icon: <Keyboard size={16} />, label: t('settings.shortcuts') },
        { id: 'section-security', icon: <ShieldCheck size={16} />, label: t('connection.auth') },
        { id: 'section-backup', icon: <Database size={16} />, label: t('settings.backup') },
        { id: 'section-about', icon: <Info size={16} />, label: t('settings.about') },
    ], [t]);

    const handleCheckUpdates = async () => {
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
    };

    const handleExport = async () => {
        try {
            const result = await ipcRenderer?.exportConfig?.();
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
            const importResult = await ipcRenderer?.importConfig?.() as { config: AppConfig; isLegacyFormat: boolean; recoveryKey?: string | null } | null;
            if (importResult && importResult.config) {
                setConfig(importResult.config);
                if (importResult.isLegacyFormat && importResult.recoveryKey) {
                    window.dispatchEvent(new CustomEvent('show-recovery-key', { detail: importResult.recoveryKey }));
                }
                await refreshVaultStatus();
                showNotification(
                    t('settings.import'),
                    importResult.isLegacyFormat ? t('settings.importLegacyNoVault') : t('settings.importSuccess'),
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
    };

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

    const getApplicationName = (applicationPath: string): string => {
        const normalizedPath = applicationPath.replace(/\\/g, '/');
        const parts = normalizedPath.split('/');
        const fileName = parts.length > 0 ? parts[parts.length - 1] : applicationPath;
        if (fileName.toLowerCase().endsWith('.exe')) {
            return fileName.substring(0, fileName.length - 4);
        }
        return fileName;
    };

    const saveFileAssociation = (extension: string, applicationPath: string): void => {
        const nextFileAssociations: Record<string, string> = {
            ...(config.fileAssociations || {})
        };
        nextFileAssociations[extension] = applicationPath;
        handleUpdate('fileAssociations', nextFileAssociations);
    };

    const handleAddFileAssociation = async (): Promise<void> => {
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
                    const nextFileAssociations: Record<string, string> = {
                        ...(config.fileAssociations || {})
                    };
                    delete nextFileAssociations[extension];
                    handleUpdate('fileAssociations', nextFileAssociations);
                }
            }
        );
    };

    const fileAssociationEntries = useMemo(() => {
        return Object.entries(config.fileAssociations || {}).sort((leftEntry, rightEntry) => {
            return leftEntry[0].localeCompare(rightEntry[0]);
        });
    }, [config.fileAssociations]);

    const handleRegenerateKey = async () => {
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
    };

    return (
        <div style={{
            userSelect: 'none',
            height: '100%',
            overflowY: 'auto'
        }}>
            <div style={{
                padding: '40px',
                paddingBottom: '100px',
                maxWidth: '800px',
                margin: '0 auto'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '40px' }}>
                    <div style={{
                        width: '50px',
                        height: '50px',
                        borderRadius: '12px',
                        background: 'var(--accent)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                    }}>
                        <Settings size={28} />
                    </div>
                    <div>
                        <h2 style={{ margin: 0 }}>{t('settings.title')}</h2>
                        <div style={{ opacity: 0.7, fontSize: '1em' }}>{t('settings.subtitle')}</div>
                    </div>
                </div>

                <div className="settings-nav">
                    {navItems.map(item => (
                        <button
                            key={item.id}
                            className="settings-nav-button"
                            onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                        >
                            {item.icon}
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>

                {/* Интерфейс */}
                <div className="settings-group" id="section-interface">
                    <div className="settings-group-title">
                        <Monitor size={14} style={{ marginRight: '8px' }} /> {t('settings.interface')}
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('settings.language')}</label>
                        </div>
                        <CustomSelect
                            value={config.language}
                            onChange={val => handleUpdate('language', val as Language)}
                            options={[
                                { value: 'ru', label: 'Русский' },
                                { value: 'en', label: 'English' }
                            ]}
                            style={{ width: '200px' }}
                        />
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('settings.theme')}</label>
                            <div className="settings-description">{t('settings.subtitle')}</div>
                        </div>
                        <CustomSelect
                            value={config.theme}
                            onChange={val => handleUpdate('theme', val)}
                            options={[
                                { value: 'Auto', label: t('settings.themeAuto') },
                                { value: 'Light', label: t('settings.themeLight') },
                                { value: 'Dark', label: t('settings.themeDark') },
                                { value: 'Gruvbox Light', label: t('settings.themeGruvboxLight') },
                                { value: 'Gruvbox Dark', label: t('settings.themeGruvboxDark') },
                                { value: 'Windows Terminal', label: t('settings.themeWindowsTerminal') }
                            ]}
                            style={{ width: '200px' }}
                        />
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('settings.uiFont')}</label>
                            <div className="settings-description">{t('settings.uiFontDesc')}</div>
                        </div>
                        <CustomSelect
                            value={config.uiFontName}
                            onChange={val => handleUpdate('uiFontName', val)}
                            options={systemFonts
                                .filter(font => ['Inter', 'JetBrains Mono', 'Fira Mono'].includes(font))
                                .map(font => ({ value: font, label: font }))}
                            style={{ width: '200px' }}
                        />
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('settings.fontSize')}</label>
                            <div className="settings-description">{t('settings.fontSizeDesc')}</div>
                        </div>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            background: 'var(--hover-surface)',
                            borderRadius: '8px',
                            border: '1px solid var(--border)',
                            overflow: 'hidden',
                            height: '32px',
                            width: '100px'
                        }}>
                            <button
                                className="btn-font-control"
                                style={{ width: '32px', height: '100%', border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={() => handleUpdate('uiFontSize', Math.max(8, config.uiFontSize - 1))}
                            >
                                <Minus size={12} />
                            </button>
                            <div style={{
                                flex: 1,
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 700,
                                fontSize: '13px',
                                borderLeft: '1px solid var(--border)',
                                borderRight: '1px solid var(--border)',
                                background: 'var(--surface)',
                            }}>
                                {config.uiFontSize}
                            </div>
                            <button
                                className="btn-font-control"
                                style={{ width: '32px', height: '100%', border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={() => handleUpdate('uiFontSize', Math.min(24, config.uiFontSize + 1))}
                            >
                                <Plus size={12} />
                            </button>
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('settings.serverCardSize')}</label>
                        </div>
                        <CustomSelect
                            value={config.serverCardSize || 'standard'}
                            onChange={val => handleUpdate('serverCardSize', val as 'standard' | 'compact')}
                            options={[
                                { value: 'standard', label: t('settings.serverCardSizeStandard') },
                                { value: 'compact', label: t('settings.serverCardSizeCompact') }
                            ]}
                            style={{ width: '200px' }}
                        />
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('settings.sidebarEnabled')}</label>
                            <div className="settings-description">{t('settings.sidebarEnabledDesc')}</div>
                        </div>
                        <label className="ui-switch">
                            <input
                                type="checkbox"
                                checked={config.sidebarEnabled || false}
                                onChange={e => handleUpdate('sidebarEnabled', e.target.checked)}
                            />
                            <span className="ui-slider"></span>
                        </label>
                    </div>

                    {config.sidebarEnabled && (
                        <div className="settings-row">
                            <div className="settings-label-container">
                                <label>{t('settings.sidebarPosition')}</label>
                            </div>
                            <CustomSelect
                                value={config.sidebarPosition || 'left'}
                                onChange={val => handleUpdate('sidebarPosition', val as 'left' | 'right')}
                                options={[
                                    { value: 'left', label: t('settings.sidebarPositionLeft') },
                                    { value: 'right', label: t('settings.sidebarPositionRight') }
                                ]}
                                style={{ width: '200px' }}
                            />
                        </div>
                    )}
                </div>

                {/* Терминал */}
                <div className="settings-group" id="section-terminal">
                    <div className="settings-group-title">
                        <Terminal size={14} style={{ marginRight: '8px' }} /> {t('settings.terminal')}
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('settings.terminalFont')}</label>
                            <div className="settings-description">{t('settings.terminalFontDesc')}</div>
                        </div>
                        <CustomSelect
                            value={config.terminalFontName}
                            onChange={val => handleUpdate('terminalFontName', val)}
                            options={systemFonts.map(font => ({ value: font, label: font }))}
                            style={{ width: '200px' }}
                        />
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('settings.terminalFontSize')}</label>
                            <div className="settings-description">{t('settings.terminalFontSizeDesc')}</div>
                        </div>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            background: 'var(--hover-surface)',
                            borderRadius: '8px',
                            border: '1px solid var(--border)',
                            overflow: 'hidden',
                            height: '32px',
                            width: '100px'
                        }}>
                            <button
                                className="btn-font-control"
                                style={{ width: '32px', height: '100%', border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={() => handleUpdate('terminalFontSize', Math.max(8, config.terminalFontSize - 1))}
                            >
                                <Minus size={12} />
                            </button>
                            <div style={{
                                flex: 1,
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 700,
                                fontSize: '13px',
                                borderLeft: '1px solid var(--border)',
                                borderRight: '1px solid var(--border)',
                                background: 'var(--surface)',
                            }}>
                                {config.terminalFontSize}
                            </div>
                            <button
                                className="btn-font-control"
                                style={{ width: '32px', height: '100%', border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={() => handleUpdate('terminalFontSize', Math.min(32, config.terminalFontSize + 1))}
                            >
                                <Plus size={12} />
                            </button>
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('settings.scrollSensitivity')}</label>
                            <div className="settings-description">{t('settings.scrollSensitivityDesc')}</div>
                        </div>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            background: 'var(--hover-surface)',
                            borderRadius: '8px',
                            border: '1px solid var(--border)',
                            overflow: 'hidden',
                            height: '32px',
                            width: '100px'
                        }}>
                            <button
                                className="btn-font-control"
                                style={{ width: '32px', height: '100%', border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={() => handleUpdate('terminalScrollSensitivity', Math.max(1, config.terminalScrollSensitivity - 1))}
                            >
                                <Minus size={12} />
                            </button>
                            <div style={{
                                flex: 1,
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 700,
                                fontSize: '13px',
                                borderLeft: '1px solid var(--border)',
                                borderRight: '1px solid var(--border)',
                                background: 'var(--surface)',
                            }}>
                                {config.terminalScrollSensitivity}
                            </div>
                            <button
                                className="btn-font-control"
                                style={{ width: '32px', height: '100%', border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={() => handleUpdate('terminalScrollSensitivity', Math.min(10, config.terminalScrollSensitivity + 1))}
                            >
                                <Plus size={12} />
                            </button>
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('settings.quickCopyPaste')}</label>
                            <div className="settings-description">{t('settings.quickCopyPasteDesc')}</div>
                        </div>
                        <label className="ui-switch">
                            <input
                                type="checkbox"
                                checked={config.enableTerminalContextMenu || false}
                                onChange={e => handleUpdate('enableTerminalContextMenu', e.target.checked)}
                            />
                            <span className="ui-slider"></span>
                        </label>
                    </div>

                    <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                        <div className="settings-label-container">
                            <label>{t('settings.keywordHighlighting')}</label>
                            <div className="settings-description">{t('settings.keywordHighlightingDesc')}</div>

                            <div style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {[
                                    { label: 'Error', color: '#ef4444' },
                                    { label: 'Warning / WARN', color: '#fbbf24' },
                                    { label: 'OK', color: '#10b981' },
                                    { label: 'Info', color: '#60a5fa' },
                                    { label: 'Debug', color: '#c084fc' }
                                ].map(kw => (
                                    <div key={kw.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '200px' }}>
                                        <span style={{ fontSize: '0.9em', opacity: 0.9 }}>{kw.label}</span>
                                        <div style={{ width: '40px', height: '18px', borderRadius: '4px', background: kw.color }} />
                                    </div>
                                ))}
                            </div>
                        </div>
                        <label className="ui-switch">
                            <input
                                type="checkbox"
                                checked={config.keywordHighlighting}
                                onChange={e => handleUpdate('keywordHighlighting', e.target.checked)}
                            />
                            <span className="ui-slider"></span>
                        </label>
                    </div>
                </div>

                {/* Вкладки */}
                <div className="settings-group" id="section-tabs">
                    <div className="settings-group-title">
                        <Layout size={14} style={{ marginRight: '8px' }} /> {t('settings.tabs')}
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('settings.activeTabColor')}</label>
                            <div className="settings-description">{t('settings.activeTabColorDesc')}</div>
                        </div>
                        <label className="ui-switch">
                            <input
                                type="checkbox"
                                checked={config.activeTabColorEnabled || false}
                                onChange={e => handleUpdate('activeTabColorEnabled', e.target.checked)}
                            />
                            <span className="ui-slider"></span>
                        </label>
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('settings.alwaysHover')}</label>
                            <div className="settings-description">{t('settings.alwaysHoverDesc')}</div>
                        </div>
                        <label className="ui-switch">
                            <input
                                type="checkbox"
                                checked={config.alwaysShowHoverOnInactiveTabs || false}
                                onChange={e => handleUpdate('alwaysShowHoverOnInactiveTabs', e.target.checked)}
                            />
                            <span className="ui-slider"></span>
                        </label>
                    </div>
                </div>

                {/* SFTP */}
                <div className="settings-group" id="section-sftp">
                    <div className="settings-group-title">
                        <Share2 size={14} style={{ marginRight: '8px' }} /> SFTP
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('sftp.soundEnabled')}</label>
                        </div>
                        <label className="ui-switch">
                            <input
                                type="checkbox"
                                checked={config.sftpSoundEnabled ?? true}
                                onChange={e => handleUpdate('sftpSoundEnabled', e.target.checked)}
                            />
                            <span className="ui-slider"></span>
                        </label>
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('sftp.soundVolume')}</label>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flex: 1, maxWidth: '300px' }}>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={config.sftpSoundVolume ?? 0.5}
                                onChange={e => handleUpdate('sftpSoundVolume', parseFloat(e.target.value))}
                                className="volume-slider"
                                style={{
                                    flex: 1,
                                    cursor: 'pointer',
                                    background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${(config.sftpSoundVolume ?? 0.5) * 100}%, var(--border) ${(config.sftpSoundVolume ?? 0.5) * 100}%, var(--border) 100%)`
                                }}
                            />
                            <span style={{ minWidth: '40px', textAlign: 'right', fontWeight: 'bold', fontSize: '0.9em' }}>
                                {Math.round((config.sftpSoundVolume ?? 0.5) * 100)}%
                            </span>
                        </div>
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('sftp.flashIcon')}</label>
                        </div>
                        <label className="ui-switch">
                            <input
                                type="checkbox"
                                checked={config.sftpFlashIcon ?? true}
                                onChange={e => handleUpdate('sftpFlashIcon', e.target.checked)}
                            />
                            <span className="ui-slider"></span>
                        </label>
                    </div>
                </div>

                {/* Файловые ассоциации */}
                <div className="settings-group" id="section-file-associations">
                    <div className="settings-group-title">
                        <FileSymlink size={14} style={{ marginRight: '8px' }} /> {t('settings.fileAssociations')}
                    </div>
                    <div className="settings-description" style={{ marginBottom: '15px' }}>
                        {t('settings.fileAssociationsDesc')}
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap' }}>
                        <input
                            value={fileAssociationDraftExtension}
                            onChange={(event) => setFileAssociationDraftExtension(event.target.value)}
                            placeholder={t('settings.fileAssociationExtensionPlaceholder')}
                            style={{
                                minWidth: '120px',
                                flex: '0 0 160px',
                                padding: '10px 12px',
                                background: 'var(--input-bg)',
                                color: 'var(--text-color)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '8px'
                            }}
                        />
                        <button className="btn-secondary" onClick={handleAddFileAssociation} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}>
                            <Plus size={16} /> {t('settings.fileAssociationAdd')}
                        </button>
                    </div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: '10px', overflowX: 'auto', overflowY: 'hidden' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '100px minmax(160px, 1fr) minmax(210px, max-content)', gap: '10px', padding: '10px 12px', fontWeight: 700, background: 'var(--hover-surface)', minWidth: '520px' }}>
                            <div>{t('settings.fileAssociationExtension')}</div>
                            <div>{t('settings.fileAssociationApplication')}</div>
                            <div>{t('settings.fileAssociationActions')}</div>
                        </div>
                        {fileAssociationEntries.length === 0 && (
                            <div style={{ padding: '14px 12px', opacity: 0.7 }}>
                                {t('settings.fileAssociationEmpty')}
                            </div>
                        )}
                        {fileAssociationEntries.map(([extension, applicationPath]) => (
                            <div key={extension} style={{ display: 'grid', gridTemplateColumns: '100px minmax(160px, 1fr) minmax(210px, max-content)', gap: '10px', alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--border)', minWidth: '520px' }}>
                                <div style={{ fontWeight: 700 }}>{extension}</div>
                                <div title={applicationPath} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {getApplicationName(applicationPath)}
                                </div>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <button className="btn-secondary" onClick={() => handleEditFileAssociation(extension)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px' }}>
                                        <Edit3 size={14} /> {t('common.edit')}
                                    </button>
                                    <button className="btn-danger" onClick={() => handleDeleteFileAssociation(extension)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px' }}>
                                        <Trash2 size={14} /> {t('common.delete')}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Горячие клавиши */}
                <div className="settings-group" id="section-shortcuts">
                    <div className="settings-group-title">
                        <Keyboard size={14} style={{ marginRight: '8px' }} /> {t('settings.shortcuts')}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {shortcuts.map((s, i) => (
                            <div key={i} className="shortcut-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ opacity: 0.8, fontSize: '1rem' }}>{s.label}</span>
                                <span className="shortcut-key" style={{ padding: '4px 8px', background: 'var(--hover-surface)', borderRadius: '6px', fontSize: '0.85rem', border: '1px solid var(--border)' }}>{s.key}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Безопасность */}
                <div className="settings-group" id="section-security">
                    <div className="settings-group-title">
                        <ShieldCheck size={14} style={{ marginRight: '8px' }} /> {t('connection.auth')}
                    </div>
                    <div className="settings-description" style={{ marginBottom: '15px' }}>
                        {t('vault.regenerateDesc')}
                    </div>
                    <button
                        className="btn-secondary"
                        onClick={handleRegenerateKey}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}
                    >
                        <RefreshCw size={16} /> {t('vault.regenerate')}
                    </button>
                </div>

                {/* Резервное копирование */}
                <div className="settings-group" id="section-backup">
                    <div className="settings-group-title">
                        <Database size={14} style={{ marginRight: '8px' }} /> {t('settings.backup')}
                    </div>
                    <div className="settings-description" style={{ marginBottom: '15px' }}>
                        {t('settings.backupDesc')}
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button className="btn-secondary" onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}>
                            <Download size={16} /> {t('settings.export')}
                        </button>
                        <button className="btn-secondary" onClick={handleImport} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px' }}>
                            <UploadCloud size={16} /> {t('settings.import')}
                        </button>
                    </div>
                </div>

                {/* О программе */}
                <div className="settings-group" id="section-about">
                    <div className="settings-group-title">
                        <Info size={14} style={{ marginRight: '8px' }} /> {t('settings.about')}
                    </div>
                    <div style={{ display: 'flex', gap: '20px' }}>
                        <img
                            src="./icons/icon256.png"
                            style={{ width: '64px', height: '64px', flexShrink: 0 }}
                            alt="Logo"
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '1.2em', fontWeight: 'bold', marginBottom: '8px' }}>YetAnotherSSHClient</div>
                            <div style={{ opacity: 0.8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                                <span>{t('settings.version')}: {VERSION}</span>

                                <button
                                    onClick={handleCheckUpdates}
                                    disabled={isChecking}
                                    className="btn-secondary"
                                    style={{
                                        padding: '4px 10px',
                                        fontSize: '0.85em',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        borderRadius: '6px'
                                    }}
                                >
                                    <RefreshCw size={12} className={isChecking ? 'spin' : ''} />
                                    {isChecking ? t('settings.checkingUpdates') : t('settings.checkUpdates')}
                                </button>

                                {updateInfo?.releaseNotes && (
                                    <button
                                        onClick={() => showNotification(
                                            `${t('settings.whatsNew')} (v${updateInfo.version})`,
                                            stripHtml(updateInfo.releaseNotes!),
                                            'info'
                                        )}
                                        className="btn-secondary"
                                        style={{
                                            padding: '4px 10px',
                                            fontSize: '0.85em',
                                            borderRadius: '6px'
                                        }}
                                    >
                                        {t('settings.whatsNew')}
                                    </button>
                                )}
                            </div>

                            {(manualCheckResult || status !== 'idle') && (
                                <div style={{ marginBottom: '15px' }}>
                                    {status === 'available' && updateInfo ? (
                                        <button
                                            onClick={startDownload}
                                            className="btn-primary"
                                            style={{ padding: '6px 14px', fontSize: '0.9em', borderRadius: '6px' }}
                                        >
                                            {t('settings.download', { version: updateInfo.version })}
                                        </button>
                                    ) : status === 'downloading' && progress ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{ width: '150px', height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                                                <div style={{ width: `${progress.percent}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s' }} />
                                            </div>
                                            <span style={{ fontSize: '0.9em', fontWeight: 600 }}>{Math.round(progress.percent)}%</span>
                                        </div>
                                    ) : status === 'downloaded' ? (
                                        <button
                                            onClick={quitAndInstall}
                                            className="btn-primary"
                                            style={{ padding: '8px 16px', fontSize: '0.9em', borderRadius: '6px', background: '#10b981', border: 'none' }}
                                        >
                                            {t('settings.installing')}
                                        </button>
                                    ) : status === 'error' ? (
                                        <div style={{
                                            padding: '8px 12px',
                                            fontSize: '0.9em',
                                            borderRadius: '6px',
                                            background: 'rgba(239, 68, 68, 0.1)',
                                            color: '#ef4444',
                                            border: '1px solid rgba(239, 68, 68, 0.2)',
                                            display: 'inline-block'
                                        }}>
                                            {t('common.error')}: {updateError || ''}
                                        </div>
                                    ) : manualCheckResult ? (
                                        <div style={{ display: 'inline-block' }}>
                                            {manualCheckResult.available ? (
                                                <div style={{
                                                    padding: '6px 12px',
                                                    fontSize: '0.9em',
                                                    borderRadius: '6px',
                                                    background: 'rgba(var(--accent-rgb), 0.1)',
                                                    color: 'var(--accent)',
                                                    fontWeight: 'bold',
                                                    border: '1px solid var(--accent)'
                                                }}>
                                                    {t('settings.newVersionAvailable', { version: manualCheckResult.version! })}
                                                </div>
                                            ) : (
                                                <div style={{
                                                    padding: '6px 12px',
                                                    fontSize: '0.9em',
                                                    borderRadius: '6px',
                                                    background: 'var(--hover-surface)',
                                                    border: '1px solid var(--border)',
                                                    opacity: 0.8
                                                }}>
                                                    {manualCheckResult.error ? `${t('common.error')}: ${manualCheckResult.error}` : t('settings.noUpdates')}
                                                </div>
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '15px' }}>
                                <a href="#" onClick={(e) => {
                                    e.preventDefault();
                                    ipcRenderer?.openExternal?.('https://github.com/megoRU/YetAnotherSSHClient');
                                }} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 'bold' }}>{t('settings.github')}</a>
                                <a href="#" onClick={(e) => {
                                    e.preventDefault();
                                    ipcRenderer?.openExternal?.('https://github.com/megoRU/YetAnotherSSHClient/blob/main/LICENSE');
                                }} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 'bold' }}>{t('settings.license')}</a>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};
