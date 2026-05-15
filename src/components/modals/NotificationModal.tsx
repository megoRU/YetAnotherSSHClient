import React from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import type { NotificationAction, NotificationType } from '../../types';

interface NotificationModalProps {
    title: string;
    message: string;
    type?: NotificationType;
    action?: NotificationAction;
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

    const handleClose = () => {
        if (action) return; // Prevent closing via overlay click if there's an action
        onClose();
    };

    const handleCancel = () => {
        action?.onCancel?.();
        onClose();
    };

    return (
        <div className="modal-overlay" style={{ zIndex: 4000 }} onClick={handleClose}>
            <div className="modal-content" style={{ width: '500px', padding: '30px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', marginBottom: '20px' }}>
                    {getIcon()}
                    <h3 style={{ margin: 0, fontSize: '1.4em' }}>{title}</h3>
                </div>

                <div style={{
                    opacity: 0.8,
                    lineHeight: '1.5',
                    marginBottom: '25px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    textAlign: 'left',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    padding: '0 10px'
                }}>
                    {message}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {action ? (
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                className="btn-secondary"
                                style={{ flex: 1, padding: '12px', borderRadius: '8px', fontWeight: 'bold' }}
                                onClick={handleCancel}
                            >
                                {action.cancelLabel || 'Отмена'}
                            </button>
                            <button
                                className="btn-primary"
                                style={{ flex: 1, padding: '12px', borderRadius: '8px', fontWeight: 'bold', background: '#ef4444' }}
                                onClick={() => {
                                    action.onClick();
                                    onClose();
                                }}
                            >
                                {action.label}
                            </button>
                        </div>
                    ) : (
                        <button
                            className="btn-primary"
                            style={{ width: '100%', padding: '12px', borderRadius: '8px', fontWeight: 'bold' }}
                            onClick={onClose}
                        >
                            OK
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
