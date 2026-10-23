import React, { useSyncExternalStore, type FC } from 'react';
import { UploadCloud, X, Upload, Download } from 'lucide-react';
import type { Transfer, AppConfig, SftpProgress } from '../../types';
import { formatSize } from '../../utils';
import { useI18n } from '../../utils/i18n';

const TRANSFER_SPEED_WINDOW_MS = 10000;
const TRANSFER_SPEED_MIN_WINDOW_MS = 1000;
const TRANSFER_SPEED_REFRESH_MS = 1000;
const TRANSFER_PROGRESS_STALE_MS = 1500;
const TRANSFER_SPEED_SMOOTHING = 0.2;

interface TransferProgressSample {
    transferred: number;
    timestamp: number;
}

interface TransferEstimate {
    bytesPerSecond: number | null;
    transferred: number | null;
}

export interface ProgressStoreInterface {
    subscribe: (id: string, listener: () => void) => () => void;
    getSnapshot: (id: string) => SftpProgress | undefined;
}

interface TransferItemProps {
    transfer: Transfer;
    progressStore: ProgressStoreInterface;
    language: AppConfig['language'];
    primaryRed: string;
    onCancelTransfer: (transfer: Transfer) => void;
    onRemoveTransfer: (id: string) => void;
    t: (key: string, params?: Record<string, string>) => string;
    hideActions?: boolean;
}

