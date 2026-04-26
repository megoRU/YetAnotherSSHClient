import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AppConfig } from '../../types';
import { useI18n } from '../../utils/i18n';

interface ReloadConfirmModalProps {
    onConfirm: () => void;
    onCancel: () => void;
    appConfig?: AppConfig;
}

export const ReloadConfirmModal: React.FC<ReloadConfirmModalProps> = ({ onConfirm, onCancel, appConfig }) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 3000
        }} onClick={onCancel}>
            <div style={{
                background: 'var(--bg-color)',
                padding: '25px',
                borderRadius: '12px',
                width: '420px',
                boxShadow: '0 12px 48px rgba(0,0,0,0.4)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-color)',
                textAlign: 'center'
            }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', marginBottom: '20px' }}>
                    <div style={{
                        width: '60px',
                        height: '60px',
                        borderRadius: '50%',
                        background: 'var(--hover-bg)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        <AlertTriangle color="var(--primary-color)" size={32} />
                    </div>
                    <h3 style={{ margin: 0, fontSize: '1.4em' }}>{t('modals.reloadTitle')}?</h3>
                </div>

                <p style={{ opacity: 0.8, lineHeight: '1.5', marginBottom: '25px' }}>
                    {t('modals.reloadConfirm')}
                </p>

                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        className="btn-secondary"
                        style={{ flex: 1, padding: '12px', borderRadius: '8px', fontWeight: 'bold' }}
                        onClick={onCancel}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        className="btn-primary"
                        style={{ flex: 1, padding: '12px', borderRadius: '8px', fontWeight: 'bold' }}
                        onClick={onConfirm}
                    >
                        {t('settings.reloadApp')}
                    </button>
                </div>
            </div>
        </div>
    );
};
