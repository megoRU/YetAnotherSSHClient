import { nativeTheme } from 'electron'

/**
 * Возвращает цвет фона окна в зависимости от выбранной темы.
 * Используется для предотвращения белой вспышки при загрузке и для titleBarOverlay.
 *
 * @param {string} theme - Название темы.
 * @returns {string} Hex-код цвета фона.
 */
export function getThemeColor(theme: string): string {
    let actualTheme = theme
    if (theme === 'Auto') {
        actualTheme = nativeTheme.shouldUseDarkColors ? 'Dark' : 'Light'
    }

    switch (actualTheme) {
        case 'Dark': return '#0F172A'
        case 'Gruvbox Light': return '#fbf1c7'
        case 'Gruvbox Dark': return '#282828'
        case 'Windows Terminal': return '#0C0C0C'
        default: return '#F8FAFC'
    }
}
