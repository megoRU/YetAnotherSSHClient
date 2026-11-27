<script module lang="ts">
    import { TriangleAlert, Check, X } from '@lucide/svelte';

    import type { PendingFileUpdate, SftpFileEntry, AppConfig } from '../../types';

    import { createI18n } from '../../utils/i18n';

    import { untrack } from 'svelte';

    import { focusOnMount, inlineStyle } from '../../utils/dom';

    interface SftpModalsProps {
        modal: {
            type: string;
            file?: SftpFileEntry;
            selectedFiles?: SftpFileEntry[];
            errorMessage?: string;
            filename?: string;
            localPath?: string;
            remotePath?: string;
            applicationPath?: string;
            applicationName?: string;
            fileUpdates?: PendingFileUpdate[];
        } | null;
        modalInput: string;
        setModalInput: (val: string) => void;
        onClose: () => void;
        onSkip?: () => void;
        onReplaceAll?: () => void;
        onConfirm: () => void;
        onModalChange?: (modal: SftpModalsProps['modal']) => void;
        isProcessing?: boolean;
        appConfig?: AppConfig;
    }
</script>

<script lang="ts">
    const titleId = $props.id();
    let {
        modal,
        modalInput,
        setModalInput,
        onClose,
        onSkip,
        onReplaceAll,
        onConfirm,
        isProcessing = false,
        appConfig,
        onModalChange,
    }: SftpModalsProps = $props();

    const { t } = $derived(createI18n(appConfig?.language || 'ru'));

    $effect(() => {
        void [modal, onClose];
        return untrack(() => {
            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'Escape' && modal) {
                    onClose();
                }
            };

            window.addEventListener('keydown', handleKeyDown);
            return () => window.removeEventListener('keydown', handleKeyDown);
        });
    });

    const parseMode = (modeStr: string) => {
        const m = parseInt(modeStr, 8) || 0;
        return {
            owner: {
                read: !!(m & 0o400),
                write: !!(m & 0o200),
                execute: !!(m & 0o100),
            },
            group: {
                read: !!(m & 0o040),
                write: !!(m & 0o020),
                execute: !!(m & 0o010),
            },
            others: {
                read: !!(m & 0o004),
                write: !!(m & 0o002),
                execute: !!(m & 0o001),
            },
        };
    };

    const togglePermission = (role: 'owner' | 'group' | 'others', type: 'read' | 'write' | 'execute') => {
        let m = parseInt(modalInput, 8) || 0;
        let mask = 0;
        if (role === 'owner') {
            if (type === 'read') mask = 0o400;
            if (type === 'write') mask = 0o200;
            if (type === 'execute') mask = 0o100;
        } else if (role === 'group') {
            if (type === 'read') mask = 0o040;
            if (type === 'write') mask = 0o020;
            if (type === 'execute') mask = 0o010;
        } else if (role === 'others') {
            if (type === 'read') mask = 0o004;
            if (type === 'write') mask = 0o002;
            if (type === 'execute') mask = 0o001;
        }

        if (m & mask) {
            m &= ~mask;
        } else {
            m |= mask;
        }
        setModalInput(m.toString(8).padStart(3, '0'));
    };

    const selectedFiles = $derived(modal?.selectedFiles ?? (modal?.file ? [modal.file] : []));
    const permissions = $derived(modal?.type === 'permissions' ? parseMode(modalInput) : null);

    const handleFileUpdateSelectionChange = (localPath: string, selected: boolean) => {
        if (!onModalChange || !modal) {
            return;
        }
        const fileUpdates = modal.fileUpdates || [];
        const nextFileUpdates = fileUpdates.map((update) => {
            if (update.localPath === localPath) {
                return { ...update, selected };
            }
            return update;
        });
        onModalChange({ ...modal, fileUpdates: nextFileUpdates });
    };
</script>

