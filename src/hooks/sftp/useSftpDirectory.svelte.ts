import type { SftpFileEntry } from '../../types';

import { normalizeRemotePath } from '../../utils';

import { type Dispatch, type RefObject, type SetStateAction } from '../../utils/dom';

const { ipcRenderer } = window;

export interface ActiveUploadPlaceholder {
    filename: string;
    remotePath: string;
    isDir?: boolean;
    size?: number;
}

const noUploads: ActiveUploadPlaceholder[] = [];

const isHidden = ({ filename }: SftpFileEntry) => filename.startsWith('.') && filename !== '..';

const isDirectory = ({ attrs }: SftpFileEntry) => (attrs.mode & 0o170000) === 0o040000;

const fileExtension = (filename: string) => filename.slice(filename.lastIndexOf('.') + 1);

export function useSftpDirectory(
    getId: () => string,
    rawStatusRef: RefObject<string>,
    tRef: RefObject<(key: string, params?: Record<string, string>) => string>,
    getActiveUploads: () => ActiveUploadPlaceholder[],
    setSelectedFilenames: Dispatch<SetStateAction<string[]>>,
    setLastSelectedIndex: Dispatch<SetStateAction<number>>,
) {
    let path = $state.raw('');
    function setPath(next: SetStateAction<typeof path>) {
        path = typeof next === 'function' ? next(path) : next;
    }
    const pathRef = { current: '' };
    let files = $state.raw<SftpFileEntry[]>([]);
    function setFiles(next: SetStateAction<SftpFileEntry[]>) {
        files = typeof next === 'function' ? next(files) : next;
    }
    let loading = $state.raw(true);
    function setLoading(next: SetStateAction<typeof loading>) {
        loading = typeof next === 'function' ? next(loading) : next;
    }
    let error = $state.raw<string | null>(null);
    function setError(next: SetStateAction<string | null>) {
        error = typeof next === 'function' ? next(error) : next;
    }
    let showHidden = $state.raw(false);
    function setShowHidden(next: SetStateAction<typeof showHidden>) {
        showHidden = typeof next === 'function' ? next(showHidden) : next;
    }
    let isRefreshing = $state.raw(false);
    function setIsRefreshing(next: SetStateAction<typeof isRefreshing>) {
        isRefreshing = typeof next === 'function' ? next(isRefreshing) : next;
    }
    let sortField = $state.raw<'name' | 'size' | 'mtime' | 'type'>('name');
    function setSortField(next: SetStateAction<'name' | 'size' | 'mtime' | 'type'>) {
        sortField = typeof next === 'function' ? next(sortField) : next;
    }
    let sortDirection = $state.raw<'asc' | 'desc'>('asc');
    function setSortDirection(next: SetStateAction<'asc' | 'desc'>) {
        sortDirection = typeof next === 'function' ? next(sortDirection) : next;
    }
    const directoryRequestRef = { current: 0 };

    const activeUploadMetadata = $derived.by(() => {
        if (!getActiveUploads().length) return noUploads;
        const currentDirPath = normalizeRemotePath(path);
        const uploadsInCurrentDir = getActiveUploads().filter((t) => {
            const parentDir = normalizeRemotePath(t.remotePath.substring(0, t.remotePath.lastIndexOf('/')) || '/');
            return parentDir === currentDirPath;
        });
        return uploadsInCurrentDir.length ? uploadsInCurrentDir : noUploads;
    });

    const loadDirectory = async (dirPath: string, force = false) => {
        if (!force && rawStatusRef.current !== 'ready') return;
        const requestId = ++directoryRequestRef.current;
        const normalizedPath = normalizeRemotePath(dirPath);
        setLoading(true);
        setError(null);
        setSelectedFilenames([]);
        setLastSelectedIndex(-1);

        try {
            const list = (await ipcRenderer?.sftpReaddir?.({ id: getId(), path: normalizedPath })) as
                SftpFileEntry[] | null;
            if (list === null) throw new Error(tRef.current('errors.readdirError', { message: '' }));

            // Быстрые переходы могут оставить несколько запросов в полёте.
            // Применяем ответ только от последнего запроса, пока соединение ещё активно.
            if (requestId !== directoryRequestRef.current || rawStatusRef.current !== 'ready') return;

            const filteredList = (list || []).filter((f) => f.filename !== '.' && f.filename !== '..');
            filteredList.sort((a, b) => {
                const aIsDir = isDirectory(a);
                const bIsDir = isDirectory(b);
                if (aIsDir && !bIsDir) return -1;
                if (!aIsDir && bIsDir) return 1;
                return a.filename.localeCompare(b.filename);
            });

            if (normalizedPath !== '/' && normalizedPath !== '') {
                filteredList.unshift({
                    filename: '..',
                    longname: '..',
                    attrs: { mode: 0o040000, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 },
                });
            }

            setFiles(filteredList);
            setPath(normalizedPath);
            pathRef.current = normalizedPath;
        } catch (err: unknown) {
            if (requestId !== directoryRequestRef.current) return;
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
        } finally {
            if (requestId === directoryRequestRef.current) {
                setLoading(false);
            }
        }
    };

    const hasHiddenFiles = $derived(files.some(isHidden));

    const displayFileList = $derived.by(() => {
        let visible = !showHidden && hasHiddenFiles ? files.filter((f) => !isHidden(f)) : files;
        const listedCount = visible.length;
        if (activeUploadMetadata.length) {
            const existingNames = new Set<string>();
            for (const file of files) existingNames.add(file.filename);

            for (const t of activeUploadMetadata) {
                if (existingNames.has(t.filename)) continue;
                existingNames.add(t.filename);
                if (!showHidden && t.filename.startsWith('.') && t.filename !== '..') continue;
                if (visible === files) visible = files.slice();
                visible.push({
                    filename: t.filename,
                    longname: '',
                    attrs: {
                        mode: t.isDir ? 0o040000 : 0o100644,
                        uid: 0,
                        gid: 0,
                        size: t.size || 0,
                        atime: 0,
                        mtime: 0,
                    },
                });
            }
        }

        if (sortField === 'name' && sortDirection === 'asc' && visible.length === listedCount) {
            return visible;
        }

        return (visible === files ? files.slice() : visible).sort((a, b) => {
            if (a.filename === '..') return -1;
            if (b.filename === '..') return 1;

            const aIsDir = isDirectory(a);
            const bIsDir = isDirectory(b);

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

                if (aIsLink && !bIsLink) comparison = -1;
                else if (!aIsLink && bIsLink) comparison = 1;
                else comparison = fileExtension(a.filename).localeCompare(fileExtension(b.filename));
            }

            return sortDirection === 'asc' ? comparison : -comparison;
        });
    });

    return {
        get path() {
            return path;
        },
        pathRef,
        setPath,
        get files() {
            return files;
        },
        get loading() {
            return loading;
        },
        setLoading,
        get error() {
            return error;
        },
        setError,
        get showHidden() {
            return showHidden;
        },
        setShowHidden,
        get isRefreshing() {
            return isRefreshing;
        },
        setIsRefreshing,
        get sortField() {
            return sortField;
        },
        setSortField,
        get sortDirection() {
            return sortDirection;
        },
        setSortDirection,
        get loadDirectory() {
            return loadDirectory;
        },
        get hasHiddenFiles() {
            return hasHiddenFiles;
        },
        get displayFileList() {
            return displayFileList;
        },
    };
}
