import { useCallback, useMemo, useRef, useState } from 'react';
import type { SftpFileEntry } from '../../types';
import { normalizeRemotePath } from '../../utils';

const { ipcRenderer } = window;

export interface ActiveUploadPlaceholder {
    filename: string;
    remotePath: string;
    isDir?: boolean;
    size?: number;
}

export function useSftpDirectory(
    id: string,
    rawStatusRef: React.MutableRefObject<string>,
    tRef: React.MutableRefObject<(key: string, params?: Record<string, string>) => string>,
    activeUploads: ActiveUploadPlaceholder[],
    setSelectedFilenames: React.Dispatch<React.SetStateAction<string[]>>,
    setLastSelectedIndex: React.Dispatch<React.SetStateAction<number>>
) {
    const [path, setPath] = useState('');
    const pathRef = useRef('');
    const [files, setFiles] = useState<SftpFileEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showHidden, setShowHidden] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [sortField, setSortField] = useState<'name' | 'size' | 'mtime' | 'type'>('name');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

    const activeUploadsKey = activeUploads.map(t => `${t.remotePath}:${t.filename}:${t.isDir}:${t.size}`).join('|');

    const activeUploadMetadata = useMemo(() => {
        const uploadsInCurrentDir: ActiveUploadPlaceholder[] = [];
        const currentDirPath = normalizeRemotePath(path);

        activeUploads.forEach(t => {
            const parentDir = normalizeRemotePath(t.remotePath.substring(0, t.remotePath.lastIndexOf('/')) || '/');
            if (parentDir === currentDirPath) {
                uploadsInCurrentDir.push(t);
            }
        });

        const seen = new Set<string>();
        return uploadsInCurrentDir.filter(item => {
            if (seen.has(item.filename)) return false;
            seen.add(item.filename);
            return true;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeUploadsKey, path]);

    const loadDirectory = useCallback(async (dirPath: string, force = false) => {
        if (!force && rawStatusRef.current !== 'ready') return;
        const normalizedPath = normalizeRemotePath(dirPath);
        setLoading(true);
        setError(null);
        setSelectedFilenames([]);
        setLastSelectedIndex(-1);

        try {
            const list = await ipcRenderer?.sftpReaddir?.({ id, path: normalizedPath }) as SftpFileEntry[] | null;
            if (list === null) throw new Error(tRef.current('errors.readdirError', { message: '' }));

            let filteredList = (list || []).filter((f: SftpFileEntry) => f.filename !== '.' && f.filename !== '..');
            filteredList.sort((a, b) => {
                const aMode = a.attrs.mode;
                const bMode = b.attrs.mode;
                const aIsDir = (aMode & 0o170000) === 0o040000;
                const bIsDir = (bMode & 0o170000) === 0o040000;
                if (aIsDir && !bIsDir) return -1;
                if (!aIsDir && bIsDir) return 1;
                return a.filename.localeCompare(b.filename);
            });

            if (normalizedPath !== '/' && normalizedPath !== '') {
                filteredList = [{
                    filename: '..',
                    longname: '..',
                    attrs: { mode: 0o040000, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 }
                } as SftpFileEntry, ...filteredList];
            }

            setFiles(filteredList);
            setPath(dirPath);
            pathRef.current = dirPath;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [id, rawStatusRef, tRef, setSelectedFilenames, setLastSelectedIndex]);

    const mergedFileList = useMemo(() => {
        const merged = [...files];
        const existingNames = new Set(files.map(f => f.filename));

        activeUploadMetadata.forEach(t => {
            if (!existingNames.has(t.filename)) {
                merged.push({
                    filename: t.filename,
                    longname: '',
                    attrs: {
                        mode: t.isDir ? 0o040000 : 0o100644,
                        uid: 0,
                        gid: 0,
                        size: t.size || 0,
                        atime: 0,
                        mtime: 0
                    }
                } as SftpFileEntry);
                existingNames.add(t.filename);
            }
        });

        return merged.sort((a, b) => {
            if (a.filename === '..') return -1;
            if (b.filename === '..') return 1;

            const aIsDir = (a.attrs.mode & 0o170000) === 0o040000;
            const bIsDir = (b.attrs.mode & 0o170000) === 0o040000;

            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;

            let comparison = 0;
            if (sortField === 'name') {
                comparison = a.filename.localeCompare(b.filename);
            } else if (sortField === 'size') {
                comparison = (a.attrs.size || 0) - (b.attrs.size || 0);
            } else if (sortField === 'mtime') {
                comparison = (a.attrs.mtime || 0) - (b.attrs.mtime || 0);
            } else if (sortField === 'type') {
                const aIsLink = (a.attrs.mode & 0o170000) === 0o120000;
                const bIsLink = (b.attrs.mode & 0o170000) === 0o120000;

                if (aIsDir && !bIsDir) comparison = -1;
                else if (!aIsDir && bIsDir) comparison = 1;
                else if (aIsLink && !bIsLink) comparison = -1;
                else if (!aIsLink && bIsLink) comparison = 1;
                else {
                    const aExt = a.filename.split('.').pop() || '';
                    const bExt = b.filename.split('.').pop() || '';
                    comparison = aExt.localeCompare(bExt);
                }
            }

            return sortDirection === 'asc' ? comparison : -comparison;
        });
    }, [files, activeUploadMetadata, sortField, sortDirection]);

    const hasHiddenFiles = useMemo(() => files.some(f => f.filename.startsWith('.') && f.filename !== '.' && f.filename !== '..'), [files]);

    const displayFileList = useMemo(() => {
        if (showHidden) return mergedFileList;
        return mergedFileList.filter(f => !f.filename.startsWith('.') || f.filename === '..');
    }, [mergedFileList, showHidden]);

    return {
        path,
        pathRef,
        setPath,
        files,
        setFiles,
        loading,
        setLoading,
        error,
        setError,
        showHidden,
        setShowHidden,
        isRefreshing,
        setIsRefreshing,
        sortField,
        setSortField,
        sortDirection,
        setSortDirection,
        loadDirectory,
        mergedFileList,
        hasHiddenFiles,
        displayFileList
    };
}