const TransferItem: FC<TransferItemProps> = React.memo(({
    transfer,
    progressStore,
    language,
    primaryRed,
    onCancelTransfer,
    onRemoveTransfer,
    t,
    hideActions = false
}) => {
    const progressData = useSyncExternalStore(
        React.useCallback((onStoreChange: () => void) => {
            return progressStore.subscribe(transfer.id, onStoreChange);
        }, [progressStore, transfer.id]),
        React.useCallback(() => {
            return progressStore.getSnapshot(transfer.id);
        }, [progressStore, transfer.id]),
        React.useCallback(() => {
            return progressStore.getSnapshot(transfer.id);
        }, [progressStore, transfer.id])
    );

    const currentProgress = progressData ? progressData.progress : transfer.progress;
    const currentSize = progressData?.total ?? transfer.size;
    const transferredBytes = progressData?.transferred
        ?? (typeof currentSize === 'number' ? currentSize * currentProgress / 100 : undefined);
    const transferSamplesRef = React.useRef<TransferProgressSample[]>([]);
    const smoothedTransferSpeedRef = React.useRef<number | null>(null);
    const [transferEstimate, setTransferEstimate] = React.useState<TransferEstimate>({ bytesPerSecond: null, transferred: null });

    React.useEffect(() => {
        if (transfer.status !== 'active') {
            transferSamplesRef.current = [];
            smoothedTransferSpeedRef.current = null;
            setTransferEstimate(previous => previous.bytesPerSecond === null && previous.transferred === null
                ? previous
                : { bytesPerSecond: null, transferred: null });
            return;
        }

        if (typeof transferredBytes !== 'number') return;

        const timestamp = performance.now();
        const samples = transferSamplesRef.current;
        const previousSample = samples[samples.length - 1];
        if (previousSample && transferredBytes < previousSample.transferred) {
            samples.length = 0;
            smoothedTransferSpeedRef.current = null;
        }

        samples.push({ transferred: transferredBytes, timestamp });
        const cutoff = timestamp - TRANSFER_SPEED_WINDOW_MS;
        while (samples.length > 2 && samples[1].timestamp < cutoff) {
            samples.shift();
        }
    }, [transferredBytes, transfer.status]);

    React.useEffect(() => {
        if (transfer.status !== 'active') return;

        const timer = window.setInterval(() => {
            const samples = transferSamplesRef.current;
            const latestSample = samples[samples.length - 1];
            if (!latestSample) return;

            const now = performance.now();
            if (now - latestSample.timestamp > TRANSFER_PROGRESS_STALE_MS) {
                transferSamplesRef.current = [{ transferred: latestSample.transferred, timestamp: now }];
                smoothedTransferSpeedRef.current = 0;
                setTransferEstimate(previous => previous.bytesPerSecond === 0 && previous.transferred === latestSample.transferred
                    ? previous
                    : { bytesPerSecond: 0, transferred: latestSample.transferred });
                return;
            }

            const firstSample = samples[0];
            const elapsed = latestSample.timestamp - firstSample.timestamp;
            if (elapsed < TRANSFER_SPEED_MIN_WINDOW_MS) {
                setTransferEstimate(previous => previous.transferred === latestSample.transferred
                    ? previous
                    : { bytesPerSecond: previous.bytesPerSecond, transferred: latestSample.transferred });
                return;
            }

            const measuredSpeed = Math.max(0, latestSample.transferred - firstSample.transferred) * 1000 / elapsed;
            const previousSmoothedSpeed = smoothedTransferSpeedRef.current;
            const smoothedSpeed = previousSmoothedSpeed === null
                ? measuredSpeed
                : previousSmoothedSpeed * (1 - TRANSFER_SPEED_SMOOTHING) + measuredSpeed * TRANSFER_SPEED_SMOOTHING;
            smoothedTransferSpeedRef.current = smoothedSpeed;
            setTransferEstimate(previous => previous.bytesPerSecond === smoothedSpeed && previous.transferred === latestSample.transferred
                ? previous
                : { bytesPerSecond: smoothedSpeed, transferred: latestSample.transferred });
        }, TRANSFER_SPEED_REFRESH_MS);

        return () => window.clearInterval(timer);
    }, [transfer.status]);

    const speedMbit = transferEstimate.bytesPerSecond === null
        ? '--'
        : Math.round(transferEstimate.bytesPerSecond * 8 / 1_000_000).toLocaleString(language === 'en' ? 'en-US' : 'ru-RU');
    const remainingBytes = typeof currentSize === 'number' && typeof transferEstimate.transferred === 'number'
        ? Math.max(0, currentSize - transferEstimate.transferred)
        : null;
    const remainingSeconds = remainingBytes === 0
        ? 0
        : remainingBytes !== null && transferEstimate.bytesPerSecond !== null && transferEstimate.bytesPerSecond > 0
            ? Math.ceil(remainingBytes / transferEstimate.bytesPerSecond)
            : null;
    const remainingMinutesLabel = remainingSeconds === null ? '--' : String(Math.floor(remainingSeconds / 60));
    const remainingSecondsLabel = remainingSeconds === null ? '--' : String(remainingSeconds % 60).padStart(2, '0');
    const activeTransferLabel = t('sftp.transferSpeedRemaining', {
        speed: speedMbit,
        minutes: remainingMinutesLabel,
        seconds: remainingSecondsLabel
    });

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
                        fontSize: 'var(--font-size-secondary)',
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}>
                        {transfer.filename}
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: primaryRed, fontWeight: 'bold' }}>
                        {transfer.status === 'success' ? 'OK' : transfer.status === 'active' ? `${currentProgress}%` : '!'}
                    </span>
                    {!hideActions && <button
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
                    </button>}
                </div>
            </div>
            <div style={{ width: '100%', height: '4px', background: 'rgba(0,0,0,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                    width: '100%',
                    height: '100%',
                    background: transfer.status === 'success' ? '#1fb466' : transfer.status === 'error' ? '#ff5555' : primaryRed,
                    transform: `scaleX(${Math.max(0, Math.min(currentProgress, 100)) / 100})`,
                    transformOrigin: 'left center',
                    transition: 'transform 160ms linear',
                    willChange: 'transform'
                }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7 }}>
                    {typeof currentSize === 'number' ? formatSize(currentSize) : '--'}
                </span>
                <span style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7 }}>
                    {transfer.status === 'active' ? activeTransferLabel : transfer.status === 'success' ? t('common.success') : t('common.error')}
                </span>
            </div>
        </div>
    );
});

