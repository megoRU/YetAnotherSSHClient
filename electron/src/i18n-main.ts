import { loadConfig } from './config.js';
import { translations, type Language } from '../../src/utils/translations.js';

export const getTranslationMain = (path: string, params?: Record<string, string>): string => {
    const config = loadConfig();
    const lang = (config.language || 'ru') as Language;

    const keys = path.split('.');
    let result: unknown = (translations as Record<string, unknown>)[lang];

    for (const key of keys) {
        if (result && typeof result === 'object' && (result as Record<string, unknown>)[key]) {
            result = (result as Record<string, unknown>)[key];
        } else {
            return path;
        }
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

export const t = getTranslationMain;
