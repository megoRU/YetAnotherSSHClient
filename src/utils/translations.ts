import { ru } from './translations.ru.js';

export type Language = 'ru' | 'en';

/**
 * Тип словаря: произвольная вложенная структура строк, разрешаемая по точечному пути.
 * Набор ключей проверяется на этапе обращения (см. `getTranslation`), а не типами,
 * поэтому расхождение между языками не ломает сборку.
 */
export type Translations = Record<string, unknown>;

/**
 * Реестр словарей, доступных renderer.
 *
 * Русский словарь подключён статически — это дефолт и одновременно запасной вариант,
 * если активный язык не удалось загрузить. Остальные языки добавляются динамически
 * через `loadLanguage()` до первого рендера (см. `src/main.tsx`), поэтому в критический
 * путь запуска попадает только один язык вместо всех.
 */
export const translations: Record<Language, Translations> = { ru, en: ru };

/**
 * Подключает словарь языка, если он ещё не загружен.
 *
 * Вызывается до `createRoot(...).render(...)`, поэтому к моменту первого рендера
 * активный язык уже доступен и текст не мигает ключами локализации.
 *
 * @param lang - язык из конфигурации (`AppConfig.language`).
 * @returns Promise, который всегда разрешается: недоступный словарь не должен
 *          блокировать запуск приложения, в этом случае остаётся русский.
 */
export const loadLanguage = async (lang: Language): Promise<void> => {
    if (lang === 'ru' || translations[lang] !== ru) {
        return;
    }

    try {
        const { en } = await import('./translations.en.js');
        translations.en = en as Translations;
    } catch (err) {
        console.error('[i18n] Failed to load "en" dictionary, falling back to "ru":', err);
    }
};
