import type { TerminalOptions } from '../types';
import { ScreenBuffer } from '../core/ScreenBuffer';

export class WebGLRenderer {
    private readonly canvas: HTMLCanvasElement;
    private readonly context: CanvasRenderingContext2D;
    private readonly screenBuffer: ScreenBuffer;
    private options: TerminalOptions;
    private cellWidth: number;
    private cellHeight: number;
    private blinkVisible: boolean;

    public constructor(canvas: HTMLCanvasElement, screenBuffer: ScreenBuffer, options: TerminalOptions) {
        this.canvas = canvas;
        this.screenBuffer = screenBuffer;
        this.options = options;
        const context = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
        if (!context) {
            throw new Error('Canvas 2D context is not available');
        }
        this.context = context;
        this.cellWidth = 9;
        this.cellHeight = Math.floor(this.options.fontSize * this.options.lineHeight);
        this.blinkVisible = true;
        this.recalculateMetrics();
    }

    private recalculateMetrics(): void {
        this.context.font = `${this.options.fontSize}px ${this.options.fontFamily}`;
        const measure = this.context.measureText('W');
        this.cellWidth = Math.max(1, Math.ceil(measure.width + this.options.letterSpacing));
        this.cellHeight = Math.max(1, Math.ceil(this.options.fontSize * this.options.lineHeight));
    }

    public updateOptions(options: TerminalOptions): void {
        this.options = options;
        this.recalculateMetrics();
    }

    public resize(width: number, height: number): { cols: number; rows: number } {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.max(1, Math.floor(width * dpr));
        this.canvas.height = Math.max(1, Math.floor(height * dpr));
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
        const cols = Math.max(2, Math.floor(width / this.cellWidth));
        const rows = Math.max(2, Math.floor(height / this.cellHeight));
        return { cols, rows };
    }

    public render(): void {
        const damagedRows = this.screenBuffer.getDamagedRows();
        const shouldRenderCursorOnly = damagedRows.length === 0;
        this.context.fillStyle = this.options.theme.background;
        const devicePixelRatioValue: number = window.devicePixelRatio || 1;
        const logicalWidth: number = this.canvas.width / devicePixelRatioValue;
        const logicalHeight: number = this.canvas.height / devicePixelRatioValue;

        if (!shouldRenderCursorOnly) {
            this.context.fillRect(0, 0, logicalWidth, logicalHeight);
        }

        const rowsToRender: number[] = shouldRenderCursorOnly
            ? []
            : damagedRows;

        for (const row of rowsToRender) {
            const y = row * this.cellHeight;
            const line = this.screenBuffer.getLine(row);
            for (let column = 0; column < line.length; column += 1) {
                const cell = line[column];
                if (cell.grapheme === ' ') {
                    continue;
                }
                this.context.fillStyle = this.options.theme.foreground;
                this.context.font = `${this.options.fontSize}px ${this.options.fontFamily}`;
                this.context.fillText(cell.grapheme, column * this.cellWidth, y + this.options.fontSize);
            }
        }

        const cursor = this.screenBuffer.getCursor();
        if (this.blinkVisible) {
            this.context.fillStyle = this.options.theme.cursor;
            this.context.fillRect(cursor.x * this.cellWidth, cursor.y * this.cellHeight, this.cellWidth, this.cellHeight);
        }
    }

    public setCursorBlinkVisible(visible: boolean): void {
        this.blinkVisible = visible;
    }
}
