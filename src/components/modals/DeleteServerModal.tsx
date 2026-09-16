import React, { useState, useEffect } from 'react';
import { X, Server } from 'lucide-react';
import type { SSHConfig, AppConfig } from '../../types';
import { useI18n } from '../../utils/i18n';
import { getOSIcon } from '../../utils';

interface DeleteServerModalProps {
    server: SSHConfig;
    onConfirm: () => void;
    onCancel: () => void;
    appConfig?: AppConfig;
}

export const DeleteServerModal: React.FC<DeleteServerModalProps> = ({ server, onConfirm, onCancel, appConfig }) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    const [iconError, setIconError] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onCancel]);

    const serverName = server.name || server.host;
    const username = server.user || 'root';
    const osIconUrl = server.osPrettyName ? getOSIcon(server.osPrettyName) : null;

    return (
        <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2000
        }} onClick={onCancel}>
            <div style={{
                background: 'var(--background)',
                padding: '20px 24px 24px',
                borderRadius: '12px',
                width: '400px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
            }} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>
                        {t('modals.deleteServerTitle')}
                    </h3>
                    <button
                        onClick={onCancel}
                        className="modal-close-btn"
                        aria-label={t('common.close')}
                        style={{
                            background: 'none',
                            border: 'none',
                            padding: '4px',
                            cursor: 'pointer',
                            color: 'var(--text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '6px',
                            transition: 'all 0.2s'
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Confirmation message */}
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.4 }}>
                    {t('modals.deleteServerConfirm')}
                </p>

                {/* Server Bubble / Card */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 16px',
                    background: 'var(--hover-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px'
                }}>
                    {osIconUrl && !iconError ? (
                        <img
                            src={osIconUrl}
                            alt="OS"
                            onError={() => setIconError(true)}
                            style={{ width: '28px', height: '28px', objectFit: 'contain', flexShrink: 0 }}
                            draggable="false"
                        />
                    ) : (
                        <Server size={28} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                        <span style={{
                            fontWeight: 600,
                            fontSize: '0.95rem',
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                        }}>
                            {serverName}
                        </span>
                        <span style={{
                            fontSize: '0.8rem',
                            color: 'var(--text-secondary)'
                        }}>
                            SSH {username}
                        </span>
                    </div>
                </div>

                {/* Action button */}
                <div style={{ marginTop: '8px' }}>
                    <button
                        className="btn-danger"
                        style={{
                            width: '100%',
                            padding: '10px',
                            borderRadius: '8px',
                            fontWeight: 600,
                            fontSize: '0.95rem',
                            cursor: 'pointer'
                        }}
                        onClick={onConfirm}
                    >
                        {t('common.delete')}
                    </button>
                </div>
            </div>
        </div>
    );
};
