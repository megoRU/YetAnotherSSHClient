<script module lang="ts">
    import { ChevronUp, ChevronDown } from '@lucide/svelte';

    import type { SftpFileEntry, AppConfig } from '../../types';

    import { createI18n } from '../../utils/i18n';

    import SftpRow from './SftpRow.svelte';

    interface SftpFileListProps {
        files: SftpFileEntry[];
        dropTargetFilename: string | null;
        selectedFilenames: string[];
        draggingFilenames: string[];
        onFileClick: (e: MouseEvent, filename: string, index: number) => void;
        onFileDoubleClick: (file: SftpFileEntry) => void;
        onFileContextMenu: (e: MouseEvent, file: SftpFileEntry) => void;
        onFileDragStart: (e: DragEvent, file: SftpFileEntry) => void;
        loading: boolean;
        language: AppConfig['language'];
        sortField: 'name' | 'size' | 'mtime' | 'type';
        sortDirection: 'asc' | 'desc';
        onSort: (field: 'name' | 'size' | 'mtime' | 'type') => void;
    }
</script>

<script lang="ts">
    let {
        files,
        dropTargetFilename,
        selectedFilenames,
        draggingFilenames,
        onFileClick,
        onFileDoubleClick,
        onFileContextMenu,
        onFileDragStart,
        loading,
        language,
        sortField,
        sortDirection,
        onSort,
    }: SftpFileListProps = $props();

    const { t } = $derived(createI18n(language));

    const selectedNames = $derived(new Set(selectedFilenames));

    const draggingNames = $derived(new Set(draggingFilenames));
</script>

<table style="width: 100%; border-collapse: collapse; font-size: var(--font-size-base)">
    <thead
        style="position: sticky; top: 0; background: var(--bg-color); z-index: 1; text-align: left; box-shadow: 0 1px 0 var(--border-color)"
    >
        <tr>
            <th style="padding: 10px; width: 30px"></th>
            <th onclick={() => onSort('name')} style="padding: 10px; cursor: pointer; user-select: none">
                <div style="display: flex; align-items: center; gap: 4px">
                    {t('sftp.name')}
                    {#if sortField === 'name'}{#if sortDirection === 'asc'}<ChevronUp
                                size={14}
                            />{:else}<ChevronDown size={14} />{/if}{/if}
                </div>
            </th>
            <th
                onclick={() => onSort('type')}
                style="padding: 10px; width: 100px; cursor: pointer; user-select: none"
            >
                <div style="display: flex; align-items: center; gap: 4px">
                    {t('sftp.type')}
                    {#if sortField === 'type'}{#if sortDirection === 'asc'}<ChevronUp
                                size={14}
                            />{:else}<ChevronDown size={14} />{/if}{/if}
                </div>
            </th>
            <th
                onclick={() => onSort('size')}
                style="padding: 10px; width: 140px; cursor: pointer; user-select: none"
            >
                <div style="display: flex; align-items: center; gap: 4px">
                    {t('sftp.size')}
                    {#if sortField === 'size'}{#if sortDirection === 'asc'}<ChevronUp
                                size={14}
                            />{:else}<ChevronDown size={14} />{/if}{/if}
                </div>
            </th>
            <th
                onclick={() => onSort('mtime')}
                style="padding: 10px; width: 180px; cursor: pointer; user-select: none; white-space: nowrap"
            >
                <div style="display: flex; align-items: center; gap: 4px">
                    {t('sftp.modified')}
                    {#if sortField === 'mtime'}{#if sortDirection === 'asc'}<ChevronUp
                                size={14}
                            />{:else}<ChevronDown size={14} />{/if}{/if}
                </div>
            </th>
        </tr>
    </thead>
    <tbody>
        {#each files as file, index (file.filename)}<SftpRow
                {file}
                isDropTarget={dropTargetFilename === file.filename}
                {index}
                isSelected={selectedNames.has(file.filename)}
                isDragging={draggingNames.has(file.filename)}
                {onFileClick}
                {onFileDoubleClick}
                {onFileContextMenu}
                {onFileDragStart}
                {t}
            />{/each}
        {#if !loading && files.length === 0}<tr>
                <td colSpan={5} style="padding: 40px; text-align: center; opacity: 0.7">
                    {t('sftp.empty')}
                </td>
            </tr>{/if}
    </tbody>
</table>
