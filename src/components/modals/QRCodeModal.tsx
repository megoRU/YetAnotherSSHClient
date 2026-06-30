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

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content qr-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '320px', padding: '24px', textAlign: 'center' }}>
                <button className="modal-close-btn" onClick={onClose} style={{ position: 'absolute', top: '12px', right: '12px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    <X size={20} />
                </button>
                <h3 style={{ marginTop: 0, marginBottom: '20px', color: 'var(--text-primary)' }}>{title}</h3>
                <div style={{ background: 'white', padding: '12px', borderRadius: '12px', display: 'inline-block' }}>
                    <canvas ref={canvasRef} style={{ display: 'block' }} />
                </div>
                <div style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                    {value}
                </div>
            </div>
        </div>
    );
};
