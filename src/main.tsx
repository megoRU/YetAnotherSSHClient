import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initRendererLogger } from './utils/rendererLogger.ts'
import { loadLanguage, type Language } from './utils/translations.ts'

initRendererLogger()

/**
 * Язык для первого рендера берётся из query-параметра окна (его передаёт main-процесс
 * вместе с темой), а при его отсутствии — из последнего сохранённого значения.
 * Так словарь активного языка известен до первого рендера, и текст не мигает ключами.
 */
const resolveLanguage = (): Language => {
    const fromQuery = new URLSearchParams(window.location.search).get('lang')
    if (fromQuery === 'ru' || fromQuery === 'en') {
        return fromQuery
    }

    try {
        return localStorage.getItem('last-lang') === 'en' ? 'en' : 'ru'
    } catch {
        return 'ru'
    }
}

const boot = async (): Promise<void> => {
    // Словарь неактивных языков лежит в отдельных чанках и не попадает в критический
    // путь запуска, поэтому подгружаем нужный до рендера (см. utils/translations.ts).
    await loadLanguage(resolveLanguage())

    createRoot(document.getElementById('root')!).render(
        <App />,
    )
}

void boot()
