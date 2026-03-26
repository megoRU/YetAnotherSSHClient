import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { SSHConfig } from '../../types';

interface DeleteServerModalProps {
    server: SSHConfig;
    onConfirm: () => void;
    onCancel: () => void;
}

export const DeleteServerModal: React.FC<DeleteServerModalProps> = ({ server, onConfirm, onCancel }) => {
    return (
        <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2000
        }} onClick={onCancel}>
            <div style={{
                background: 'var(--bg-color)',
                padding: '20px',
                borderRadius: '8px',
                width: '400px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-color)'
            }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                    <AlertTriangle color="#c81e51" size={24} />
                    <h3 style={{ marginTop: 0, marginBottom: 0 }}>Удаление сервера</h3>
                </div>

                <p>Вы уверены, что хотите удалить сервер <b>{server.name || server.host}</b>?</p>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                    <button className="btn-secondary" style={{ padding: '8px 15px' }} onClick={onCancel}>Отмена</button>
                    <button
                        className="btn-primary"
                        style={{ padding: '8px 15px' }}
                        onClick={onConfirm}
                    >
                        Удалить
                    </button>
                </div>
            </div>
        </div>
    );
};
