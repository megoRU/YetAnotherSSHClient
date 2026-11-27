<script module lang="ts">
    import type { ProgressStoreInterface } from './SftpTransferPanel.svelte';
    import { X, Upload, Download } from '@lucide/svelte';

    import type { Transfer, AppConfig } from '../../types';

    import { formatSize } from '../../utils';

    import { untrack } from 'svelte';

    import { type RefObject, type SetStateAction, inlineStyle } from '../../utils/dom';

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
</script>

<script lang="ts">
    let {
        transfer,
        progressStore,
        language,
        primaryRed,
        onCancelTransfer,
        onRemoveTransfer,
        t,
        hideActions = false,
    }: TransferItemProps = $props();

    let progressData = $state.raw(
        untrack(() =>
            (() => {
                return progressStore.getSnapshot(transfer.id);
            })(),
        ),
    );
    $effect(() => {
        const update = () => {
            progressData = (() => {
                return progressStore.getSnapshot(transfer.id);
            })();
        };
        const unsubscribe = ((onStoreChange: () => void) => {
            return progressStore.subscribe(transfer.id, onStoreChange);
        })(update);
        update();
        return unsubscribe;
    });

    const currentProgress = $derived(progressData ? progressData.progress : transfer.progress);

    const currentSize = $derived(progressData?.total ?? transfer.size);

    const transferredBytes = $derived(
        progressData?.transferred ??
            (typeof currentSize === 'number' ? (currentSize * currentProgress) / 100 : undefined),
    );

    const transferSamplesRef: RefObject<TransferProgressSample[]> = { current: [] };

    const smoothedTransferSpeedRef: RefObject<number | null> = { current: null };

    let transferEstimate = $state.raw<TransferEstimate>({ bytesPerSecond: null, transferred: null });
    function setTransferEstimate(next: SetStateAction<TransferEstimate>) {
        transferEstimate = typeof next === 'function' ? next(transferEstimate) : next;
    }

    $effect(() => {
        void [transferredBytes, transfer.status];
        return untrack(() => {
            if (transfer.status !== 'active') {
                transferSamplesRef.current = [];
                smoothedTransferSpeedRef.current = null;
                setTransferEstimate((previous) =>
                    previous.bytesPerSecond === null && previous.transferred === null
                        ? previous
                        : { bytesPerSecond: null, transferred: null },
                );
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
        });
    });

    $effect(() => {
        void [transfer.status];
        return untrack(() => {
            if (transfer.status !== 'active') return;

            const timer = window.setInterval(() => {
                const samples = transferSamplesRef.current;
                const latestSample = samples[samples.length - 1];
                if (!latestSample) return;

                const now = performance.now();
                if (now - latestSample.timestamp > TRANSFER_PROGRESS_STALE_MS) {
                    transferSamplesRef.current = [{ transferred: latestSample.transferred, timestamp: now }];
                    smoothedTransferSpeedRef.current = 0;
                    setTransferEstimate((previous) =>
                        previous.bytesPerSecond === 0 && previous.transferred === latestSample.transferred
                            ? previous
                            : { bytesPerSecond: 0, transferred: latestSample.transferred },
                    );
                    return;
                }

                const firstSample = samples[0];
                const elapsed = latestSample.timestamp - firstSample.timestamp;
                if (elapsed < TRANSFER_SPEED_MIN_WINDOW_MS) {
                    setTransferEstimate((previous) =>
                        previous.transferred === latestSample.transferred
                            ? previous
                            : { bytesPerSecond: previous.bytesPerSecond, transferred: latestSample.transferred },
                    );
                    return;
                }

                const measuredSpeed =
                    (Math.max(0, latestSample.transferred - firstSample.transferred) * 1000) / elapsed;
                const previousSmoothedSpeed = smoothedTransferSpeedRef.current;
                const smoothedSpeed =
                    previousSmoothedSpeed === null
                        ? measuredSpeed
                        : previousSmoothedSpeed * (1 - TRANSFER_SPEED_SMOOTHING) +
                          measuredSpeed * TRANSFER_SPEED_SMOOTHING;
                smoothedTransferSpeedRef.current = smoothedSpeed;
                setTransferEstimate((previous) =>
                    previous.bytesPerSecond === smoothedSpeed && previous.transferred === latestSample.transferred
                        ? previous
                        : { bytesPerSecond: smoothedSpeed, transferred: latestSample.transferred },
                );
            }, TRANSFER_SPEED_REFRESH_MS);

            return () => window.clearInterval(timer);
        });
    });

    const speedMbit = $derived(
        transferEstimate.bytesPerSecond === null
            ? '--'
            : Math.round((transferEstimate.bytesPerSecond * 8) / 1_000_000).toLocaleString(
                  language === 'en' ? 'en-US' : 'ru-RU',
              ),
    );

    const remainingBytes = $derived(
        typeof currentSize === 'number' && typeof transferEstimate.transferred === 'number'
            ? Math.max(0, currentSize - transferEstimate.transferred)
            : null,
    );

    const remainingSeconds = $derived(
        remainingBytes === 0
            ? 0
            : remainingBytes !== null &&
                transferEstimate.bytesPerSecond !== null &&
                transferEstimate.bytesPerSecond > 0
              ? Math.ceil(remainingBytes / transferEstimate.bytesPerSecond)
              : null,
    );

    const remainingMinutesLabel = $derived(
        remainingSeconds === null ? '--' : String(Math.floor(remainingSeconds / 60)),
    );

    const remainingSecondsLabel = $derived(
        remainingSeconds === null ? '--' : String(remainingSeconds % 60).padStart(2, '0'),
    );

    const activeTransferLabel = $derived(
        t('sftp.transferSpeedRemaining', {
            speed: speedMbit,
            minutes: remainingMinutesLabel,
            seconds: remainingSecondsLabel,
        }),
    );
</script>

<div
    style="padding: 10px; background: rgba(0,0,0,0.02); border-radius: 6px; border: 1px solid var(--border-color)"
>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; gap: 10px">
        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; flex: 1; min-width: 0">
            {#if transfer.type === 'upload'}<Upload size={14} style="flex-shrink: 0" />{:else}<Download
                    size={14}
                    style="flex-shrink: 0"
                />{/if}
            <span
                style="font-size: var(--font-size-secondary); font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis"
            >
                {transfer.filename}
            </span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0">
            <span style={inlineStyle({ fontSize: 'var(--font-size-xs)', color: primaryRed, fontWeight: 'bold' })}>
                {#if transfer.status === 'success'}OK{:else if transfer.status === 'active'}{`${currentProgress}%`}{:else}!{/if}
            </span>
            {#if !hideActions}<button
                    class="transfer-close-btn"
                    onclick={(e) => {
                        e.stopPropagation();
                        if (transfer.status === 'active') {
                            onCancelTransfer(transfer);
                        } else {
                            onRemoveTransfer(transfer.id);
                        }
                    }}
                    style="background: transparent; border: none; cursor: pointer; padding: 2px; color: inherit; display: flex; align-items: center; opacity: 0.6; border-radius: 4px"
                    title={transfer.status === 'active' ? t('common.cancel') : t('common.delete')}
                >
                    <X size={14} />
                </button>{/if}
        </div>
    </div>
    <div style="width: 100%; height: 4px; background: rgba(0,0,0,0.1); border-radius: 2px; overflow: hidden">
        <div
            style={inlineStyle({
                width: '100%',
                height: '100%',
                background:
                    transfer.status === 'success'
                        ? '#1fb466'
                        : transfer.status === 'error'
                          ? '#ff5555'
                          : primaryRed,
                transform: `scaleX(${Math.max(0, Math.min(currentProgress, 100)) / 100})`,
                transformOrigin: 'left center',
                transition: 'transform 160ms linear',
                willChange: 'transform',
            })}
        ></div>
    </div>
    <div style="display: flex; justify-content: space-between; margin-top: 4px">
        <span style="font-size: var(--font-size-xs); opacity: 0.7">
            {#if typeof currentSize === 'number'}{formatSize(currentSize)}{:else}--{/if}
        </span>
        <span style="font-size: var(--font-size-xs); opacity: 0.7">
            {#if transfer.status === 'active'}{activeTransferLabel}{:else if transfer.status === 'success'}{t(
                    'common.success',
                )}{:else}{t('common.error')}{/if}
        </span>
    </div>
</div>
