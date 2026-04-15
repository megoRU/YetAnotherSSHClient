import React from 'react';
import { UploadCloud, X, Upload, Download, Minus, Plus } from 'lucide-react';
import type { Transfer } from '../../types';
import { formatSize } from '../../utils';

interface SftpTransferPanelProps {
    showTransfers: boolean;
    setShowTransfers: (show: boolean) => void;
    activeTransfers: Transfer[];
    setActiveTransfers: React.Dispatch<React.SetStateAction<Transfer[]>>;
    primaryRed: string;
    onCancelTransfer: (transfer: Transfer) => void;
}

export const SftpTransferPanel: React.FC<SftpTransferPanelProps> = ({
    showTransfers,
    setShowTransfers,
    activeTransfers,
    setActiveTransfers,
    primaryRed,
    onCancelTransfer
}) => {
    return (
        <div className={`sftp-transfers-panel ${showTransfers ? 'open' : ''}`} style={{
            position: 'absolute',
            bottom: 0,
            right: '20px',
            width: '350px',
            maxHeight: '400px',
            background: 'var(--bg-color)',
            border: '1px solid var(--border-color)',
            borderBottom: 'none',
            borderTopLeftRadius: '8px',
            borderTopRightRadius: '8px',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 -4px 12px rgba(0,0,0,0.15)',
            transform: showTransfers ? 'translateY(0)' : 'translateY(calc(100% - 40px))',
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
            <div
                onClick={() => setShowTransfers(!showTransfers)}
                style={{
                    padding: '10px 15px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    background: 'rgba(0,0,0,0.03)',
                    borderBottom: '1px solid var(--border-color)',
                    borderTopLeftRadius: '8px',
                    borderTopRightRadius: '8px'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
                    <UploadCloud size={16} color={primaryRed} />
                    Передачи ({activeTransfers.filter(t => t.status === 'active').length})
                </div>
                {showTransfers ? <Minus size={16} /> : <Plus size={16} />}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
                {activeTransfers.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', opacity: 0.7, fontSize: '13px' }}>
                        Нет активных передач
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {activeTransfers.map(transfer => (
                            <div key={transfer.id} style={{
                                padding: '10px',
                                background: 'rgba(0,0,0,0.02)',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                                        {transfer.type === 'upload' ? <Upload size={14} /> : <Download size={14} />}
                                        <span style={{
                                            fontSize: '13px',
                                            fontWeight: 'bold',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis'
                                        }}>
                                            {transfer.filename}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontSize: '12px', color: primaryRed, fontWeight: 'bold' }}>
                                            {transfer.status === 'success' ? 'OK' : transfer.status === 'active' ? `${transfer.progress}%` : '!'}
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (transfer.status === 'active') {
                                                    onCancelTransfer(transfer);
                                                } else {
                                                    setActiveTransfers(prev => prev.filter(t => t.id !== transfer.id));
                                                }
                                            }}
                                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', display: 'flex', alignItems: 'center', opacity: 0.6 }}
                                            title={transfer.status === 'active' ? "Отменить" : "Убрать из списка"}
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                </div>
                                <div style={{ width: '100%', height: '4px', background: 'rgba(0,0,0,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{
                                        width: `${transfer.progress}%`,
                                        height: '100%',
                                        background: transfer.status === 'success' ? '#50fa7b' : transfer.status === 'error' ? '#ff5555' : primaryRed,
                                        transition: 'width 0.2s'
                                    }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                                    <span style={{ fontSize: '10px', opacity: 0.6 }}>
                                        {transfer.size ? formatSize(transfer.size) : '--'}
                                    </span>
                                    <span style={{ fontSize: '10px', opacity: 0.6 }}>
                                        {transfer.status === 'active' ? 'В процессе...' : transfer.status === 'success' ? 'Успешно' : 'Ошибка'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {activeTransfers.length > 0 && (
                <div style={{ padding: '10px', borderTop: '1px solid var(--border-color)', textAlign: 'center' }}>
                    <button
                        className="btn-secondary"
                        style={{ fontSize: '12px', padding: '4px 10px' }}
                        onClick={() => setActiveTransfers([])}
                    >
                        Очистить список
                    </button>
                </div>
            )}
        </div>
    );
};
