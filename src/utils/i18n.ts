import { useCallback } from 'react';
import { translations, type Language } from './translations';

export type { Language };

const getTranslation = (lang: Language, path: string, params?: Record<string, string>): unknown => {
    const keys = path.split('.');
    let result: unknown = (translations as Record<string, unknown>)[lang];

    for (const key of keys) {
        if (result && typeof result === 'object' && (result as Record<string, unknown>)[key] !== undefined) {
            result = (result as Record<string, unknown>)[key];
        } else {
            return path;
        }
    }

    if (Array.isArray(result)) {
        return result;
    }

    if (typeof result === 'string') {
        let translated = result;
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                translated = translated.replace(`{${key}}`, value);
            });
        }
        return translated;
    }

    return path;
};

interface BackendMessage {
    key: string;
    params?: Record<string, string>;
}

function parseBackendMessage(payload: string): BackendMessage | null {
    let value: unknown;
    try {
        value = JSON.parse(payload) as unknown;
    } catch {
        return null;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.key !== 'string') return null;
    const params: Record<string, string> = {};
    if (typeof record.params === 'object' && record.params !== null && !Array.isArray(record.params)) {
        for (const [key, param] of Object.entries(record.params)) {
            if (typeof param === 'string') params[key] = param;
        }
    }
    return { key: record.key, params };
}

const BACKEND_MESSAGE_START = '\u001eYASSH_I18N:';
const BACKEND_MESSAGE_END = '\u001f';

/** Переводит маркеры локализации, возвращённые Rust, через UI-словарь. */
export function translateBackendText(text: string, lang: Language): string {
    let cursor = 0;
    let result = '';
    while (cursor < text.length) {
        const start = text.indexOf(BACKEND_MESSAGE_START, cursor);
        if (start < 0) return result + text.slice(cursor);
        result += text.slice(cursor, start);
        const payloadStart = start + BACKEND_MESSAGE_START.length;
        const end = text.indexOf(BACKEND_MESSAGE_END, payloadStart);
        if (end < 0) return result + text.slice(start);
        const markerEnd = end + BACKEND_MESSAGE_END.length;
        const message = parseBackendMessage(text.slice(payloadStart, end));
        if (!message) {
            result += text.slice(start, markerEnd);
        } else {
            const translated = getTranslation(lang, message.key, message.params);
            result += typeof translated === 'string' ? translated : message.key;
        }
        cursor = markerEnd;
    }
    return result;
}

/** Обрабатывает строки локализации в ответах и событиях IPC. */
export function translateBackendPayload<T>(payload: T, lang: Language): T {
    if (typeof payload === 'string') return translateBackendText(payload, lang) as T;
    if (Array.isArray(payload)) {
        return payload.map(item => translateBackendPayload(item, lang)) as T;
    }
    if (typeof payload === 'object' && payload !== null) {
        const translated = Object.fromEntries(
            Object.entries(payload).map(([key, value]) => [key, translateBackendPayload(value, lang)])
        );
        return translated as T;
    }
    return payload;
}

import { useMemo } from 'react';

export const useI18n = (lang: Language = 'ru') => {
    const t = useCallback((path: string, params?: Record<string, string>): string => {
        const result = getTranslation(lang, path, params);
        if (Array.isArray(result)) return result.join('\n');
        return String(result);
    }, [lang]);

    return useMemo(() => ({ t }), [t]);
};
