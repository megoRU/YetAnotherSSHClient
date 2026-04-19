import React from 'react';
import { File, Folder } from 'lucide-react';
import type { SftpFileEntry } from '../../types';
import { formatSize } from '../../utils';

interface SftpFileListProps {
    files: SftpFileEntry[];
    selectedFilenames: string[];
    onFileClick: (e: React.MouseEvent, filename: string, index: number) => void;
    onFileDoubleClick: (file: SftpFileEntry) => void;
    onFileContextMenu: (e: React.MouseEvent, file: SftpFileEntry) => void;
    loading: boolean;
}

export const SftpFileList: React.FC<SftpFileListProps> = React.memo(({
    files,
    selectedFilenames,
    onFileClick,
    onFileDoubleClick,
    onFileContextMenu,
    loading
}) => {
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
                    <th style={{ padding: '10px' }}>Имя</th>
                    <th style={{ padding: '10px', width: '100px' }}>Тип</th>
                    <th style={{ padding: '10px', width: '140px' }}>Размер</th>
                    <th style={{ padding: '10px', width: '150px' }}>Дата</th>
                </tr>
            </thead>
            <tbody>
                {files.map((file, index) => {
                    const mode = file.attrs.mode;
                    const isDir = (mode & 0o170000) === 0o040000;
                    const isLink = (mode & 0o170000) === 0o120000;
                    const isParentDir = file.filename === '..';
                    const isSelected = selectedFilenames.includes(file.filename);

                    let type = 'Файл';
                    if (isDir) type = 'Папка';
                    else if (isLink) type = 'Ссылка';
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
                            key={file.filename}
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
                })}
                {!loading && files.length === 0 && (
                    <tr>
                        <td colSpan={4} style={{ padding: '40px', textAlign: 'center', opacity: 0.7 }}>
                            Папка пустая
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    );
});
