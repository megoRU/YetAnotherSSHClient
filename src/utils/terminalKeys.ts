import type { Terminal } from '@xterm/xterm';

interface CreateTerminalKeyHandlerOptions {
    /** Компонент ещё смонтирован: вставку из буфера выполняем только для живого терминала. */
    isMounted: () => boolean;
    /** Платформа macOS: там используется Meta вместо Ctrl. */
    isMac: boolean;
    /**
     * В альтернативном экране (vim, nvim, nano, htop, tmux) сочетания с Ctrl
     * передаются терминалу. Для SSH-терминала правило действует всегда,
     * в локальном терминале Ctrl+R блокируется и там.
     */
    passCtrlInAlternateScreen: boolean;
}

type XtermKeyEvent = Parameters<NonNullable<Parameters<Terminal['attachCustomKeyEventHandler']>[0]>>[0];

/**
 * Общий обработчик горячих клавиш терминала: навигация приложения (Ctrl+Tab, Ctrl+W),
 * блокировка Ctrl+R (иначе при русской раскладке вводится «к»), Copy/Paste через буфер.
 * Используется и SSH-, и локальным терминалом.
 */
export const createTerminalKeyHandler = (
    term: Terminal,
    options: CreateTerminalKeyHandlerOptions
): ((e: XtermKeyEvent) => boolean) => {
    const { isMounted, isMac, passCtrlInAlternateScreen } = options;

    return (e: XtermKeyEvent): boolean => {
        if (e.type !== 'keydown') return true;
        const ctrl = isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey;

        // Навигация приложения: Ctrl+Tab и Ctrl+Shift+Tab всегда обрабатываются приложением
        if (ctrl && !e.altKey && (e.code === 'Tab' || e.key === 'Tab')) {
            return false;
        }

        const isAlternate = term.buffer.active.type === 'alternate';

        // Ctrl+W (или Cmd+W на Mac) — закрытие вкладки, но в альтернативном экране отдаём терминалу
        const isCloseTabKey = ctrl && !e.shiftKey && !e.altKey && (e.code === 'KeyW' || e.key.toLowerCase() === 'w');
        if (isCloseTabKey) {
            return isAlternate;
        }

        // Ctrl+R блокируем: стандартная обработка xterm при русской раскладке вводит «к»
        const isCtrlR = (e.ctrlKey || (isMac && e.metaKey)) && !e.shiftKey && !e.altKey && e.code === 'KeyR';
        if (isCtrlR) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }

        const isCopy = (isMac && e.metaKey && e.code === 'KeyC') || (!isMac && e.ctrlKey && e.shiftKey && e.code === 'KeyC');
        const isPaste = (isMac && e.metaKey && e.code === 'KeyV') || (!isMac && e.ctrlKey && e.shiftKey && e.code === 'KeyV');

        if (isCopy) {
            e.preventDefault();
            e.stopPropagation();
            const selection = term.getSelection();
            if (selection) {
                void navigator.clipboard.writeText(selection);
            }
            return false;
        }

        if (isPaste) {
            e.preventDefault();
            e.stopPropagation();
            navigator.clipboard.readText().then(text => {
                if (text && isMounted()) {
                    term.paste(text);
                }
            });
            return false;
        }

        if (passCtrlInAlternateScreen && isAlternate) {
            return true;
        }
        return true;
    };
};
