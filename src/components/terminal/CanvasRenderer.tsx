import React, { useRef, useEffect, useCallback, useState } from 'react';
import { TerminalCore, TerminalTheme, Cell } from './terminal/TerminalCore';

interface Props {
    core: TerminalCore;
    theme: TerminalTheme;
    fontFamily: string;
    fontSize: number;
    visible: boolean;
    onResize?: (cols: number, rows: number) => void;
    onSelectionChange?: (selection: { startX: number, startY: number, endX: number, endY: number } | null) => void;
}

export const CanvasRenderer: React.FC<Props> = ({
    core,
    theme,
    fontFamily,
    fontSize,
    visible,
    onResize,
    onSelectionChange
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const charSizeRef = useRef({ width: 0, height: 0 });
    const lastVersionRef = useRef(-1);

    const [selection, setSelection] = useState<{ startX: number, startY: number, endX: number, endY: number } | null>(null);
    const isSelectingRef = useRef(false);

    const measureChar = useCallback(() => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return { width: 0, height: 0 };
        ctx.font = `${fontSize}px ${fontFamily}`;
        const metrics = ctx.measureText('M');
        return { width: metrics.width, height: fontSize };
    }, [fontSize, fontFamily]);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { alpha: false });
        if (!ctx || !canvas || !visible) return;

        if (core.version === lastVersionRef.current && !isSelectingRef.current) return;
        lastVersionRef.current = core.version;

        const { width: charWidth, height: charHeight } = charSizeRef.current;
        if (charWidth === 0 || charHeight === 0) return;

        ctx.fillStyle = theme.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.textBaseline = 'top';

        const { buffer, scrollback, scrollOffset, rows, cols } = core;

        for (let y = 0; y < rows; y++) {
            let displayRow: Cell[] = [];
            const totalLines = scrollback.length + buffer.length;
            const startLine = Math.max(0, totalLines - rows - scrollOffset);

            if (startLine + y < scrollback.length) {
                displayRow = scrollback[startLine + y];
            } else {
                displayRow = buffer[startLine + y - scrollback.length];
            }

            if (!displayRow) continue;

            for (let x = 0; x < cols; x++) {
                const cell = displayRow[x];
                if (!cell || cell.width === 0) continue;

                const posX = x * charWidth;
                const posY = y * charHeight;

                let isSelected = false;
                if (selection) {
                    const currentLine = startLine + y;
                    const startLineIdx = Math.min(selection.startY, selection.endY);
                    const endLineIdx = Math.max(selection.startY, selection.endY);

                    if (currentLine > startLineIdx && currentLine < endLineIdx) {
                        isSelected = true;
                    } else if (currentLine === startLineIdx && currentLine === endLineIdx) {
                        const minX = Math.min(selection.startX, selection.endX);
                        const maxX = Math.max(selection.startX, selection.endX);
                        isSelected = x >= minX && x <= maxX;
                    } else if (currentLine === startLineIdx) {
                        const startX = selection.startY < selection.endY ? selection.startX : selection.endX;
                        isSelected = x >= startX;
                    } else if (currentLine === endLineIdx) {
                        const endX = selection.startY < selection.endY ? selection.endX : selection.startX;
                        isSelected = x <= endX;
                    }
                }

                if (isSelected) {
                    ctx.fillStyle = theme.selectionBackground;
                    ctx.fillRect(posX, posY, charWidth * cell.width, charHeight);
                } else if (cell.attrs.bg !== 'transparent') {
                    ctx.fillStyle = cell.attrs.bg as string;
                    ctx.fillRect(posX, posY, charWidth * cell.width, charHeight);
                }

                if (cell.char !== ' ' && cell.char !== '') {
                    ctx.fillStyle = isSelected ? theme.foreground : (cell.attrs.fg as string);
                    ctx.font = `${cell.attrs.bold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
                    ctx.fillText(cell.char, posX, posY);

                    if (cell.attrs.underline) {
                        ctx.strokeStyle = ctx.fillStyle;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(posX, posY + charHeight - 1);
                        ctx.lineTo(posX + charWidth * cell.width, posY + charHeight - 1);
                        ctx.stroke();
                    }
                }
            }
        }

        if (core.getShowCursor() && scrollOffset === 0) {
            ctx.fillStyle = theme.cursor;
            ctx.globalAlpha = 0.5;
            ctx.fillRect(core.cursorX * charWidth, core.cursorY * charHeight, charWidth, charHeight);
            ctx.globalAlpha = 1.0;
        }
    }, [core, theme, fontSize, fontFamily, visible, selection]);

    useEffect(() => {
        const size = measureChar();
        charSizeRef.current = size;

        const handleResize = () => {
            if (!containerRef.current || !canvasRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const cols = Math.floor(rect.width / size.width);
            const rows = Math.floor(rect.height / size.height);
            canvasRef.current.width = rect.width;
            canvasRef.current.height = rect.height;
            if (cols > 0 && rows > 0 && (cols !== core.cols || rows !== core.rows)) {
                core.resize(cols, rows);
                if (onResize) onResize(cols, rows);
            }
            lastVersionRef.current = -1;
            draw();
        };

        const observer = new ResizeObserver(handleResize);
        if (containerRef.current) observer.observe(containerRef.current);
        handleResize();
        return () => observer.disconnect();
    }, [core, measureChar, onResize, draw]);

    useEffect(() => {
        let frameId: number;
        const renderLoop = () => {
            draw();
            frameId = requestAnimationFrame(renderLoop);
        };
        frameId = requestAnimationFrame(renderLoop);
        return () => cancelAnimationFrame(frameId);
    }, [draw]);

    const getMousePos = (e: React.MouseEvent) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        const x = Math.floor((e.clientX - rect.left) / charSizeRef.current.width);
        const y = Math.floor((e.clientY - rect.top) / charSizeRef.current.height);
        const totalLines = core.scrollback.length + core.buffer.length;
        const currentLine = Math.max(0, totalLines - core.rows - core.scrollOffset) + y;
        return { x, y: currentLine };
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        const pos = getMousePos(e);
        const sel = { startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y };
        setSelection(sel);
        if (onSelectionChange) onSelectionChange(sel);
        isSelectingRef.current = true;
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isSelectingRef.current) return;
        const pos = getMousePos(e);
        setSelection(prev => {
            const next = prev ? { ...prev, endX: pos.x, endY: pos.y } : null;
            if (onSelectionChange) onSelectionChange(next);
            return next;
        });
    };

    const handleMouseUp = () => {
        isSelectingRef.current = false;
        // Selection stays until next click or manual clear
    };

    const handleWheel = useCallback((e: React.WheelEvent) => {
        const delta = Math.round(e.deltaY / 20);
        if (delta !== 0) core.scroll(delta);
    }, [core]);

    return (
        <div ref={containerRef}
             onWheel={handleWheel}
             onMouseDown={handleMouseDown}
             onMouseMove={handleMouseMove}
             onMouseUp={handleMouseUp}
             style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
            <canvas ref={canvasRef} style={{ display: 'block' }} />
        </div>
    );
};
