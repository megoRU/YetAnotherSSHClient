import type { Attachment } from 'svelte/attachments';
import { on } from 'svelte/events';
import type { Component } from 'svelte';
import type { IconProps } from '@lucide/svelte';

export interface RefObject<T> {
    current: T;
}

export type SetStateAction<T> = T | ((current: T) => T);
export type Dispatch<T> = (action: T) => void;
export type ElementEvent<E extends Event, T extends Element> = E & { currentTarget: T };
export type ValueEvent<T extends Element> = ElementEvent<Event, T>;
export type CSSProperties = Record<string, string | number | null | undefined>;

export interface MenuIcon {
    component: Component<IconProps, Record<never, never>, ''>;
    size: number;
}

const unitless = new Set([
    'aspectRatio',
    'flex',
    'flexGrow',
    'flexShrink',
    'fontWeight',
    'gridArea',
    'gridColumn',
    'gridRow',
    'lineHeight',
    'opacity',
    'order',
    'scale',
    'strokeWidth',
    'zIndex',
]);

export function inlineStyle(properties: CSSProperties | null | undefined): string {
    if (!properties) return '';
    return Object.entries(properties)
        .flatMap(([property, value]) => {
            if (value == null || value === '') return [];
            const custom = property.startsWith('--');
            const name = custom ? property : property.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
            const unit =
                typeof value === 'number' && value !== 0 && !custom && !unitless.has(property) ? 'px' : '';
            return [name + ':' + value + unit];
        })
        .join(';');
}

export function focusOnMount(element: HTMLElement) {
    element.focus();
}

export function refAction<T extends HTMLElement>(element: T, setRef: (element: T | null) => void) {
    setRef(element);
    return { destroy: () => setRef(null) };
}

export function portalToBody(element: HTMLElement) {
    document.body.append(element);
    return { destroy: () => element.remove() };
}

export function onImageError(handleError: () => void): Attachment<HTMLImageElement> {
    return (image) => on(image, 'error', handleError);
}

export function activateOnKeydown(event: KeyboardEvent, activate: () => void) {
    if (event.target !== event.currentTarget || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) {
        return;
    }

    event.preventDefault();
    activate();
}
