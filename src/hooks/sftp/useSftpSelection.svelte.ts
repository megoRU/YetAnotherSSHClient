import type { SftpFileEntry } from '../../types';

import { type ElementEvent, type RefObject, type SetStateAction } from '../../utils/dom';

export function useSftpSelection(
    getDisplayFileList: () => SftpFileEntry[],
    contentRef: RefObject<HTMLDivElement | null>,
    onFileDoubleClick: (file: SftpFileEntry) => void,
) {
    let selectedFilenames = $state.raw<string[]>([]);
    function setSelectedFilenames(next: SetStateAction<string[]>) {
        selectedFilenames = typeof next === 'function' ? next(selectedFilenames) : next;
    }
    let lastSelectedIndex = $state.raw<number>(-1);
    function setLastSelectedIndex(next: SetStateAction<number>) {
        lastSelectedIndex = typeof next === 'function' ? next(lastSelectedIndex) : next;
    }

    const handleFileClick = (e: MouseEvent, f: string, i: number) => {
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
            contentRef.current?.focus({ preventScroll: true });
        }
        if (e.shiftKey && lastSelectedIndex !== -1) {
            const start = Math.min(lastSelectedIndex, i);
            const end = Math.max(lastSelectedIndex, i);
            setSelectedFilenames((prev) =>
                Array.from(
                    new Set([
                        ...prev,
                        ...getDisplayFileList()
                            .slice(start, end + 1)
                            .map((file) => file.filename),
                    ]),
                ),
            );
        } else if (e.ctrlKey || e.metaKey) {
            setSelectedFilenames((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
            setLastSelectedIndex(i);
        } else {
            setSelectedFilenames([f]);
            setLastSelectedIndex(i);
        }
    };

    const handleKeyDown = (e: ElementEvent<KeyboardEvent, HTMLDivElement>) => {
        if (e.key === 'Enter') {
            if (selectedFilenames.length === 1) {
                const filename = selectedFilenames[0];
                const file = getDisplayFileList().find((f) => f.filename === filename);
                if (file) {
                    e.preventDefault();
                    onFileDoubleClick(file);
                }
            }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (getDisplayFileList().length === 0) return;
            let nextIndex = -1;
            if (selectedFilenames.length === 0) {
                nextIndex = 0;
            } else {
                const currentIndex =
                    lastSelectedIndex !== -1
                        ? lastSelectedIndex
                        : getDisplayFileList().findIndex((f) => f.filename === selectedFilenames[0]);
                if (e.key === 'ArrowUp') {
                    nextIndex = currentIndex - 1;
                } else {
                    nextIndex = currentIndex + 1;
                }
            }

            if (nextIndex < 0) nextIndex = 0;
            if (nextIndex >= getDisplayFileList().length) nextIndex = getDisplayFileList().length - 1;

            const nextFile = getDisplayFileList()[nextIndex];
            if (nextFile) {
                setSelectedFilenames([nextFile.filename]);
                setLastSelectedIndex(nextIndex);

                setTimeout(() => {
                    const selectedRow = contentRef.current?.querySelector('.sftp-row.selected');
                    if (selectedRow) {
                        selectedRow.scrollIntoView({ block: 'nearest' });
                    }
                }, 0);
            }
        }
    };

    return {
        get selectedFilenames() {
            return selectedFilenames;
        },
        setSelectedFilenames,
        get lastSelectedIndex() {
            return lastSelectedIndex;
        },
        setLastSelectedIndex,
        get handleFileClick() {
            return handleFileClick;
        },
        get handleKeyDown() {
            return handleKeyDown;
        },
    };
}
