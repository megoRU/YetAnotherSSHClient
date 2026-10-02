import { useCallback, useEffect, useState } from 'react';
import type { SshFingerprintChallenge } from '../ipc';

const { ipcRenderer } = window;

export interface FingerprintPromptApi {
    /** Текущий отпечаток, ожидающий решения; `null`, если окно не нужно. */
    challenge: SshFingerprintChallenge | null;
    /** Пользователь подтвердил ключ: подключение продолжится. */
    accept: () => void;
    /** Пользователь отклонил ключ: подключение отменяется. */
    reject: () => void;
}

/**
 * Окно подтверждения отпечатка ключа хоста.
 *
 * Хук общий для SFTP и проброса портов: оба спрашивают ключ тем же способом, и
 * две отдельные подписки на событие разъезжались бы при правке. Ответ уходит в
 * `ssh_fingerprint_response`, а продолжением подключения занимается
 * main-процесс — UI ничего не переподключает сам.
 *
 * Окно снимается в момент нажатия, а не по факту соединения: вызывающий компонент
 * показывает это окно **вместо** своего интерфейса, и оставься оно висеть с
 * надписью «Соединение...» — выглядело бы как «ничего не произошло».
 *
 * Событие одно на всё приложение, а не канал на каждое подключение: Tauri
 * запрещает точки в имени события, а идентификаторы вида
 * `forward:138.16.186.79:81` их содержат. Свой `id` подписка отбирает в
 * payload.
 */
export function useFingerprintPrompt(id: string): FingerprintPromptApi {
    const [challenge, setChallenge] = useState<SshFingerprintChallenge | null>(null);

    useEffect(() => {
        if (typeof ipcRenderer === 'undefined') return;

        return ipcRenderer?.onSSHFingerprint?.((next) => {
            // Чужие подключения игнорируем: событие общее.
            if (next.id !== id) return;
            setChallenge(next);
        });
    }, [id]);

    const accept = useCallback(() => {
        if (!id || !challenge) return;
        setChallenge(null);
        ipcRenderer?.sshFingerprintResponse?.({ id, accept: true });
    }, [id, challenge]);

    const reject = useCallback(() => {
        if (!id || !challenge) return;
        setChallenge(null);
        ipcRenderer?.sshFingerprintResponse?.({ id, accept: false });
    }, [id, challenge]);

    return { challenge, accept, reject };
}
