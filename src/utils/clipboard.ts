import type { ClipboardSelectionType, IClipboardProvider } from '@xterm/addon-clipboard';

/**
 * Буфер обмена приложения.
 *
 * Всё общение с системным буфером идёт через нативный API
 * `tauri-plugin-clipboard-manager` (`read_clipboard_text` / `write_clipboard_text`).
 *
 * Почему не `navigator.clipboard`: WebView2 — это Chromium, и асинхронный
 * Clipboard API там требует разрешения. На `readText()` WebView2 показывает
 * системный запрос «Сайт http://tauri.localhost хочет Просматривать текст и
 * изображения, скопированные в буфер обмена», то есть каждое чтение буфера
 * спрашивает пользователя заново. Обойти это выдачей постоянного grant нельзя
 * без ослабления политики webview, поэтому чтение и запись перенесены в Rust.
 *
 * Нативный путь работает и в dev, и в production-сборке: он не зависит от
 * политик Chromium и не требует фокуса webview, как асинхронная запись.
 *
 * Fallback на `navigator.clipboard` остаётся только для браузерного превью
 * (`npm run dev:web`), где IPC-моста нет.
 */

/** Текст из системного буфера обмена. */
export const readClipboardText = async (): Promise<string> => {
    const bridge = window.ipcRenderer;
    if (bridge?.readClipboardText) {
        return bridge.readClipboardText();
    }
    return navigator.clipboard.readText();
};

/** Записывает текст в системный буфер обмена. */
export const writeClipboardText = async (text: string): Promise<void> => {
    const bridge = window.ipcRenderer;
    if (bridge?.writeClipboardText) {
        await bridge.writeClipboardText(text);
        return;
    }
    await navigator.clipboard.writeText(text);
};

/**
 * Копирование в буфер без показа «скопировано»: ошибка записи не должна
 * превращаться в необработанное отклонение промиса (терминал, выделение).
 */
export const copyToClipboard = (text: string): void => {
    if (!text) return;
    void writeClipboardText(text).catch((error: unknown) => {
        console.error('[Clipboard] Failed to write text:', error);
    });
};

/**
 * Провайдер буфера для `ClipboardAddon` xterm.js.
 *
 * Аддон обслуживает OSC 52 (`\x1b]52;c;…`) — запросы удалённых программ
 * вроде tmux и vim на чтение и запись буфера. Его штатный
 * `BrowserClipboardProvider` дёргает `navigator.clipboard.readText()`, то есть
 * именно он и вызывал запрос разрешения: приложение на удалённой машине
 * спрашивало «\x1b]52;c;?\x07», и WebView2 показывал диалог поверх терминала.
 *
 * Пробросить сюда IPC-провайдер — штатная точка расширения аддона, поэтому
 * Ctrl+C/Ctrl+V не трогаем: они идут через DOM-события `copy`/`paste`
 * textarea самого xterm и нативный Clipboard API не используют.
 *
 * PRIMARY (`p`) не поддерживается: системного доступа к primary-буферу X11 у
 * нативного API нет, поведение совпадает со штатным провайдером аддона.
 */
export const createTerminalClipboardProvider = (): IClipboardProvider => ({
    readText: (selection: ClipboardSelectionType) =>
        selection === 'c' ? readClipboardText() : Promise.resolve(''),
    writeText: (selection: ClipboardSelectionType, text: string) => {
        if (selection !== 'c') return Promise.resolve();
        return writeClipboardText(text).catch((error: unknown) => {
            console.error('[Clipboard] Failed to write OSC 52 text:', error);
        });
    }
});