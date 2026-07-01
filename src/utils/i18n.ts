import { useCallback } from 'react';
import { translations, type Language } from './translations';

export type { Language };
export { translations };

export const getTranslation = (lang: Language, path: string, params?: Record<string, string>): unknown => {
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

import { useMemo } from 'react';

export const useI18n = (lang: Language = 'ru') => {
    const t = useCallback((path: string, params?: Record<string, string>): string => {
        const result = getTranslation(lang, path, params);
        if (Array.isArray(result)) return result.join('\n');
        return String(result);
    }, [lang]);

    const tArray = useCallback((path: string, params?: Record<string, string>): string[] => {
        const result = getTranslation(lang, path, params);
        if (Array.isArray(result)) return result as string[];
        return [String(result)];
    }, [lang]);

    return useMemo(() => ({ t, tArray }), [t, tArray]);
};
