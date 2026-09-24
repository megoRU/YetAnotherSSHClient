import {type Dispatch, type SetStateAction, useEffect} from 'react';
import type { PendingFileUpdate, SftpFileEntry } from '../../types';

const { ipcRenderer } = window;

interface SftpModalState {
    type: string;
    file?: SftpFileEntry;
    selectedFiles?: SftpFileEntry[];
    errorMessage?: string;
    cancelPath?: string;
    localPath?: string;
    remotePath?: string;
    filename?: string;
    applicationPath?: string;
    applicationName?: string;
    fileUpdates?: PendingFileUpdate[];
}

interface UseSftpFileChangeEventsProps {
    id: string;
    setModal: Dispatch<SetStateAction<SftpModalState | null>>;
}

export function useSftpFileChangeEvents({ id, setModal }: UseSftpFileChangeEventsProps) {
    useEffect(() => {
        let active = true;

        const unsubFileChanged = ipcRenderer?.onSFTPFileChanged?.(id, (data: unknown) => {
            if (!active) return;
            const payload = data as { localPath: string; remotePath: string; filename: string };
            const update: PendingFileUpdate = {
                localPath: payload.localPath,
                remotePath: payload.remotePath,
                filename: payload.filename,
                selected: true
            };
            setModal(previousModal => {
                if (previousModal?.type === 'fileUpdate') {
                    const currentUpdates = previousModal.fileUpdates || [];
                    const existingUpdateIndex = currentUpdates.findIndex(currentUpdate => currentUpdate.localPath === update.localPath);
                    if (existingUpdateIndex >= 0) {
                        const nextUpdates = currentUpdates.map((currentUpdate, index) => {
                            if (index === existingUpdateIndex) {
                                return { ...update, selected: currentUpdate.selected };
                            }
                            return currentUpdate;
                        });
                        return { ...previousModal, fileUpdates: nextUpdates };
                    }
                    return { ...previousModal, fileUpdates: [...currentUpdates, update] };
                }
                return { type: 'fileUpdate', fileUpdates: [update] };
            });
        });

        return () => {
            active = false;
            if (typeof unsubFileChanged === 'function') unsubFileChanged();
        };
    }, [id, setModal]);
}
