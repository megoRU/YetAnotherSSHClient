import {type RefObject, type KeyboardEvent, useCallback, useState} from 'react';
import type { SftpFileEntry } from '../../types';

export function useSftpSelection(
    displayFileList: SftpFileEntry[],
    contentRef: RefObject<HTMLDivElement | null>,
    onFileDoubleClick: (file: SftpFileEntry) => void
) {
    const [selectedFilenames, setSelectedFilenames] = useState<string[]>([]);
    const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1);

    const handleFileClick = useCallback((e: MouseEvent, f: string, i: number) => {
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
            contentRef.current?.focus();
        }
        if (e.shiftKey && lastSelectedIndex !== -1) {
            const start = Math.min(lastSelectedIndex, i);
            const end = Math.max(lastSelectedIndex, i);
            setSelectedFilenames(prev => Array.from(new Set([...prev, ...displayFileList.slice(start, end + 1).map(file => file.filename)])));
        } else if (e.ctrlKey || e.metaKey) {
            setSelectedFilenames(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
            setLastSelectedIndex(i);
        } else {
            setSelectedFilenames([f]);
            setLastSelectedIndex(i);
        }
    }, [lastSelectedIndex, displayFileList, contentRef]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter') {
            if (selectedFilenames.length === 1) {
                const filename = selectedFilenames[0];
                const file = displayFileList.find(f => f.filename === filename);
                if (file) {
                    e.preventDefault();
                    onFileDoubleClick(file);
                }
            }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (displayFileList.length === 0) return;
            let nextIndex = -1;
            if (selectedFilenames.length === 0) {
                nextIndex = 0;
            } else {
                const currentIndex = lastSelectedIndex !== -1 ? lastSelectedIndex : displayFileList.findIndex(f => f.filename === selectedFilenames[0]);
                if (e.key === 'ArrowUp') {
                    nextIndex = currentIndex - 1;
                } else {
                    nextIndex = currentIndex + 1;
                }
            }

            if (nextIndex < 0) nextIndex = 0;
            if (nextIndex >= displayFileList.length) nextIndex = displayFileList.length - 1;

            const nextFile = displayFileList[nextIndex];
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
    }, [selectedFilenames, displayFileList, lastSelectedIndex, onFileDoubleClick, contentRef]);

    return {
        selectedFilenames,
        setSelectedFilenames,
        lastSelectedIndex,
        setLastSelectedIndex,
        handleFileClick,
        handleKeyDown
    };
}
