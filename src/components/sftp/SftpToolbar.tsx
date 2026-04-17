import React from 'react';
import { ArrowUp, Home, RefreshCw, Upload } from 'lucide-react';

interface SftpToolbarProps {
    path: string;
    loading: boolean;
    primaryRed: string;
    onGoUp: () => void;
    onGoHome: () => void;
    onRefresh: () => void;
    onUpload: () => void;
}

export const SftpToolbar: React.FC<SftpToolbarProps> = ({
    path,
    loading,
    primaryRed,
    onGoUp,
    onGoHome,
    onRefresh,
    onUpload
}) => {
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
                onClick={onGoUp}
                disabled={path === '/' || !path || loading}
                className="btn-secondary"
                title="Наверх"
                style={{ padding: '5px', display: 'flex', alignItems: 'center' }}
            >
                <ArrowUp size={18} />
            </button>
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
                padding: '5px 10px',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                gap: '10px'
            }}>
                <span style={{
                    background: primaryRed,
                    color: 'white',
                    fontSize: '10px',
                    padding: '1px 5px',
                    borderRadius: '4px',
                    fontWeight: 'bold',
                    flexShrink: 0
                }}>Release Candidate</span>
                {path}
            </div>
            <button
                onClick={onUpload}
                disabled={loading}
                className="btn-primary"
                style={{ padding: '5px 15px', display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '10px' }}
            >
                <Upload size={18} />
                Загрузить
            </button>
        </div>
    );
};
