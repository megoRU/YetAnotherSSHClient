export type ShortcutDefinition = {
    id: string;
    name?: string;
    description?: string;
    match: (e: KeyboardEvent, isMac: boolean) => boolean;
    handler: (e: KeyboardEvent) => void;
    allowInInput?: boolean;
};

/**
 * Checks whether the given target is a user-editable text input field
 * (e.g. <input>, <textarea>, <select>, contenteditable element, role="textbox").
 * Excludes xterm.js helper textarea so shortcuts work when terminal is focused.
 */
export function isEditableInput(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) {
        return false;
    }

    // xterm terminal input capture proxy element
    if (target.classList.contains('xterm-helper-textarea')) {
        return false;
    }

    const tagName = target.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        return true;
    }

    if (target.isContentEditable) {
        return true;
    }

    if (target.getAttribute('role') === 'textbox') {
        return true;
    }

    return false;
}

/**
 * Checks if target (or active element) is inside an xterm instance
 * that is currently in alternate screen mode (e.g. vim, nvim, nano, htop, less, tmux).
 */
export function isTerminalAlternateScreen(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) {
        return false;
    }

    const termContainer = target.closest('.terminal-container');
    if (termContainer) {
        return termContainer.getAttribute('data-alternate-screen') === 'true';
    }

    return false;
}

/**
 * Checks if Primary Modifier (Ctrl on Win/Linux, Ctrl or Cmd on Mac) is pressed.
 */
export function isCtrlOrCmd(e: KeyboardEvent, isMac: boolean): boolean {
    return isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey;
}

/**
 * Standard shortcut matchers
 */
export const shortcutMatchers = {
    // Ctrl+W or Cmd+W
    closeTab: (e: KeyboardEvent, isMac: boolean): boolean => {
        return isCtrlOrCmd(e, isMac) && !e.shiftKey && !e.altKey && (e.code === 'KeyW' || e.key.toLowerCase() === 'w');
    },

    // Ctrl+Tab or Cmd+Tab
    nextTab: (e: KeyboardEvent, isMac: boolean): boolean => {
        return isCtrlOrCmd(e, isMac) && !e.shiftKey && !e.altKey && (e.code === 'Tab' || e.key === 'Tab');
    },

    // Ctrl+Shift+Tab or Cmd+Shift+Tab
    prevTab: (e: KeyboardEvent, isMac: boolean): boolean => {
        return isCtrlOrCmd(e, isMac) && e.shiftKey && !e.altKey && (e.code === 'Tab' || e.key === 'Tab');
    }
};