{#snippet renderFileUpdateOption(update: PendingFileUpdate)}
    <label class="sftp-file-update-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer">
        <input
            type="checkbox"
            checked={update.selected}
            onchange={(event) => handleFileUpdateSelectionChange(update.localPath, event.currentTarget.checked)}
        />
        <span class="sftp-file-update-indicator" aria-hidden="true">
            {#if update.selected}<Check size={14} strokeWidth={3} />{/if}
        </span>
        <span class="sftp-file-update-path" style="word-break: break-all">{update.remotePath}</span>
    </label>
{/snippet}

{#if modal}<div
        role="presentation"
        style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 2000; backdrop-filter: blur(2px)"
        onclick={(e) => e.stopPropagation()}
    >
        <div
            style={inlineStyle({
                background: 'var(--bg-color)',
                padding: '0',
                borderRadius: '12px',
                width:
                    modal.type === 'permissions' ? '500px' : modal.type === 'overwriteConfirm' ? '680px' : '400px',
                maxWidth: 'calc(100vw - 32px)',
                boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
                border: '1px solid var(--border-color)',
                overflow: 'hidden',
            })}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
        >
            <!-- Header -->
            <div
                style="display: flex; align-items: center; justify-content: space-between; padding: 20px 25px; background: rgba(0,0,0,0.05); border-bottom: 1px solid var(--border-color)"
            >
                <div style="display: flex; align-items: center; gap: 10px">
                    {#if modal.type === 'error' || modal.type === 'cancelUpload' || modal.type === 'overwriteConfirm'}<TriangleAlert
                            color="#cc241d"
                            size={20}
                        />{/if}
                    <h3 id={titleId} style="margin: 0; font-size: 1.1em; line-height: 1.4">
                        {#if modal.type === 'delete'}{(() => {
                                const items = modal?.selectedFiles || (modal?.file ? [modal.file] : []);
                                if (items.length === 1) {
                                    const isDir = (items[0].attrs.mode & 0o040000) !== 0;
                                    return isDir
                                        ? t('sftp.deleteFolderConfirm', { name: items[0].filename })
                                        : t('sftp.deleteConfirm', { name: items[0].filename });
                                }
                                return t('common.delete');
                            })()}{/if}
                        {#if modal.type === 'rename'}{t('sftp.renameTitle')}{/if}
                        {#if modal.type === 'mkdir'}{t('sftp.newFolder')}{/if}
                        {#if modal.type === 'permissions'}{t('sftp.chmodTitle')}{/if}
                        {#if modal.type === 'error'}{t('common.error')}{/if}
                        {#if modal.type === 'cancelUpload'}{t('sftp.cancelUploadTitle')}{/if}
                        {#if modal.type === 'fileUpdate'}{t('sftp.fileUpdateTitle')}{/if}
                        {#if modal.type === 'overwriteConfirm'}{(() => {
                                const updates = modal?.fileUpdates || [];
                                const singleDir = updates.length === 1 && !!updates[0].isDir;
                                return singleDir ? t('sftp.overwriteTitleDir') : t('sftp.overwriteTitle');
                            })()}{/if}
                        {#if modal.type === 'openWithRemember'}{t('sftp.openWith')}{/if}
                    </h3>
                </div>
                <button
                    onclick={onClose}
                    class="modal-close-btn"
                    style="background: none; border: none; padding: 5px; cursor: pointer; color: var(--text-color); opacity: 0.6; display: flex; align-items: center; justify-content: center; border-radius: 6px"
                >
                    <X size={20} />
                </button>
            </div>

            <div style="padding: 25px">
                {#if modal.type === 'delete'}<div style="display: flex; flex-direction: column; gap: 15px">
                        <div
                            style="max-height: 150px; overflow-y: auto; padding: 10px; border-radius: 8px; display: flex; flex-direction: column; gap: 5px"
                        >
                            {#each selectedFiles as f (f.filename)}<div
                                    style="word-break: break-all; font-size: 1.1em"
                                >
                                    {f.filename}
                                </div>{/each}
                        </div>
                    </div>{/if}

                {#if modal.type === 'fileUpdate'}{@const fileUpdates = modal.fileUpdates || []}
                    <div style="display: flex; flex-direction: column; gap: 14px">
                        <p style="margin: 0; font-size: 1.05em; line-height: 1.5">
                            {t('sftp.fileUpdateConfirm', { name: String(fileUpdates.length) })}
                        </p>
                        <div
                            style="max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 8px; border: 1px solid var(--border-color); border-radius: 8px"
                        >
                            {#each fileUpdates as item (item.localPath)}{@render renderFileUpdateOption(
                                    item,
                                )}{/each}
                        </div>
                    </div>{/if}

                {#if modal.type === 'overwriteConfirm'}{@const fileUpdates =
                        modal.fileUpdates || []}{#if fileUpdates.length === 1}{@const update = fileUpdates[0]}
                        <p style="margin: 0; font-size: 1.05em; line-height: 1.5; word-break: break-all">
                            {#if update.isDir}{t('sftp.overwriteConfirmDir', { name: update.filename })}{:else}{t(
                                    'sftp.overwriteConfirm',
                                    { name: update.filename },
                                )}{/if}
                        </p>{:else}<div style="display: flex; flex-direction: column; gap: 14px">
                            <p style="margin: 0; font-size: 1.05em; line-height: 1.5">
                                {t('sftp.overwriteMultiConfirm')}
                            </p>
                            <div
                                style="max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 8px; border: 1px solid var(--border-color); border-radius: 8px"
                            >
                                {#each fileUpdates as item (item.localPath)}{@render renderFileUpdateOption(
                                        item,
                                    )}{/each}
                            </div>
                        </div>{/if}{/if}

                {#if modal.type === 'error'}<p style="margin: 0">{modal.errorMessage}</p>{/if}

                {#if modal.type === 'cancelUpload'}<p style="margin: 0">{t('sftp.cancelUploadConfirm')}</p>{/if}

                {#if modal.type === 'openWithRemember'}
                    {@const extensionStartIndex = modal.filename?.lastIndexOf('.') ?? -1}
                    {@const extension =
                        extensionStartIndex >= 0 ? modal.filename!.substring(extensionStartIndex) : ''}
                    {@const applicationName = modal.applicationName || ''}
                    <div style="display: flex; flex-direction: column; gap: 16px">
                        <p style="margin: 0; font-size: 1.05em; line-height: 1.5">
                            {t('sftp.openWithSelectedApplication', { app: applicationName })}
                        </p>
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px">
                            <span style="line-height: 1.4; font-size: 1.05em">
                                {t('sftp.alwaysUseAppForExtension', { app: applicationName, extension })}
                            </span>
                            <label class="ui-switch" style="flex-shrink: 0">
                                <input
                                    type="checkbox"
                                    checked={modalInput === 'true'}
                                    onchange={(event) =>
                                        setModalInput(event.currentTarget.checked ? 'true' : 'false')}
                                />
                                <span class="ui-slider"></span>
                            </label>
                        </div>
                    </div>{/if}

                {#if modal.type === 'rename' || modal.type === 'mkdir'}<input
                        use:focusOnMount
                        value={modalInput}
                        oninput={(e) => setModalInput(e.currentTarget.value)}
                        onkeydown={(e) => e.key === 'Enter' && onConfirm()}
                        placeholder={modal.type === 'mkdir' ? t('sftp.newFolder') : ''}
                        style="width: 100%; padding: 12px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); border-radius: 8px; font-size: 1em"
                    />{/if}

                {#if modal.type === 'permissions' && permissions}<div
                        style="display: flex; flex-direction: column; gap: 20px"
                    >
                        <div style="font-weight: bold; font-size: 1.1em; opacity: 0.9; word-break: break-all">
                            {#if modal.selectedFiles && modal.selectedFiles.length > 1}{`${t('sftp.selectedItems')}: ${modal.selectedFiles.length}`}{:else}{modal
                                    .file?.filename}{/if}
                        </div>

                        <div>
                            <div
                                style="display: flex; border-bottom: 1px solid var(--border-color); padding-bottom: 10px; margin-bottom: 10px"
                            >
                                <div style="flex: 2; font-weight: bold">{t('sftp.rights')}</div>
                                <div style="flex: 1; text-align: center; font-weight: bold">{t('sftp.read')}</div>
                                <div style="flex: 1; text-align: center; font-weight: bold">{t('sftp.write')}</div>
                                <div style="flex: 1; text-align: center; font-weight: bold">
                                    {t('sftp.execute')}
                                </div>
                            </div>

                            {#each ['owner', 'group', 'others'] as const as role (role)}<div
                                    style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border-color)"
                                >
                                    <div style="flex: 2">
                                        {#if role === 'owner'}{t('sftp.owner')}{:else if role === 'group'}{t(
                                                'sftp.group',
                                            )}{:else}{t('sftp.others')}{/if}
                                    </div>
                                    {#each ['read', 'write', 'execute'] as const as type (type)}<div
                                            style="flex: 1; display: flex; justify-content: center"
                                        >
                                            <label class="ui-switch">
                                                <input
                                                    type="checkbox"
                                                    checked={permissions[role][type]}
                                                    onchange={() => togglePermission(role, type)}
                                                />
                                                <span class="ui-slider"></span>
                                            </label>
                                        </div>{/each}
                                </div>{/each}
                        </div>

                        <div style="display: flex; align-items: center; gap: 10px; opacity: 1; font-size: 1.1em">
                            {t('sftp.mode')}:
                            <input
                                value={modalInput}
                                oninput={(e) => {
                                    const val = e.currentTarget.value.replace(/[^0-7]/g, '').slice(0, 3);
                                    setModalInput(val);
                                }}
                                style="width: 60px; padding: 4px 8px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); border-radius: 4px; text-align: center"
                            />
                        </div>
                    </div>{/if}

                <div
                    style={inlineStyle({
                        display: 'flex',
                        flexWrap: modal.type === 'overwriteConfirm' ? 'nowrap' : 'wrap',
                        justifyContent: 'flex-end',
                        gap: '12px',
                        marginTop: '30px',
                    })}
                >
                    {#if modal.type === 'overwriteConfirm'}
                        <button
                            class="btn-secondary"
                            onclick={onClose}
                            style="padding: 10px 20px; flex: 0 0 auto; white-space: nowrap; display: flex; align-items: center; justify-content: center; gap: 8px"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            class="btn-secondary"
                            onclick={() => onSkip?.()}
                            style="padding: 10px 20px; flex: 0 0 auto; white-space: nowrap; display: flex; align-items: center; justify-content: center; gap: 8px"
                        >
                            {t('sftp.skip')}
                        </button>
                        {#if (modal.fileUpdates || []).length > 1}<button
                                class="btn-secondary"
                                onclick={() => onReplaceAll?.()}
                                style="padding: 10px 20px; flex: 0 0 auto; white-space: nowrap; display: flex; align-items: center; justify-content: center; gap: 8px"
                            >
                                {t('sftp.replaceAll')}
                            </button>{/if}
                        <button
                            class="btn-primary"
                            onclick={onConfirm}
                            disabled={isProcessing || !(modal.fileUpdates || []).some((update) => update.selected)}
                            style="padding: 10px 20px; flex: 0 0 auto; white-space: nowrap; display: flex; align-items: center; justify-content: center; gap: 8px"
                        >
                            {#if isProcessing}<div
                                    class="loading-spinner"
                                    style="width: 16px; height: 16px; border: 2px solid transparent; border-top-color: #fff"
                                ></div>{/if}
                            {#if modal.fileUpdates?.length === 1}{t('sftp.replace')}{:else}{t(
                                    'sftp.replaceSelected',
                                )}{/if}
                        </button>
                    {:else}<button
                            class={modal.type === 'delete' ? 'btn-danger' : 'btn-primary'}
                            onclick={onConfirm}
                            disabled={isProcessing}
                            style={inlineStyle({
                                padding: '10px 20px',
                                minWidth: '100px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                ...(modal.type === 'permissions' ? { background: '#1fb466' } : {}),
                            })}
                        >
                            {#if isProcessing}<div
                                    class="loading-spinner"
                                    style="width: 16px; height: 16px; border: 2px solid transparent; border-top-color: #fff"
                                ></div>{/if}
                            {#if modal.type === 'delete'}{t('common.delete')}{:else if modal.type === 'mkdir'}{t(
                                    'sftp.create',
                                )}{:else if modal.type === 'error'}OK{:else if modal.type === 'cancelUpload'}{t(
                                    'common.yes',
                                )}{:else if modal.type === 'fileUpdate'}{t(
                                    'sftp.upload',
                                )}{:else if modal.type === 'openWithRemember'}{t('sftp.open')}{:else}{t(
                                    'common.save',
                                )}{/if}
                        </button>{/if}
                </div>
            </div>
        </div>
    </div>{/if}
