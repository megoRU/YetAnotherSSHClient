import React, { useState } from 'react';
import { Key, Copy, Check, ShieldAlert } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import type { AppConfig } from '../../types';

interface RecoveryKeyModalProps {
    recoveryKey: string;
    onConfirm: () => void;
    appConfig: AppConfig;
    isRegenerated?: boolean;
}

export const RecoveryKeyModal: React.FC<RecoveryKeyModalProps> = ({ recoveryKey, onConfirm, appConfig, isRegenerated }) => {
    const { t } = useI18n(appConfig.language);
    const [copied, setCopy] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(recoveryKey);
        setCopy(true);
        setTimeout(() => setCopy(false), 2000);
    };

    return (
        <div className="modal-overlay" style={{ zIndex: 3000 }}>
            <div className="modal-content" style={{ maxWidth: '500px', padding: '32px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '20px' }}>
                    <div style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '20px',
                        background: 'rgba(var(--accent-rgb), 0.1)',
                        color: 'var(--accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        <Key size={32} />
                    </div>

                    <div>
                        <h2 style={{ margin: '0 0 8px' }}>{isRegenerated ? t('vault.newKeyTitle') : t('vault.keyTitle')}</h2>
                        <p style={{ opacity: 0.7, fontSize: '0.95rem', lineHeight: 1.5 }}>
                            {t('vault.keyDesc')}
                        </p>
                    </div>

                    <div style={{
                        width: '100%',
                        background: 'var(--hover-surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '12px',
                        padding: '16px',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px'
                    }}>
                        <div style={{
                            fontFamily: 'monospace',
                            fontSize: '1.1rem',
                            wordBreak: 'break-all',
                            color: 'var(--text-primary)',
                            padding: '8px'
                        }}>
                            {recoveryKey}
                        </div>
                        <button
                            onClick={handleCopy}
                            className="btn-secondary"
                            style={{ width: '100%', gap: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '12px' }}
                        >
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                            {copied ? t('common.copied') : t('common.copy')}
                        </button>
                    </div>

                    <div style={{
                        display: 'flex',
                        gap: '12px',
                        padding: '12px',
                        background: 'rgba(239, 68, 68, 0.05)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        borderRadius: '12px',
                        textAlign: 'left'
                    }}>
                        <ShieldAlert size={20} style={{ color: '#ef4444', flexShrink: 0 }} />
                        <div style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 500 }}>
                            {t('vault.keyWarning')}
                        </div>
                    </div>

                    <button
                        onClick={onConfirm}
                        className="btn-primary"
                        style={{ width: '100%', padding: '14px', marginTop: '10px' }}
                    >
                        {t('common.confirm')}
                    </button>
                </div>
            </div>
        </div>
    );
};
