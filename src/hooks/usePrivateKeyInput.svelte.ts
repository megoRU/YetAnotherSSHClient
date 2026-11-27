import { createI18n } from '../utils/i18n';

import { looksLikePrivateKey } from '../utils/privateKey';

import type { AppConfig } from '../types';

import { type SetStateAction } from '../utils/dom';

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

export const usePrivateKeyInput = (getAppConfig: () => AppConfig | undefined): UsePrivateKeyInputResult => {
    const { t } = $derived(createI18n(getAppConfig()?.language || 'ru'));
    let keyDraft = $state.raw('');
    function setKeyDraft(next: SetStateAction<typeof keyDraft>) {
        keyDraft = typeof next === 'function' ? next(keyDraft) : next;
    }
    let keyError = $state.raw<string | null>(null);
    function setKeyError(next: SetStateAction<string | null>) {
        keyError = typeof next === 'function' ? next(keyError) : next;
    }

    const loadFromFile = async () => {
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
    };

    const pasteFromClipboard = async () => {
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
    };

    const clearKeyDraft = () => {
        setKeyDraft('');
        setKeyError(null);
    };

    return {
        get keyDraft() {
            return keyDraft;
        },
        get hasDraft() {
            return keyDraft !== '';
        },
        get keyError() {
            return keyError;
        },
        setKeyError,
        get loadFromFile() {
            return loadFromFile;
        },
        get pasteFromClipboard() {
            return pasteFromClipboard;
        },
        clearKeyDraft,
    };
};
