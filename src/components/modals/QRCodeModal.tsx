import React, { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { X } from 'lucide-react';

interface QRCodeModalProps {
    value: string;
    title: string;
    onClose: () => void;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({ value, title, onClose }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (canvasRef.current) {
            QRCode.toCanvas(canvasRef.current, value, {
                width: 256,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            }, (error) => {
                if (error) console.error(error);
            });
        }
    }, [value]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="modal-overlay" onClick={onClose} style={{ zIndex: 2000 }}>
            <div className="modal-content qr-modal" onClick={e => e.stopPropagation()} style={{
                maxWidth: '400px',
                padding: '0',
                textAlign: 'center',
                borderRadius: '12px',
                overflow: 'hidden'
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '20px 25px',
                    background: 'rgba(0,0,0,0.05)',
                    borderBottom: '1px solid var(--border)'
                }}>
                    <h3 style={{ margin: 0, fontSize: '1.1em', lineHeight: '1.4', color: 'var(--text-primary)' }}>{title}</h3>
                    <button
                        onClick={onClose}
                        className="modal-close-btn"
                        style={{
                            background: 'none',
                            border: 'none',
                            padding: '5px',
                            cursor: 'pointer',
                            color: 'var(--text-primary)',
                            opacity: 0.6,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '6px'
                        }}
                    >
                        <X size={20} />
                    </button>
                </div>

                <div style={{ padding: '25px' }}>
                    <div style={{ background: 'white', padding: '12px', borderRadius: '12px', display: 'inline-block', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                        <canvas ref={canvasRef} style={{ display: 'block' }} />
                    </div>
                    <div style={{ marginTop: '20px', fontSize: '0.85rem', color: 'var(--text-secondary)', wordBreak: 'break-all', lineHeight: '1.5' }}>
                        {value}
                    </div>
                    <div style={{ marginTop: '25px' }}>
                        <button
                            className="btn-primary"
                            onClick={onClose}
                            style={{ padding: '10px 24px', minWidth: '120px' }}
                        >
                            OK
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
