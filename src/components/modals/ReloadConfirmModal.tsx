import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ReloadConfirmModalProps {
    onConfirm: () => void;
    onCancel: () => void;
}

export const ReloadConfirmModal: React.FC<ReloadConfirmModalProps> = ({ onConfirm, onCancel }) => {
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
                        background: 'rgba(200, 30, 81, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        <AlertTriangle color="#c81e51" size={32} />
                    </div>
                    <h3 style={{ margin: 0, fontSize: '1.4em' }}>Закрыть все вкладки?</h3>
                </div>

                <p style={{ opacity: 0.8, lineHeight: '1.5', marginBottom: '25px' }}>
                    Это действие приведет к перезагрузке приложения. Все активные SSH-сессии будут завершены, а несохраненные данные в терминалах будут потеряны.
                </p>

                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        className="btn-secondary"
                        style={{ flex: 1, padding: '12px', borderRadius: '8px', fontWeight: 'bold' }}
                        onClick={onCancel}
                    >
                        Отмена
                    </button>
                    <button
                        className="btn-primary"
                        style={{ flex: 1, padding: '12px', borderRadius: '8px', fontWeight: 'bold' }}
                        onClick={onConfirm}
                    >
                        Перезагрузить
                    </button>
                </div>
            </div>
        </div>
    );
};
