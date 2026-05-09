import React, { useState } from 'react';
import { Lock, Unlock, ShieldAlert } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import type { AppConfig } from '../../types';

interface VaultUnlockModalProps {
    onUnlock: (key: string) => Promise<boolean>;
    onResetPasswords: () => Promise<void>;
    appConfig: AppConfig;
}

export const VaultUnlockModal: React.FC<VaultUnlockModalProps> = ({ onUnlock, onResetPasswords, appConfig }) => {
    const { t } = useI18n(appConfig.language);
    const [key, setKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!key.trim()) return;

        setLoading(true);
        setError(false);
        const success = await onUnlock(key.trim());
        setLoading(false);

        if (!success) {
            setError(true);
        }
    };

    const handleResetPasswords = async () => {
        if (!window.confirm(t('vault.resetDesc'))) return;
        await onResetPasswords();
    };

    return (
        <div className="modal-overlay" style={{ zIndex: 4000 }}>
            <div className="modal-content" style={{ maxWidth: '450px', padding: '32px' }}>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '20px' }}>
                    <div style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '20px',
                        background: 'var(--accent)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 8px 16px rgba(var(--accent-rgb), 0.2)'
                    }}>
                        <Lock size={32} />
                    </div>

                    <div>
                        <h2 style={{ margin: '0 0 8px' }}>{t('vault.unlockTitle')}</h2>
                        <p style={{ opacity: 0.7, fontSize: '0.95rem' }}>
                            {t('vault.unlockDesc')}
                        </p>
                    </div>

                    <div style={{ width: '100%' }}>
                        <input
                            autoFocus
                            type="password"
                            value={key}
                            onChange={(e) => setKey(e.target.value)}
                            placeholder={t('vault.keyPlaceholder')}
                            style={{
                                width: '100%',
                                padding: '14px',
                                textAlign: 'center',
                                fontSize: '1rem',
                                border: error ? '2px solid #ef4444' : '1px solid var(--border)'
                            }}
                        />
                        {error && (
                            <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '8px', fontWeight: 500 }}>
                                {t('vault.invalidKey')}
                            </div>
                        )}
                    </div>

                    <button
                        disabled={loading || !key.trim()}
                        className="btn-primary"
                        style={{ width: '100%', padding: '14px', gap: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                    >
                        {loading ? <div className="loading-spinner" style={{ width: '16px', height: '16px', borderTopColor: 'white' }} /> : <Unlock size={18} />}
                        {t('vault.unlockAction')}
                    </button>
                    <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleResetPasswords}
                        style={{ width: '100%', padding: '12px' }}
                    >
                        {t('vault.resetServerPasswords')}
                    </button>

                    <div style={{
                        fontSize: '0.8rem',
                        opacity: 0.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                    }}>
                        <ShieldAlert size={14} />
                        {t('vault.unlockSecurityNote')}
                    </div>
                </form>
            </div>
        </div>
    );
};
