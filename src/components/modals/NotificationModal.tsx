import React from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import type { NotificationType } from '../../types';

interface NotificationModalProps {
    title: string;
    message: string;
    type?: NotificationType;
    action?: { label: string, onClick: () => void };
    onClose: () => void;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
    title,
    message,
    type = 'info',
    action,
    onClose
}) => {
    const getIcon = () => {
        switch (type) {
            case 'success': return <CheckCircle2 color="#4caf50" size={32} />;
            case 'error': return <AlertCircle color="#e81123" size={32} />;
            default: return <Info color="var(--primary-color)" size={32} />;
        }
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 4000
        }} onClick={onClose}>
            <div style={{
                background: 'var(--bg-color)',
                padding: '30px',
                borderRadius: '16px',
                width: '400px',
                boxShadow: '0 12px 48px rgba(0,0,0,0.4)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-color)',
                textAlign: 'center'
            }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', marginBottom: '20px' }}>
                    {getIcon()}
                    <h3 style={{ margin: 0, fontSize: '1.4em' }}>{title}</h3>
                </div>

                <div style={{
                    opacity: 0.8,
                    lineHeight: '1.5',
                    marginBottom: '25px',
                    whiteSpace: 'pre-wrap',
                    textAlign: 'left',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    padding: '0 10px'
                }}>
                    {message}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <button
                        className="btn-primary"
                        style={{ width: '100%', padding: '12px', borderRadius: '8px', fontWeight: 'bold' }}
                        onClick={onClose}
                    >
                        Ок
                    </button>
                    {action && (
                        <button
                            className="btn-secondary"
                            style={{ width: '100%', padding: '12px', borderRadius: '8px', fontWeight: 'bold' }}
                            onClick={() => {
                                action.onClick();
                                onClose();
                            }}
                        >
                            {action.label}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
