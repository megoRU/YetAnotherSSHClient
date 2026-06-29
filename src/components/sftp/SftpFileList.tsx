import React from 'react';
import { File, Folder, ChevronUp, ChevronDown } from 'lucide-react';
import type { SftpFileEntry, AppConfig } from '../../types';
import { formatSize } from '../../utils';
import { useI18n } from '../../utils/i18n';

interface SftpRowProps {
    file: SftpFileEntry;
    index: number;
    isSelected: boolean;
    onFileClick: (e: React.MouseEvent, filename: string, index: number) => void;
    onFileDoubleClick: (file: SftpFileEntry) => void;
    onFileContextMenu: (e: React.MouseEvent, file: SftpFileEntry) => void;
    t: (key: string, params?: Record<string, string>) => string;
}

const SftpRow = React.memo<SftpRowProps>(({
    file,
    index,
    isSelected,
    onFileClick,
    onFileDoubleClick,
    onFileContextMenu,
    t
}) => {
    const mode = file.attrs.mode;
    const isDir = (mode & 0o170000) === 0o040000;
    const isLink = (mode & 0o170000) === 0o120000;
    const isParentDir = file.filename === '..';

    let type = t('sftp.file');
    if (isDir) type = t('sftp.folder');
    else if (isLink) type = t('sftp.link');
    else {
        const parts = file.filename.split('.');
        if (parts.length > 1) {
            const ext = parts.pop()!.toUpperCase();
            if (ext.length <= 4) {
                type = ext;
            }
        }
    }

    const date = new Date(file.attrs.mtime * 1000);
    const dateStr = isParentDir ? '' : date.toLocaleDateString() + ' ' + date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');

    return (
        <tr
            className={`sftp-row ${isSelected ? 'selected' : ''}`}
            onClick={(e) => {
                if (isParentDir) return;
                e.stopPropagation();
                onFileClick(e, file.filename, index);
            }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                onFileDoubleClick(file);
            }}
            onContextMenu={(e) => {
                if (isParentDir) return;
                onFileContextMenu(e, file);
            }}
            style={{ cursor: 'pointer', position: 'relative' }}
        >
            <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                {isDir || isParentDir ? <Folder size={18} color="#d79921" /> : <File size={18} opacity={0.7} />}
            </td>
            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: isParentDir ? 'bold' : 'normal' }}>
                {file.filename}
            </td>
            <td style={{ padding: '8px 10px', opacity: 0.7 }}>
                {isParentDir ? '' : type}
            </td>
            <td style={{ padding: '8px 10px', opacity: 0.7, whiteSpace: 'nowrap' }}>
                {isParentDir ? '' : (isDir ? '--' : formatSize(isLink && file.targetAttrs ? file.targetAttrs.size : file.attrs.size))}
            </td>
            <td style={{ padding: '8px 10px', opacity: 0.7, fontSize: '12px', whiteSpace: 'nowrap' }}>
                {dateStr}
            </td>
        </tr>
    );
});

interface SftpFileListProps {
    files: SftpFileEntry[];
    selectedFilenames: string[];
    onFileClick: (e: React.MouseEvent, filename: string, index: number) => void;
    onFileDoubleClick: (file: SftpFileEntry) => void;
    onFileContextMenu: (e: React.MouseEvent, file: SftpFileEntry) => void;
    loading: boolean;
    appConfig?: AppConfig;
    sortField: 'name' | 'size' | 'mtime' | 'type';
    sortDirection: 'asc' | 'desc';
    onSort: (field: 'name' | 'size' | 'mtime' | 'type') => void;
}

export const SftpFileList: React.FC<SftpFileListProps> = React.memo(({
    files,
    selectedFilenames,
    onFileClick,
    onFileDoubleClick,
    onFileContextMenu,
    loading,
    appConfig,
    sortField,
    sortDirection,
    onSort
}) => {
    const { t } = useI18n(appConfig?.language || 'ru');
    return (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead style={{
                position: 'sticky',
                top: 0,
                background: 'var(--bg-color)',
                zIndex: 1,
                textAlign: 'left',
                boxShadow: '0 1px 0 var(--border-color)'
            }}>
                <tr>
                    <th style={{ padding: '10px', width: '30px' }}></th>
                    <th
                        onClick={() => onSort('name')}
                        style={{ padding: '10px', cursor: 'pointer', userSelect: 'none' }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {t('sftp.name')}
                            {sortField === 'name' && (sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                        </div>
                    </th>
                    <th
                        onClick={() => onSort('type')}
                        style={{ padding: '10px', width: '100px', cursor: 'pointer', userSelect: 'none' }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {t('sftp.type')}
                            {sortField === 'type' && (sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                        </div>
                    </th>
                    <th
                        onClick={() => onSort('size')}
                        style={{ padding: '10px', width: '140px', cursor: 'pointer', userSelect: 'none' }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {t('sftp.size')}
                            {sortField === 'size' && (sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                        </div>
                    </th>
                    <th
                        onClick={() => onSort('mtime')}
                        style={{ padding: '10px', width: '180px', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {t('sftp.modified')}
                            {sortField === 'mtime' && (sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                        </div>
                    </th>
                </tr>
            </thead>
            <tbody>
                {files.map((file, index) => (
                    <SftpRow
                        key={file.filename}
                        file={file}
                        index={index}
                        isSelected={selectedFilenames.includes(file.filename)}
                        onFileClick={onFileClick}
                        onFileDoubleClick={onFileDoubleClick}
                        onFileContextMenu={onFileContextMenu}
                        t={t}
                    />
                ))}
                {!loading && files.length === 0 && (
                    <tr>
                        <td colSpan={5} style={{ padding: '40px', textAlign: 'center', opacity: 0.7 }}>
                            {t('sftp.empty')}
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    );
});
