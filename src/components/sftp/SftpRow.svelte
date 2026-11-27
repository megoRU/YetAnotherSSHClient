<script module lang="ts">
    import { File, Folder } from '@lucide/svelte';

    import type { SftpFileEntry } from '../../types';

    import { formatSize } from '../../utils';

    import { inlineStyle } from '../../utils/dom';

    interface SftpRowProps {
        file: SftpFileEntry;
        index: number;
        isSelected: boolean;
        isDragging: boolean;
        onFileClick: (e: MouseEvent, filename: string, index: number) => void;
        onFileDoubleClick: (file: SftpFileEntry) => void;
        onFileContextMenu: (e: MouseEvent, file: SftpFileEntry) => void;
        onFileDragStart: (e: DragEvent, file: SftpFileEntry) => void;
        t: (key: string, params?: Record<string, string>) => string;
        isDropTarget: boolean;
    }
</script>

<script lang="ts">
    let {
        file,
        index,
        isSelected,
        isDragging,
        onFileClick,
        onFileDoubleClick,
        onFileContextMenu,
        onFileDragStart,
        t,
        isDropTarget,
    }: SftpRowProps = $props();

    const mode = $derived(file.attrs.mode);

    const isDir = $derived((mode & 0o170000) === 0o040000);

    const isLink = $derived((mode & 0o170000) === 0o120000);

    const isParentDir = $derived(file.filename === '..');

    const isTargetDir = $derived(
        isDir || (isLink && file.targetAttrs !== undefined && (file.targetAttrs.mode & 0o170000) === 0o040000),
    );

    const type = $derived.by(() => {
        if (isDir) return t('sftp.folder');
        if (isLink) return t('sftp.link');
        const parts = file.filename.split('.');
        const ext = parts.length > 1 ? parts.pop()!.toUpperCase() : undefined;
        return ext !== undefined && ext.length <= 4 ? ext : t('sftp.file');
    });

    const date = $derived(new Date(file.attrs.mtime * 1000));

    const dateStr = $derived(
        isParentDir
            ? ''
            : date.toLocaleDateString() +
                  ' ' +
                  date.getHours().toString().padStart(2, '0') +
                  ':' +
                  date.getMinutes().toString().padStart(2, '0'),
    );
</script>

<tr
    class={`sftp-row ${isSelected || isDragging ? 'selected' : ''} ${isDropTarget && !isParentDir && isTargetDir ? 'drop-target' : ''}`}
    data-sftp-drop-directory={isTargetDir && !isParentDir ? file.filename : undefined}
    draggable={!isParentDir}
    ondragstart={(e) => onFileDragStart(e, file)}
    onclick={(e) => {
        e.stopPropagation();
        onFileClick(e, file.filename, index);
    }}
    ondblclick={(e) => {
        e.stopPropagation();
        onFileDoubleClick(file);
    }}
    oncontextmenu={(e) => {
        if (isParentDir) return;
        onFileContextMenu(e, file);
    }}
    style="cursor: pointer; position: relative"
>
    <td style="padding: 8px 10px; text-align: center">
        {#if isDir || isParentDir}<Folder size={18} color="#d79921" />{:else}<File size={18} opacity={0.7} />{/if}
    </td>
    <td
        style={inlineStyle({
            padding: '8px 10px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontWeight: isParentDir ? 'bold' : 'normal',
        })}
    >
        {file.filename}
    </td>
    <td style="padding: 8px 10px; opacity: 0.7">
        {#if isParentDir}{:else}{type}{/if}
    </td>
    <td style="padding: 8px 10px; opacity: 0.7; white-space: nowrap">
        {#if isParentDir}{:else if isDir}--{:else}{formatSize(
                isLink && file.targetAttrs ? file.targetAttrs.size : file.attrs.size,
            )}{/if}
    </td>
    <td style="padding: 8px 10px; opacity: 0.7; white-space: nowrap">
        {dateStr}
    </td>
</tr>
