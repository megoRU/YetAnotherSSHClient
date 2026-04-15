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

export const SftpFileList: React.FC<SftpFileListProps> = ({
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
                    <th style={{ padding: '10px', width: '100px' }}>Размер</th>
                    <th style={{ padding: '10px', width: '150px' }}>Дата</th>
                </tr>
            </thead>
            <tbody>
                {files.map((file, index) => {
                    const isDir = (file.attrs.mode & 0o040000) !== 0;
                    const isSelected = selectedFilenames.includes(file.filename);

                    return (
                        <tr
                            key={file.filename}
                            className={`sftp-row ${isSelected ? 'selected' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                onFileClick(e, file.filename, index);
                            }}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                onFileDoubleClick(file);
                            }}
                            onContextMenu={(e) => onFileContextMenu(e, file)}
                            style={{ cursor: 'pointer', position: 'relative' }}
                        >
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                {isDir ? <Folder size={18} color="#d79921" /> : <File size={18} opacity={0.7} />}
                            </td>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {file.filename}
                            </td>
                            <td style={{ padding: '8px 10px', opacity: 0.7 }}>
                                {isDir ? '--' : formatSize(file.attrs.size)}
                            </td>
                            <td style={{ padding: '8px 10px', opacity: 0.7, fontSize: '12px' }}>
                                {new Date(file.attrs.mtime * 1000).toLocaleString()}
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
};
