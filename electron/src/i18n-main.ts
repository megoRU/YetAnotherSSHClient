import { loadConfig } from './config.js';
import { ru } from '../../src/utils/translations.ru.js';
import { en } from '../../src/utils/translations.en.js';
import type { Language, Translations } from '../../src/utils/translations.js';

/**
 * Словари main-процесса.
 *
 * В отличие от renderer здесь оба языка подключаются статически: `t()` вызывается
 * синхронно из IPC-хендлеров, в том числе до того, как renderer успеет обратиться
 * к приложению. Динамическая загрузка словаря в этом месте означала бы гонку с
 * первым IPC-вызовом. На размер renderer-бандла это не влияет: main и renderer
 * собираются отдельными графами модулей.
 */
const mainTranslations: Record<Language, Translations> = { ru, en };

export const getTranslationMain = (path: string, params?: Record<string, string>): string => {
    const config = loadConfig();
    const lang = (config.language || 'ru') as Language;

    const keys = path.split('.');
    let result: unknown = mainTranslations[lang];

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
