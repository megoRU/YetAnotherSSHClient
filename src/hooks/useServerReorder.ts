import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { SSHConfig } from '../types';

/** Pointer events работают и при включённом нативном drag-and-drop файлов Tauri. */
export function useServerReorder(favorites: SSHConfig[], onReorder: (source: SSHConfig, target: SSHConfig) => void) {
    const containerRef = useRef<HTMLDivElement>(null);
    const favoritesRef = useRef(favorites);
    const onReorderRef = useRef(onReorder);
    const cleanupRef = useRef<(() => void) | null>(null);
    const suppressClickRef = useRef(false);

    useLayoutEffect(() => {
        favoritesRef.current = favorites;
        onReorderRef.current = onReorder;
    }, [favorites, onReorder]);

    useEffect(() => () => cleanupRef.current?.(), []);

    const startDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, source: SSHConfig) => {
        if (event.button !== 0 || !event.isPrimary || event.pointerType === 'touch') return;
        if (event.target instanceof Element && event.target.closest('button, a, input')) return;
        cleanupRef.current?.();

        const card = event.currentTarget;
        const scrollContainer = containerRef.current;
        if (!scrollContainer) return;
        const container = scrollContainer;
        const pointerId = event.pointerId;
        const startX = event.clientX;
        const startY = event.clientY;
        const startScrollTop = container.scrollTop;
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        const previousTransform = card.style.transform;
        const previousZIndex = card.style.zIndex;
        const previousPointerEvents = card.style.pointerEvents;
        let x = startX;
        let y = startY;
        let dragging = false;
        let frameId = 0;
        let targetCard: HTMLElement | null = null;
        let target: SSHConfig | undefined;

        const updateTarget = () => {
            const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-server-index]') ?? null;
            const nextCard = element && element !== card && container.contains(element) ? element : null;
            if (targetCard !== nextCard) {
                targetCard?.classList.remove('server-reorder-target');
                nextCard?.classList.add('server-reorder-target');
                targetCard = nextCard;
            }
            target = nextCard ? favoritesRef.current[Number(nextCard.dataset.serverIndex)] : undefined;
        };

        const renderDrag = () => {
            const bounds = container.getBoundingClientRect();
            if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
                const edge = Math.min(48, bounds.height / 4);
                if (y < bounds.top + edge) container.scrollTop = Math.max(0, container.scrollTop - Math.ceil((bounds.top + edge - y) / 4));
                else if (y > bounds.bottom - edge) container.scrollTop = Math.min(maxScrollTop, container.scrollTop + Math.ceil((y - bounds.bottom + edge) / 4));
            }
            card.style.transform = `translate(${x - startX}px, ${y - startY + container.scrollTop - startScrollTop}px)`;
            updateTarget();
            frameId = window.requestAnimationFrame(renderDrag);
        };

        const cleanup = () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            window.removeEventListener('pointercancel', handleCancel);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('blur', handleCancel);
            card.removeEventListener('lostpointercapture', handleCancel);
            if (card.hasPointerCapture(pointerId)) card.releasePointerCapture(pointerId);
            card.style.transform = previousTransform;
            card.style.zIndex = previousZIndex;
            card.style.pointerEvents = previousPointerEvents;
            card.classList.remove('server-reorder-dragging');
            container.classList.remove('server-reordering');
            targetCard?.classList.remove('server-reorder-target');
            cleanupRef.current = null;
        };

        function handleMove(move: PointerEvent) {
            if (move.pointerId !== pointerId) return;
            if (!card.isConnected) { cleanup(); return; }
            if ((move.buttons & 1) === 0) { cleanup(); return; }
            x = move.clientX;
            y = move.clientY;
            if (!dragging && Math.hypot(x - startX, y - startY) >= 6) {
                dragging = true;
                suppressClickRef.current = true;
                card.setPointerCapture(pointerId);
                card.classList.add('server-reorder-dragging');
                container.classList.add('server-reordering');
                card.style.zIndex = '10';
                card.style.pointerEvents = 'none';
                renderDrag();
            }
            if (dragging) move.preventDefault();
        }

        function handleUp(up: PointerEvent) {
            if (up.pointerId !== pointerId) return;
            if (dragging) {
                x = up.clientX;
                y = up.clientY;
                updateTarget();
            }
            const destination = dragging ? target : undefined;
            cleanup();
            if (destination) onReorderRef.current(source, destination);
        }

        function handleCancel(cancel: Event) {
            if (cancel instanceof PointerEvent && cancel.pointerId !== pointerId) return;
            cleanup();
        }

        function handleKeyDown(key: KeyboardEvent) {
            if (key.key === 'Escape') { key.preventDefault(); cleanup(); }
        }

        window.addEventListener('pointermove', handleMove, { passive: false });
        window.addEventListener('pointerup', handleUp);
        window.addEventListener('pointercancel', handleCancel);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('blur', handleCancel);
        card.addEventListener('lostpointercapture', handleCancel);
        cleanupRef.current = cleanup;
    }, []);

    const resetClickSuppression = useCallback(() => {
        if (!cleanupRef.current) suppressClickRef.current = false;
    }, []);
    const suppressDragClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
        if (suppressClickRef.current && event.detail !== 0) {
            event.preventDefault();
            event.stopPropagation();
            suppressClickRef.current = false;
        }
    }, []);

    return { containerRef, startDrag, resetClickSuppression, suppressDragClick };
}
