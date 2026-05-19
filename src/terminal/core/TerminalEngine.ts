import type { TerminalOptions } from '../types';
import { ScreenBuffer } from './ScreenBuffer';
import { VTParser } from '../parser/VTParser';
import { WebGLRenderer } from '../renderer/WebGLRenderer';

export interface TerminalEngineCallbacks {
    onInput: (value: string) => void;
    onResize: (columns: number, rows: number) => void;
}

export class TerminalEngine {
    private readonly container: HTMLElement;
    private readonly canvas: HTMLCanvasElement;
    private options: TerminalOptions;
    private screenBuffer: ScreenBuffer;
    private parser: VTParser;
    private renderer: WebGLRenderer;
    private callbacks: TerminalEngineCallbacks;
    private animationFrameId: number | null;

    public constructor(container: HTMLElement, options: TerminalOptions, callbacks: TerminalEngineCallbacks) {
        this.container = container;
        this.canvas = document.createElement('canvas');
        this.options = options;
        this.callbacks = callbacks;
        this.screenBuffer = new ScreenBuffer(80, 24);
        this.parser = new VTParser(this.screenBuffer);
        this.renderer = new WebGLRenderer(this.canvas, this.screenBuffer, options);
        this.animationFrameId = null;

        this.container.innerHTML = '';
        this.container.appendChild(this.canvas);
        this.container.tabIndex = 0;
        this.container.addEventListener('keydown', this.handleKeyDown);
        this.container.addEventListener('paste', this.handlePaste);
    }

    public destroy(): void {
        this.container.removeEventListener('keydown', this.handleKeyDown);
        this.container.removeEventListener('paste', this.handlePaste);
    }

    public write(value: string): void {
        this.parser.write(value);
        this.scheduleRender();
    }

    public resize(width: number, height: number): { cols: number; rows: number } {
        const size = this.renderer.resize(width, height);
        this.screenBuffer.resize(size.cols, size.rows);
        this.callbacks.onResize(size.cols, size.rows);
        this.scheduleRender();
        return size;
    }

    public updateOptions(options: TerminalOptions): void {
        this.options = options;
        this.renderer.updateOptions(options);
        this.scheduleRender();
    }

    public focus(): void {
        this.container.focus();
    }

    private scheduleRender(): void {
        if (this.animationFrameId !== null) {
            return;
        }
        this.animationFrameId = requestAnimationFrame(() => {
            this.animationFrameId = null;
            this.renderer.render();
        });
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            this.callbacks.onInput(event.key);
            event.preventDefault();
            return;
        }
        if (event.key === 'Enter') {
            this.callbacks.onInput('\r');
            event.preventDefault();
            return;
        }
        if (event.key === 'Backspace') {
            this.callbacks.onInput('\u007f');
            event.preventDefault();
            return;
        }
    };

    private readonly handlePaste = (event: ClipboardEvent): void => {
        const data = event.clipboardData?.getData('text') ?? '';
        if (data.length > 0) {
            this.callbacks.onInput(data);
            event.preventDefault();
        }
    };
}
