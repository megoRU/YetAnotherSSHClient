import type { SshFingerprintChallenge } from '../ipc';

import { untrack } from 'svelte';

import { type SetStateAction } from '../utils/dom';

const { ipcRenderer } = window;

export interface FingerprintPromptApi {
    /** Текущий отпечаток, ожидающий решения; `null`, если окно не нужно. */
    challenge: SshFingerprintChallenge | null;
    /** Пользователь подтвердил ключ: подключение продолжится. */
    accept: () => void;
    /** Пользователь отклонил ключ: подключение отменяется. */
    reject: () => void;
}

export function useFingerprintPrompt(getId: () => string): FingerprintPromptApi {
    let challenge = $state.raw<SshFingerprintChallenge | null>(null);
    function setChallenge(next: SetStateAction<SshFingerprintChallenge | null>) {
        challenge = typeof next === 'function' ? next(challenge) : next;
    }

    $effect(() => {
        void [getId()];
        return untrack(() => {
            if (typeof ipcRenderer === 'undefined') return;

            return ipcRenderer?.onSSHFingerprint?.((next) => {
                // Чужие подключения игнорируем: событие общее.
                if (next.id !== getId()) return;
                setChallenge(next);
            });
        });
    });

    const accept = () => {
        if (!getId() || !challenge) return;
        setChallenge(null);
        ipcRenderer?.sshFingerprintResponse?.({ id: getId(), accept: true });
    };

    const reject = () => {
        if (!getId() || !challenge) return;
        setChallenge(null);
        ipcRenderer?.sshFingerprintResponse?.({ id: getId(), accept: false });
    };

    return {
        get challenge() {
            return challenge;
        },
        get accept() {
            return accept;
        },
        get reject() {
            return reject;
        },
    };
}
