import type { PendingFileUpdate, SftpFileEntry } from '../../types';

import type { SftpFileChangedEvent } from '../../ipc/sftp';

import { untrack } from 'svelte';

import { type Dispatch, type SetStateAction } from '../../utils/dom';

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

export function useSftpFileChangeEvents(options: UseSftpFileChangeEventsProps) {
    $effect(() => {
        void [options.id, options.setModal];
        return untrack(() => {
            let active = true;

            const unsubFileChanged = ipcRenderer?.onSFTPFileChanged?.(options.id, (data: SftpFileChangedEvent) => {
                if (!active) return;
                const update: PendingFileUpdate = {
                    localPath: data.localPath,
                    remotePath: data.remotePath,
                    filename: data.filename,
                    selected: true,
                };
                options.setModal((previousModal) => {
                    if (previousModal?.type === 'fileUpdate') {
                        const currentUpdates = previousModal.fileUpdates || [];
                        const existingUpdateIndex = currentUpdates.findIndex(
                            (currentUpdate) => currentUpdate.localPath === update.localPath,
                        );
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
        });
    });
}
