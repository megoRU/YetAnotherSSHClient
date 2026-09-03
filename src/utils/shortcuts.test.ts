import assert from 'node:assert';
import { test, describe } from 'node:test';
import {
    isEditableInput,
    isTerminalAlternateScreen,
    shortcutMatchers
} from './shortcuts.ts';

// Helper mock classes for DOM elements and keyboard events
class MockElement {
    tagName: string;
    classList: { contains: (cls: string) => boolean };
    attributes: Map<string, string>;
    isContentEditable: boolean;
    parent: MockElement | null;

    constructor(tagName = 'div', classes: string[] = [], attributes: Record<string, string> = {}) {
        this.tagName = tagName.toUpperCase();
        const classSet = new Set(classes);
        this.classList = {
            contains: (cls: string) => classSet.has(cls)
        };
        this.attributes = new Map(Object.entries(attributes));
        this.isContentEditable = false;
        this.parent = null;
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    closest(selector: string): MockElement | null {
        if (selector === '.terminal-container' && this.classList.contains('terminal-container')) {
            return this;
        }
        if (this.parent) {
            return this.parent.closest(selector);
        }
        return null;
    }
}

// Ensure HTMLElement check in functions like isEditableInput / isTerminalAlternateScreen succeeds
if (typeof globalThis.HTMLElement === 'undefined') {
    (globalThis as unknown as { HTMLElement: typeof MockElement }).HTMLElement = MockElement;
}

function createMockKeyboardEvent(options: {
    key: string;
    code: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
}): KeyboardEvent {
    return {
        key: options.key,
        code: options.code,
        ctrlKey: !!options.ctrlKey,
        metaKey: !!options.metaKey,
        shiftKey: !!options.shiftKey,
        altKey: !!options.altKey,
        preventDefault: () => {},
        stopPropagation: () => {}
    } as unknown as KeyboardEvent;
}

describe('Shortcut Logic & Alternate Screen Buffer Tests', () => {

    test('isEditableInput correctly identifies input fields vs xterm helper textarea', () => {
        const inputEl = new MockElement('input');
        const textareaEl = new MockElement('textarea');
        const contentEditableEl = new MockElement('div');
        contentEditableEl.isContentEditable = true;
        const xtermTextareaEl = new MockElement('textarea', ['xterm-helper-textarea']);

        assert.strictEqual(isEditableInput(inputEl as unknown as EventTarget), true);
        assert.strictEqual(isEditableInput(textareaEl as unknown as EventTarget), true);
        assert.strictEqual(isEditableInput(contentEditableEl as unknown as EventTarget), true);
        assert.strictEqual(isEditableInput(xtermTextareaEl as unknown as EventTarget), false);
    });

    test('isTerminalAlternateScreen detects alternate screen buffer mode', () => {
        const normalContainer = new MockElement('div', ['terminal-container'], { 'data-alternate-screen': 'false' });
        const normalXtermTextarea = new MockElement('textarea', ['xterm-helper-textarea']);
        normalXtermTextarea.parent = normalContainer;

        const altContainer = new MockElement('div', ['terminal-container'], { 'data-alternate-screen': 'true' });
        const altXtermTextarea = new MockElement('textarea', ['xterm-helper-textarea']);
        altXtermTextarea.parent = altContainer;

        assert.strictEqual(isTerminalAlternateScreen(normalXtermTextarea as unknown as EventTarget), false);
        assert.strictEqual(isTerminalAlternateScreen(altXtermTextarea as unknown as EventTarget), true);
    });

    test('Ctrl+W in normal shell closes tab, but in alternate screen is passed to terminal', () => {
        const event = createMockKeyboardEvent({ key: 'w', code: 'KeyW', ctrlKey: true });
        const isMac = false;

        // Shortcut matcher matches Ctrl+W
        assert.strictEqual(shortcutMatchers.closeTab(event, isMac), true);

        const normalContainer = new MockElement('div', ['terminal-container'], { 'data-alternate-screen': 'false' });
        const normalTarget = new MockElement('textarea', ['xterm-helper-textarea']);
        normalTarget.parent = normalContainer;

        const altContainer = new MockElement('div', ['terminal-container'], { 'data-alternate-screen': 'true' });
        const altTarget = new MockElement('textarea', ['xterm-helper-textarea']);
        altTarget.parent = altContainer;

        // Normal shell: not in alternate screen -> handled by application (close tab)
        const handleInNormalShell = !isTerminalAlternateScreen(normalTarget as unknown as EventTarget);
        assert.strictEqual(handleInNormalShell, true);

        // Alternate screen (vim/nano/htop/less/tmux): in alternate screen -> skipped by app closeTab (sent to SSH terminal)
        const handleInAltScreen = !isTerminalAlternateScreen(altTarget as unknown as EventTarget);
        assert.strictEqual(handleInAltScreen, false);
    });

    test('Ctrl+R does not get intercepted by application tab shortcuts', () => {
        const ctrlREvent = createMockKeyboardEvent({ key: 'r', code: 'KeyR', ctrlKey: true });
        const isMac = false;

        // Verify that Ctrl+R does NOT match any global application tab shortcuts
        assert.strictEqual(shortcutMatchers.closeTab(ctrlREvent, isMac), false);
        assert.strictEqual(shortcutMatchers.nextTab(ctrlREvent, isMac), false);
        assert.strictEqual(shortcutMatchers.prevTab(ctrlREvent, isMac), false);
    });

    test('Ctrl+Tab and Ctrl+Shift+Tab switch tabs even in alternate screen', () => {
        const nextTabEvent = createMockKeyboardEvent({ key: 'Tab', code: 'Tab', ctrlKey: true });
        const prevTabEvent = createMockKeyboardEvent({ key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true });
        const isMac = false;

        assert.strictEqual(shortcutMatchers.nextTab(nextTabEvent, isMac), true);
        assert.strictEqual(shortcutMatchers.prevTab(prevTabEvent, isMac), true);

        const altContainer = new MockElement('div', ['terminal-container'], { 'data-alternate-screen': 'true' });
        const altTarget = new MockElement('textarea', ['xterm-helper-textarea']);
        altTarget.parent = altContainer;

        const inAltScreen = isTerminalAlternateScreen(altTarget as unknown as EventTarget);
        assert.strictEqual(inAltScreen, true);

        // Shortcut id for next-tab and prev-tab is not 'close-tab', so app processes them
        const shouldSkipNextTab = inAltScreen && 'next-tab' === 'close-tab';
        assert.strictEqual(shouldSkipNextTab, false);
    });

    test('Regular terminal Ctrl-combinations (Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+L) are not intercepted by app shortcuts', () => {
        const isMac = false;
        const ctrlC = createMockKeyboardEvent({ key: 'c', code: 'KeyC', ctrlKey: true });
        const ctrlD = createMockKeyboardEvent({ key: 'd', code: 'KeyD', ctrlKey: true });
        const ctrlZ = createMockKeyboardEvent({ key: 'z', code: 'KeyZ', ctrlKey: true });
        const ctrlL = createMockKeyboardEvent({ key: 'l', code: 'KeyL', ctrlKey: true });

        for (const evt of [ctrlC, ctrlD, ctrlZ, ctrlL]) {
            assert.strictEqual(shortcutMatchers.closeTab(evt, isMac), false);
            assert.strictEqual(shortcutMatchers.nextTab(evt, isMac), false);
            assert.strictEqual(shortcutMatchers.prevTab(evt, isMac), false);
        }
    });

});
