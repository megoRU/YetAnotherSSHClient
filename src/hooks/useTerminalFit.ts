import { useCallback, useRef, type RefObject } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

interface UseTerminalFitOptions {
    /** Вкладка видима: в скрытой вкладке размеры не измеряются. */
    visible: boolean;
    isMountedRef: RefObject<boolean>;
    xtermRef: RefObject<Terminal | null>;
    fitAddonRef: RefObject<FitAddon | null>;
    termRef: RefObject<HTMLDivElement | null>;
    lastColsRef: RefObject<number>;
    lastRowsRef: RefObject<number>;
    /** Можно ли сейчас отправлять размеры (соединение/сессия активны). */
    canResize: () => boolean;
    /** Отправка новых размеров в main. */
    onResize: (cols: number, rows: number) => void;
    /** Префикс для сообщений в консоль. */
    logPrefix: string;
}

export interface TerminalFit {
    /** Пересчитать размеры; delay > 0 откладывает вызов. */
    safeFit: (delay?: number) => void;
    /** Сбросить отложенный пересчёт (при размонтировании). */
    clearPendingFit: () => void;
}

/**
 * Общий пересчёт размеров терминала для SSH- и локального терминала:
 * fit() + отправка колонок/строк в main только при реальном изменении.
 */
export const useTerminalFit = (options: UseTerminalFitOptions): TerminalFit => {
    const {
        visible,
        isMountedRef,
        xtermRef,
        fitAddonRef,
        termRef,
        lastColsRef,
        lastRowsRef,
        canResize,
        onResize,
        logPrefix
    } = options;
    const pendingFitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const safeFit = useCallback((delay = 80) => {
        if (!isMountedRef.current || !xtermRef.current || !fitAddonRef.current || !visible) return;
        if (!canResize()) return;
        if (pendingFitRef.current) {
            clearTimeout(pendingFitRef.current);
            pendingFitRef.current = null;
        }
        const doFit = () => {
            if (!isMountedRef.current || !xtermRef.current || !fitAddonRef.current || !visible) return;
            if (!termRef.current || !canResize()) return;
            if (termRef.current.clientWidth === 0 || termRef.current.clientHeight === 0) return;
            try {
                fitAddonRef.current.fit();
                const { cols, rows } = xtermRef.current;
                if (cols <= 0 || rows <= 0) return;
                if (cols === lastColsRef.current && rows === lastRowsRef.current) return;
                lastColsRef.current = cols;
                lastRowsRef.current = rows;
                onResize(cols, rows);
            } catch (err) {
                console.warn(`${logPrefix} fit() failed:`, err);
            }
        };

        if (delay === 0) {
            doFit();
            return;
        }
        pendingFitRef.current = setTimeout(() => {
            pendingFitRef.current = null;
            doFit();
        }, delay);
    }, [isMountedRef, xtermRef, fitAddonRef, termRef, lastColsRef, lastRowsRef, canResize, onResize, visible, logPrefix]);

    const clearPendingFit = useCallback(() => {
        if (pendingFitRef.current) {
            clearTimeout(pendingFitRef.current);
            pendingFitRef.current = null;
        }
    }, []);

    return { safeFit, clearPendingFit };
};
