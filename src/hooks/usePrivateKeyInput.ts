import { useCallback, useState } from 'react';
import { useI18n } from '../utils/i18n';
import { looksLikePrivateKey } from '../utils/privateKey';
import type { AppConfig } from '../types';

const { ipcRenderer } = window;

const stripIpcErrorPrefix = (message: string): string =>
    message.replace(/^Error (?:occurred in handler for|invoking remote method) '[^']+':\s*(?:Error:\s*)?/, '');

export interface UsePrivateKeyInputResult {
    /** Содержимое ключа, загруженного из файла или вставленного из буфера. */
    keyDraft: string;
    /** Ключ введён, но ещё не сохранён в конфиг. */
    hasDraft: boolean;
    /** Текст ошибки чтения/проверки ключа (null, если ошибок нет). */
    keyError: string | null;
    /** Ручная установка ошибки (например, ошибка шифрования ключа при отправке формы). */
    setKeyError: (message: string | null) => void;
    /** Загрузить ключ из выбранного файла. */
    loadFromFile: () => Promise<void>;
    /** Вставить ключ из буфера обмена. */
    pasteFromClipboard: () => Promise<void>;
    /** Сбросить введённый ключ и ошибку. */
    clearKeyDraft: () => void;
}

/**
 * Общий ввод приватного ключа (файл или буфер обмена) для формы подключения
 * и окна запроса авторизации: содержимое всегда проверяется looksLikePrivateKey,
 * ошибки чтения показываются локализованным текстом.
 */
export const usePrivateKeyInput = (appConfig?: AppConfig): UsePrivateKeyInputResult => {
    const { t } = useI18n(appConfig?.language || 'ru');
    const [keyDraft, setKeyDraft] = useState('');
    const [keyError, setKeyError] = useState<string | null>(null);

    const loadFromFile = useCallback(async () => {
        setKeyError(null);
        if (typeof ipcRenderer === 'undefined') {
            setKeyError(t('errors.ipcNotAvailable'));
            return;
        }
        try {
            const content = await ipcRenderer?.loadPrivateKeyFile?.();
            // Пользователь закрыл диалог выбора файла — это не ошибка
            if (content === null || content === undefined) return;
            if (!looksLikePrivateKey(content)) {
                setKeyError(t('errors.invalidPrivateKey'));
                return;
            }
            setKeyDraft(content);
        } catch (err) {
            const message = stripIpcErrorPrefix(err instanceof Error ? err.message : String(err));
            setKeyError(t('errors.readPrivateKeyFailed', { message }));
        }
    }, [t]);

    const pasteFromClipboard = useCallback(async () => {
        setKeyError(null);
        if (typeof ipcRenderer === 'undefined') {
            setKeyError(t('errors.ipcNotAvailable'));
            return;
        }
        try {
            const content = await ipcRenderer?.readClipboardText?.();
            if (!content || !content.trim()) {
                setKeyError(t('errors.clipboardEmpty'));
                return;
            }
            if (!looksLikePrivateKey(content)) {
                setKeyError(t('errors.invalidPrivateKey'));
                return;
            }
            setKeyDraft(content);
        } catch (err) {
            const message = stripIpcErrorPrefix(err instanceof Error ? err.message : String(err));
            setKeyError(t('errors.readPrivateKeyFailed', { message }));
        }
    }, [t]);

    const clearKeyDraft = useCallback(() => {
        setKeyDraft('');
        setKeyError(null);
    }, []);

    return {
        keyDraft,
        hasDraft: keyDraft !== '',
        keyError,
        setKeyError,
        loadFromFile,
        pasteFromClipboard,
        clearKeyDraft
    };
};
