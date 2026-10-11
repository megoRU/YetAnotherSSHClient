import React, { useMemo, useState, type FC } from 'react';
import { Home, RefreshCw, Upload, ChevronRight, Eye, Bookmark } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import type { AppConfig } from '../../types';

interface SftpToolbarProps {
    path: string;
    loading: boolean;
    refreshing?: boolean;
    showHidden: boolean;
    hasHiddenFiles: boolean;
    onGoHome: () => void;
    onToggleHidden: () => void;
    onRefresh: () => void;
    onUpload: (mode: 'file' | 'folder') => void;
    onNavigate: (path: string) => void;
    defaultDirectory?: string;
    onSetDefaultDirectory: () => void;
    appConfig?: AppConfig;
}

export const SftpToolbar: FC<SftpToolbarProps> = React.memo(({
    path,
    loading,
    refreshing,
    showHidden,
    hasHiddenFiles,
    onGoHome,
    onToggleHidden,
    onRefresh,
    onUpload,
    onNavigate,
    defaultDirectory,
    onSetDefaultDirectory,
    appConfig
}) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    const [showDefaultTooltip, setShowDefaultTooltip] = useState(false);
    const [showHiddenTooltip, setShowHiddenTooltip] = useState(false);
    const breadcrumbs = useMemo(() => {
        const parts = path.split('/').filter(Boolean);
        const crumbs = [{ name: '/', path: '/' }];
        let currentPath = '';
        for (const part of parts) {
            currentPath += `/${part}`;
            crumbs.push({ name: part, path: currentPath });
        }
        return crumbs;
    }, [path]);

    return (
        <div className="sftp-toolbar" style={{
            padding: '10.2px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'rgba(0,0,0,0.02)'
        }} onClick={e => e.stopPropagation()}>
            <button
                onClick={onGoHome}
                disabled={loading}
                className="btn-secondary"
                style={{ padding: '5px', display: 'flex', alignItems: 'center' }}
            >
                <Home size={18} />
            </button>
            <div
                style={{ position: 'relative', display: 'flex' }}
                onMouseEnter={() => setShowDefaultTooltip(true)}
                onMouseLeave={() => setShowDefaultTooltip(false)}
                onFocus={() => setShowDefaultTooltip(true)}
                onBlur={() => setShowDefaultTooltip(false)}
            >
                <button
                    onClick={onSetDefaultDirectory}
                    disabled={loading || !path}
                    className="btn-secondary"
                    aria-label={t('sftp.setDefaultDirectory')}
                    style={{
                        padding: '5px',
                        display: 'flex',
                        alignItems: 'center',
                        color: defaultDirectory === path ? 'var(--accent)' : 'inherit',
                        borderColor: defaultDirectory === path ? 'var(--accent)' : undefined
                    }}
                >
                    <Bookmark size={18} fill={defaultDirectory === path ? 'currentColor' : 'none'} />
                </button>
                {showDefaultTooltip && (
                    <div role="tooltip" style={{
                        position: 'absolute',
                        top: 'calc(100% + 10px)',
                        left: 0,
                        zIndex: 1200,
                        width: 'max-content',
                        maxWidth: 'min(380px, calc(100vw - 50px))',
                        padding: '10px 12px',
                        border: '1px solid var(--border-color)',
                        borderRadius: '9px',
                        background: 'var(--bg-color)',
                        color: 'var(--text-color)',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                        pointerEvents: 'none',
                        fontSize: 'var(--font-size-secondary)',
                        lineHeight: 1.4
                    }}>
                        <div style={{ fontWeight: 600, marginBottom: '3px' }}>
                            {defaultDirectory === path ? t('sftp.defaultDirectoryIsSet') : t('sftp.setDefaultDirectory')}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{path}</div>
                    </div>
                )}
            </div>
            <div
                style={{ position: 'relative', display: 'flex' }}
                onMouseEnter={() => setShowHiddenTooltip(true)}
                onMouseLeave={() => setShowHiddenTooltip(false)}
                onFocus={() => setShowHiddenTooltip(true)}
                onBlur={() => setShowHiddenTooltip(false)}
            >
                <button
                    onClick={onToggleHidden}
                    className="btn-secondary"
                    aria-label={t(showHidden ? 'sftp.hideHidden' : 'sftp.showHidden')}
                    style={{
                        padding: '5px',
                        display: 'flex',
                        alignItems: 'center',
                        border: showHidden || hasHiddenFiles ? '1px solid var(--accent)' : '1px solid var(--border)',
                        background: showHidden ? 'rgba(var(--accent-rgb), 0.15)' : 'transparent',
                        color: showHidden ? 'var(--accent)' : 'inherit',
                        boxShadow: showHidden
                            ? '0 0 8px rgba(var(--accent-rgb), 0.5)'
                            : hasHiddenFiles
                            ? '0 0 4px rgba(var(--accent-rgb), 0.3)'
                            : 'none',
                        transition: 'all 0.2s ease'
                    }}
                >
                    <Eye size={18} />
                </button>
                {showHiddenTooltip && (
                    <div role="tooltip" style={{
                        position: 'absolute',
                        top: 'calc(100% + 10px)',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 1200,
                        width: 'max-content',
                        maxWidth: '240px',
                        padding: '10px 12px',
                        border: '1px solid var(--border-color)',
                        borderRadius: '9px',
                        background: 'var(--bg-color)',
                        color: 'var(--text-color)',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                        pointerEvents: 'none',
                        fontSize: 'var(--font-size-secondary)',
                        lineHeight: 1.4
                    }}>
                        {t(showHidden ? 'sftp.hideHidden' : 'sftp.showHidden')}
                    </div>
                )}
            </div>
            <button
                onClick={onRefresh}
                disabled={loading || refreshing}
                className="btn-secondary"
                style={{ padding: '5px', display: 'flex', alignItems: 'center' }}
            >
                <RefreshCw size={18} className={(loading || refreshing) ? 'refresh-icon-spin' : ''} />
            </button>
            <div style={{
                flex: 1,
                padding: '0 10px',
                height: '32px',
                fontSize: 'var(--ui-font-size-base)',
                display: 'flex',
                alignItems: 'center',
                overflowX: 'auto',
                overflowY: 'hidden',
                whiteSpace: 'nowrap',
                gap: '4px',
                scrollbarWidth: 'none' // Hide scrollbar for cleaner look
            }} className="breadcrumb-container">
                {breadcrumbs.map((crumb, idx) => {
                    const isLast = idx === breadcrumbs.length - 1;
                    return (
                        <React.Fragment key={crumb.path}>
                            {idx > 0 && <ChevronRight size={14} style={{ opacity: 0.5, flexShrink: 0 }} />}
                            <div
                                onClick={() => !isLast && onNavigate(crumb.path)}
                                style={{
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    cursor: isLast ? 'default' : 'pointer',
                                    opacity: 1,
                                    fontWeight: isLast ? 'bold' : 'normal',
                                    transition: 'all 0.2s ease',
                                    display: 'flex',
                                    alignItems: 'center',
                                    background: 'transparent',
                                    border: '1px solid transparent'
                                }}
                                className={!isLast ? "breadcrumb-item" : ""}
                            >
                                {crumb.name}
                            </div>
                        </React.Fragment>
                    );
                })}
            </div>
            <button
                onClick={() => onUpload('file')}
                disabled={loading}
                className="btn-primary"
                style={{ padding: '5px 15px', display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '10px' }}
            >
                <Upload size={18} />
                {t('sftp.upload')}
            </button>
        </div>
    );
});
