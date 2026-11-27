import type { FitAddon } from '@xterm/addon-fit';

import type { Terminal } from '@xterm/xterm';

import { type RefObject } from '../utils/dom';

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

export const useTerminalFit = (options: UseTerminalFitOptions): TerminalFit => {
    const pendingFitRef: RefObject<ReturnType<typeof setTimeout> | null> = { current: null };

    const safeFit = (delay = 80) => {
        if (
            !options.isMountedRef.current ||
            !options.xtermRef.current ||
            !options.fitAddonRef.current ||
            !options.visible
        )
            return;
        if (!options.canResize()) return;
        if (pendingFitRef.current) {
            clearTimeout(pendingFitRef.current);
            pendingFitRef.current = null;
        }
        const doFit = () => {
            if (
                !options.isMountedRef.current ||
                !options.xtermRef.current ||
                !options.fitAddonRef.current ||
                !options.visible
            )
                return;
            if (!options.termRef.current || !options.canResize()) return;
            if (options.termRef.current.clientWidth === 0 || options.termRef.current.clientHeight === 0) return;
            try {
                options.fitAddonRef.current.fit();
                const { cols, rows } = options.xtermRef.current;
                if (cols <= 0 || rows <= 0) return;
                if (cols === options.lastColsRef.current && rows === options.lastRowsRef.current) return;
                options.lastColsRef.current = cols;
                options.lastRowsRef.current = rows;
                options.onResize(cols, rows);
            } catch (err) {
                console.warn(`${options.logPrefix} fit() failed:`, err);
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
    };

    const clearPendingFit = () => {
        if (pendingFitRef.current) {
            clearTimeout(pendingFitRef.current);
            pendingFitRef.current = null;
        }
    };

    return {
        get safeFit() {
            return safeFit;
        },
        clearPendingFit,
    };
};