interface SftpTransferPanelProps {
    activeTransfers: Transfer[];
    progressStore: ProgressStoreInterface;
    primaryRed: string;
    onCancelTransfer: (transfer: Transfer) => void;
    onRemoveTransfer: (id: string) => void;
    onClearFinished: () => void;
    appConfig?: AppConfig;
}

export const SftpTransferPanel: FC<SftpTransferPanelProps> = React.memo(({
    activeTransfers,
    progressStore,
    primaryRed,
    onCancelTransfer,
    onRemoveTransfer,
    onClearFinished,
    appConfig
}) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    const transferEntries = React.useMemo(() => {
        const entries: { key: string; transfers: Transfer[]; grouped: boolean }[] = [];
        const groups = new Map<string, Transfer[]>();
        for (const transfer of activeTransfers) {
            if (!transfer.groupId) {
                entries.push({ key: transfer.id, transfers: [transfer], grouped: false });
                continue;
            }
            let group = groups.get(transfer.groupId);
            if (!group) {
                group = [];
                groups.set(transfer.groupId, group);
                entries.push({ key: transfer.groupId, transfers: group, grouped: true });
            }
            group.push(transfer);
        }
        return entries;
    }, [activeTransfers]);

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
                    {t('sftp.tasks')} ({transferEntries.filter(entry => entry.transfers.some(transfer => transfer.status === 'active')).length})
                </div>
                {activeTransfers.some(transfer => transfer.status !== 'active') && (
                    <button
                        className="btn-secondary"
                        style={{ fontSize: 'var(--font-size-xs)', padding: '4px 10px', flexShrink: 0 }}
                        onClick={onClearFinished}
                    >
                        {t('sftp.clear')}
                    </button>
                )}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '15px' }}>
                {activeTransfers.length === 0 ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7, fontSize: 'var(--font-size-base)', textAlign: 'center', padding: '0 20px' }}>
                        {t('sftp.transferEmpty')}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {transferEntries.map(entry => entry.grouped ? (
                            <div key={entry.key} style={{ display: 'flex', flexDirection: 'column', gap: '7px', padding: '9px', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                    <span style={{ fontSize: 'var(--font-size-secondary)', fontWeight: 'bold' }}>
                                        {t(entry.transfers[0]?.type === 'download' ? 'sftp.downloadGroup' : 'sftp.uploadGroup', { count: String(entry.transfers.length) })}
                                    </span>
                                    {entry.transfers.some(transfer => transfer.status === 'active') && (
                                        <button
                                            className="transfer-close-btn"
                                            onClick={() => {
                                                const activeTransfer = entry.transfers.find(transfer => transfer.status === 'active');
                                                if (activeTransfer) onCancelTransfer(activeTransfer);
                                            }}
                                            title={t('common.cancel')}
                                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', color: 'inherit', display: 'flex', alignItems: 'center', opacity: 0.6, borderRadius: '4px' }}
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>
                                {entry.transfers.map(transfer => (
                                    <TransferItem
                                        key={transfer.id}
                                        transfer={transfer}
                                        progressStore={progressStore}
                                        language={appConfig?.language || 'ru'}
                                        primaryRed={primaryRed}
                                        onCancelTransfer={onCancelTransfer}
                                        onRemoveTransfer={onRemoveTransfer}
                                        t={t}
                                        hideActions={transfer.status === 'active'}
                                    />
                                ))}
                            </div>
                        ) : (
                            <TransferItem
                                key={entry.transfers[0].id}
                                transfer={entry.transfers[0]}
                                progressStore={progressStore}
                                language={appConfig?.language || 'ru'}
                                primaryRed={primaryRed}
                                onCancelTransfer={onCancelTransfer}
                                onRemoveTransfer={onRemoveTransfer}
                                t={t}
                            />
                        ))}
                    </div>
                )}
            </div>

        </div>
    );
});
