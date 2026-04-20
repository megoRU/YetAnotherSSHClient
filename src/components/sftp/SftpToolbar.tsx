import React, { useMemo } from 'react';
import { Home, RefreshCw, Upload, ChevronRight } from 'lucide-react';

interface SftpToolbarProps {
    path: string;
    loading: boolean;
    onGoHome: () => void;
    onRefresh: () => void;
    onUpload: (mode: 'file' | 'folder') => void;
    onNavigate: (path: string) => void;
}

export const SftpToolbar: React.FC<SftpToolbarProps> = React.memo(({
    path,
    loading,
    onGoHome,
    onRefresh,
    onUpload,
    onNavigate
}) => {
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
            padding: '10px',
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
                title="Корень"
                style={{ padding: '5px', display: 'flex', alignItems: 'center' }}
            >
                <Home size={18} />
            </button>
            <button
                onClick={onRefresh}
                disabled={loading}
                className="btn-secondary"
                title="Обновить"
                style={{ padding: '5px', display: 'flex', alignItems: 'center' }}
            >
                <RefreshCw size={18} className={loading ? 'spin' : ''} />
            </button>
            <div style={{
                flex: 1,
                background: 'var(--input-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                padding: '0 10px',
                height: '32px',
                fontSize: '14px',
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
                                    opacity: isLast ? 0.7 : 1,
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
                Загрузить
            </button>
        </div>
    );
});
