<script module lang="ts">
    import { CloudUpload, X } from '@lucide/svelte';

    import type { Transfer, AppConfig, SftpProgress } from '../../types';

    import { createI18n } from '../../utils/i18n';

    import TransferItem from './TransferItem.svelte';

    interface SftpTransferPanelProps {
        activeTransfers: Transfer[];
        progressStore: ProgressStoreInterface;
        primaryRed: string;
        onCancelTransfer: (transfer: Transfer) => void;
        onRemoveTransfer: (id: string) => void;
        onClearFinished: () => void;
        appConfig?: AppConfig;
    }

    export interface ProgressStoreInterface {
        subscribe: (id: string, listener: () => void) => () => void;
        getSnapshot: (id: string) => SftpProgress | undefined;
    }
</script>

<script lang="ts">
    let {
        activeTransfers,
        progressStore,
        primaryRed,
        onCancelTransfer,
        onRemoveTransfer,
        onClearFinished,
        appConfig,
    }: SftpTransferPanelProps = $props();

    const { t } = $derived(createI18n(appConfig?.language || 'ru'));

    const transferEntries = $derived.by(() => {
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
    });
</script>

<div
    class="sftp-transfers-panel open"
    style="width: 350px; height: 100%; background: var(--bg-color); border-left: 1px solid var(--border-color); display: flex; flex-direction: column; z-index: 100; transition: width 0.3s ease"
>
    <div
        style="padding: 10px 15px; display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.02); border-bottom: 1px solid var(--border-color); min-height: 53.2px; box-sizing: border-box"
    >
        <div style="display: flex; align-items: center; gap: 8px; font-weight: bold">
            <CloudUpload size={16} color={primaryRed} />
            {t('sftp.tasks')} ({transferEntries.filter((entry) =>
                entry.transfers.some((transfer) => transfer.status === 'active'),
            ).length})
        </div>
        {#if activeTransfers.some((transfer) => transfer.status !== 'active')}<button
                class="btn-secondary"
                style="font-size: var(--font-size-xs); padding: 4px 10px; flex-shrink: 0"
                onclick={onClearFinished}
            >
                {t('sftp.clear')}
            </button>{/if}
    </div>

    <div style="flex: 1; overflow-y: auto; padding: 15px">
        {#if activeTransfers.length === 0}<div
                style="height: 100%; display: flex; align-items: center; justify-content: center; opacity: 0.7; font-size: var(--font-size-base); text-align: center; padding: 0 20px"
            >
                {t('sftp.transferEmpty')}
            </div>{:else}<div style="display: flex; flex-direction: column; gap: 10px">
                {#each transferEntries as entry (entry.key)}{#if entry.grouped}<div
                            style="display: flex; flex-direction: column; gap: 7px; padding: 9px; border: 1px solid var(--border-color); border-radius: 8px"
                        >
                            <div
                                style="display: flex; align-items: center; justify-content: space-between; gap: 8px"
                            >
                                <span style="font-size: var(--font-size-secondary); font-weight: bold">
                                    {t(
                                        entry.transfers[0]?.type === 'download'
                                            ? 'sftp.downloadGroup'
                                            : 'sftp.uploadGroup',
                                        { count: String(entry.transfers.length) },
                                    )}
                                </span>
                                {#if entry.transfers.some((transfer) => transfer.status === 'active')}<button
                                        class="transfer-close-btn"
                                        onclick={() => {
                                            const activeTransfer = entry.transfers.find(
                                                (transfer) => transfer.status === 'active',
                                            );
                                            if (activeTransfer) onCancelTransfer(activeTransfer);
                                        }}
                                        title={t('common.cancel')}
                                        style="background: transparent; border: none; cursor: pointer; padding: 2px; color: inherit; display: flex; align-items: center; opacity: 0.6; border-radius: 4px"
                                    >
                                        <X size={14} />
                                    </button>{/if}
                            </div>
                            {#each entry.transfers as transfer (transfer.id)}<TransferItem
                                    {transfer}
                                    {progressStore}
                                    language={appConfig?.language || 'ru'}
                                    {primaryRed}
                                    {onCancelTransfer}
                                    {onRemoveTransfer}
                                    {t}
                                    hideActions={transfer.status === 'active'}
                                />{/each}
                        </div>{:else}<TransferItem
                            transfer={entry.transfers[0]}
                            {progressStore}
                            language={appConfig?.language || 'ru'}
                            {primaryRed}
                            {onCancelTransfer}
                            {onRemoveTransfer}
                            {t}
                        />{/if}{/each}
            </div>{/if}
    </div>
</div>
