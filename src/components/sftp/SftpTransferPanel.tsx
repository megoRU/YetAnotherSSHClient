import React, { useSyncExternalStore } from 'react';
import { UploadCloud, X, Upload, Download } from 'lucide-react';
import type { Transfer, AppConfig, SftpProgress } from '../../types';
import { formatSize } from '../../utils';
import { useI18n } from '../../utils/i18n';

export interface ProgressStoreInterface {
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => Map<string, SftpProgress>;
}

interface TransferItemContainerProps {
    transfer: Transfer;
    progressStore?: ProgressStoreInterface;
    primaryRed: string;
    onCancelTransfer: (transfer: Transfer) => void;
    onRemoveTransfer: (id: string) => void;
    t: (key: string, params?: Record<string, string>) => string;
}

const TransferItemContainer: React.FC<TransferItemContainerProps> = React.memo(({
    transfer,
    progressStore,
    primaryRed,
    onCancelTransfer,
    onRemoveTransfer,
    t
}) => {
    const progressMap = useSyncExternalStore(
        progressStore ? progressStore.subscribe : () => () => {},
        progressStore ? progressStore.getSnapshot : () => new Map<string, SftpProgress>()
    );

    const progressData = progressMap.get(transfer.id);
    const currentProgress = progressData ? progressData.progress : transfer.progress;
    const currentSize = progressData?.total ?? transfer.size;

    return (
        <div style={{
            padding: '10px',
            background: 'rgba(0,0,0,0.02)',
            borderRadius: '6px',
            border: '1px solid var(--border-color)'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', flex: 1, minWidth: 0 }}>
                    {transfer.type === 'upload' ? <Upload size={14} style={{ flexShrink: 0 }} /> : <Download size={14} style={{ flexShrink: 0 }} />}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <span style={{ fontSize: '12px', color: primaryRed, fontWeight: 'bold' }}>
                        {transfer.status === 'success' ? 'OK' : transfer.status === 'active' ? `${currentProgress}%` : '!'}
                    </span>
                    <button
                        className="transfer-close-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (transfer.status === 'active') {
                                onCancelTransfer(transfer);
                            } else {
                                onRemoveTransfer(transfer.id);
                            }
                        }}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', color: 'inherit', display: 'flex', alignItems: 'center', opacity: 0.6, borderRadius: '4px' }}
                        title={transfer.status === 'active' ? t('common.cancel') : t('common.delete')}
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>
            <div style={{ width: '100%', height: '4px', background: 'rgba(0,0,0,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                    width: `${currentProgress}%`,
                    height: '100%',
                    background: transfer.status === 'success' ? '#1fb466' : transfer.status === 'error' ? '#ff5555' : primaryRed,
                    transition: 'width 0.2s'
                }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                <span style={{ fontSize: '10px', opacity: 0.7 }}>
                    {typeof currentSize === 'number' ? formatSize(currentSize) : '--'}
                </span>
                <span style={{ fontSize: '10px', opacity: 0.7 }}>
                    {transfer.status === 'active' ? t('sftp.processing') : transfer.status === 'success' ? t('common.success') : t('common.error')}
                </span>
            </div>
        </div>
    );
});

interface SftpTransferPanelProps {
    activeTransfers: Transfer[];
    progressStore?: ProgressStoreInterface;
    primaryRed: string;
    onCancelTransfer: (transfer: Transfer) => void;
    onRemoveTransfer: (id: string) => void;
    onClearFinished: () => void;
    appConfig?: AppConfig;
}

export const SftpTransferPanel: React.FC<SftpTransferPanelProps> = React.memo(({
    activeTransfers,
    progressStore,
    primaryRed,
    onCancelTransfer,
    onRemoveTransfer,
    onClearFinished,
    appConfig
}) => {
    const { t } = useI18n(appConfig?.language || 'ru');

    return (
        <div className="sftp-transfers-panel open" style={{
            width: '350px',
            height: '100%',
            background: 'var(--bg-color)',
            borderLeft: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 100,
            transition: 'width 0.3s ease'
        }}>
            <div
                style={{
                    padding: '10px 15px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'rgba(0,0,0,0.02)',
                    borderBottom: '1px solid var(--border-color)',
                    minHeight: '53.2px',
                    boxSizing: 'border-box'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
                    <UploadCloud size={16} color={primaryRed} />
                    {t('sftp.tasks')} ({activeTransfers.filter(t => t.status === 'active').length})
                </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '15px' }}>
                {activeTransfers.length === 0 ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7, fontSize: '13px', textAlign: 'center', padding: '0 20px' }}>
                        {t('sftp.transferEmpty')}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {activeTransfers.map(transfer => (
                            <TransferItemContainer
                                key={transfer.id}
                                transfer={transfer}
                                progressStore={progressStore}
                                primaryRed={primaryRed}
                                onCancelTransfer={onCancelTransfer}
                                onRemoveTransfer={onRemoveTransfer}
                                t={t}
                            />
                        ))}
                    </div>
                )}
            </div>

            {activeTransfers.length > 0 && (
                <div style={{ padding: '10px', borderTop: '1px solid var(--border-color)', textAlign: 'center' }}>
                    <button
                        className="btn-secondary"
                        style={{ fontSize: '12px', padding: '4px 10px' }}
                        onClick={onClearFinished}
                    >
                        {t('sftp.clear')}
                    </button>
                </div>
            )}
        </div>
    );
});
