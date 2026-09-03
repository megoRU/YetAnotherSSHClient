import { useEffect } from 'react';
import { isEditableInput, type ShortcutDefinition } from '../utils/shortcuts';

const isMac = typeof window !== 'undefined' &&
    (window.navigator?.platform?.toUpperCase().includes('MAC') ||
     window.navigator?.userAgent?.toUpperCase().includes('MAC'));

export interface UseGlobalShortcutsOptions {
    isAltScreen?: boolean;
}

export const useGlobalShortcuts = (shortcuts: ShortcutDefinition[], options?: UseGlobalShortcutsOptions) => {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target;
            const inInput = isEditableInput(target);
            const inAltScreen = Boolean(options?.isAltScreen);

            for (const shortcut of shortcuts) {
                if (shortcut.match(e, isMac)) {
                    // Do not intercept terminal-native Ctrl-combinations (e.g. Ctrl+W) when active terminal is in alternate screen
                    if (inAltScreen && shortcut.id === 'close-tab') {
                        continue;
                    }

                    // If focused in an editable text field, only proceed if explicitly allowed
                    if (inInput && !shortcut.allowInInput) {
                        continue;
                    }

                    e.preventDefault();
                    e.stopPropagation();
                    shortcut.handler(e);
                    break;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [shortcuts, options?.isAltScreen]);
};
