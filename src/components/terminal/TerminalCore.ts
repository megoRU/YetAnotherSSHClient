export interface CellAttrs {
    fg: string | number;
    bg: string | number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
}

export interface Cell {
    char: string;
    attrs: CellAttrs;
    width: number;
}

export interface TerminalTheme {
    background: string;
    foreground: string;
    cursor: string;
    selectionBackground: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
}

enum ParserState {
    Normal,
    Esc,
    Csi,
    Osc
}

export class TerminalCore {
    public rows: number = 24;
    public cols: number = 80;

    private mainBuffer: Cell[][] = [];
    private altBuffer: Cell[][] = [];
    public buffer: Cell[][] = [];

    public cursorX: number = 0;
    public cursorY: number = 0;
    private savedCursorMain = { x: 0, y: 0 };
    private savedCursorAlt = { x: 0, y: 0 };

    public scrollback: Cell[][] = [];
    public maxScrollback: number = 5000;
    public scrollOffset: number = 0;

    private scrollTop: number = 0;
    private scrollBottom: number = 23;

    private currentAttrs: CellAttrs;
    private theme: TerminalTheme;
    private decoder = new TextDecoder('utf-8', { ignoreBOM: true });
    private isAltBuffer = false;
    private showCursor = true;

    private state: ParserState = ParserState.Normal;
    private params: string = '';
    private intermediate: string = '';

    public version = 0;
    private onInputCallback: ((data: string) => void) | null = null;

    constructor(cols: number, rows: number, theme: TerminalTheme) {
        this.cols = cols;
        this.rows = rows;
        this.theme = theme;
        this.currentAttrs = { fg: theme.foreground, bg: 'transparent' };
        this.scrollBottom = rows - 1;
        this.mainBuffer = this.createEmptyBuffer();
        this.altBuffer = this.createEmptyBuffer();
        this.buffer = this.mainBuffer;
    }

    private createEmptyBuffer(): Cell[][] {
        return Array.from({ length: this.rows }, () =>
            Array.from({ length: this.cols }, () => ({ char: ' ', attrs: { ...this.currentAttrs }, width: 1 }))
        );
    }

    public updateTheme(theme: TerminalTheme) {
        this.theme = theme;
        this.version++;
    }

    public setInputCallback(cb: (data: string) => void) {
        this.onInputCallback = cb;
    }

    public write(data: Uint8Array | string) {
        const text = typeof data === 'string' ? data : this.decoder.decode(data, { stream: true });

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            switch (this.state) {
                case ParserState.Normal:
                    if (char === '\x1b') {
                        this.state = ParserState.Esc;
                    } else if (char === '\n') {
                        this.newLine();
                    } else if (char === '\r') {
                        this.cursorX = 0;
                    } else if (char === '\b') {
                        this.cursorX = Math.max(0, this.cursorX - 1);
                    } else if (char === '\t') {
                        const spaces = 8 - (this.cursorX % 8);
                        for(let s = 0; s < spaces; s++) this.putChar(' ');
                    } else if (char.charCodeAt(0) >= 32) {
                        this.putChar(char);
                    }
                    break;

                case ParserState.Esc:
                    if (char === '[') {
                        this.state = ParserState.Csi;
                        this.params = '';
                        this.intermediate = '';
                    } else if (char === ']') {
                        this.state = ParserState.Osc;
                    } else if (char === '7') {
                        if (this.isAltBuffer) this.savedCursorAlt = { x: this.cursorX, y: this.cursorY };
                        else this.savedCursorMain = { x: this.cursorX, y: this.cursorY };
                        this.state = ParserState.Normal;
                    } else if (char === '8') {
                        const saved = this.isAltBuffer ? this.savedCursorAlt : this.savedCursorMain;
                        this.cursorX = saved.x;
                        this.cursorY = saved.y;
                        this.state = ParserState.Normal;
                    } else {
                        this.state = ParserState.Normal;
                    }
                    break;

                case ParserState.Csi:
                    if (char >= '0' && char <= '9' || char === ';' || char === '?' || char === ':') {
                        this.params += char;
                    } else if (char >= ' ' && char <= '/') {
                        this.intermediate += char;
                    } else {
                        this.handleCSI(this.params, char);
                        this.state = ParserState.Normal;
                    }
                    break;

                case ParserState.Osc:
                    if (char === '\x07' || (char === '\\' && text[i-1] === '\x1b')) {
                        this.state = ParserState.Normal;
                    }
                    break;
            }
        }
        this.version++;
    }

    private isWide(char: string): boolean {
        const code = char.codePointAt(0);
        if (!code) return false;
        return (
            (code >= 0x1100 && (
                code <= 0x115f ||
                code === 0x2329 || code === 0x232a ||
                (0x2e80 <= code && code <= 0xa4cf && code !== 0x303f) ||
                (0xac00 <= code && code <= 0xd7a3) ||
                (0xf900 <= code && code <= 0xfaff) ||
                (0xfe10 <= code && code <= 0xfe19) ||
                (0xfe30 <= code && code <= 0xfe6f) ||
                (0xff00 <= code && code <= 0xff60) ||
                (0xffe0 <= code && code <= 0xffe6) ||
                (0x20000 <= code && code <= 0x2fffd) ||
                (0x30000 <= code && code <= 0x3fffd)
            )) ||
            (code >= 0x1F300 && code <= 0x1F9FF)
        );
    }

    private putChar(char: string) {
        const width = this.isWide(char) ? 2 : 1;
        if (this.cursorX + width > this.cols) {
            this.newLine();
        }

        if (this.cursorY >= this.rows) this.cursorY = this.rows - 1;

        this.buffer[this.cursorY][this.cursorX] = {
            char,
            attrs: { ...this.currentAttrs },
            width
        };

        if (width === 2 && this.cursorX + 1 < this.cols) {
            this.buffer[this.cursorY][this.cursorX + 1] = {
                char: '',
                attrs: { ...this.currentAttrs },
                width: 0
            };
        }
        this.cursorX += width;
        this.scrollOffset = 0;
    }

    private newLine() {
        this.cursorX = 0;
        if (this.cursorY === this.scrollBottom) {
            this.scrollUp(1);
        } else if (this.cursorY < this.rows - 1) {
            this.cursorY++;
        }
    }

    private scrollUp(lines: number) {
        const regionHeight = this.scrollBottom - this.scrollTop + 1;
        lines = Math.min(lines, regionHeight);

        for (let i = 0; i < lines; i++) {
            if (!this.isAltBuffer && this.scrollTop === 0 && this.scrollBottom === this.rows - 1) {
                const shiftedRow = this.buffer.shift();
                if (shiftedRow) {
                    this.scrollback.push(shiftedRow);
                    if (this.scrollback.length > this.maxScrollback) this.scrollback.shift();
                }
                this.buffer.push(this.createEmptyRow());
            } else {
                this.buffer.splice(this.scrollTop, 1);
                this.buffer.splice(this.scrollBottom, 0, this.createEmptyRow());
            }
        }
    }

    private createEmptyRow(): Cell[] {
        return Array.from({ length: this.cols }, () => ({ char: ' ', attrs: { ...this.currentAttrs }, width: 1 }));
    }

    private handleCSI(params: string, command: string) {
        const parts = params.replace('?', '').split(';').map(p => parseInt(p) || 0);
        const isPrivate = params.startsWith('?');

        switch (command) {
            case 'm': this.handleSGR(parts); break;
            case 'H':
            case 'f':
                this.cursorY = Math.min(this.rows - 1, Math.max(0, (parts[0] || 1) - 1));
                this.cursorX = Math.min(this.cols - 1, Math.max(0, (parts[1] || 1) - 1));
                break;
            case 'A': this.cursorY = Math.max(0, this.cursorY - (parts[0] || 1)); break;
            case 'B': this.cursorY = Math.min(this.rows - 1, this.cursorY + (parts[0] || 1)); break;
            case 'C': this.cursorX = Math.min(this.cols - 1, this.cursorX + (parts[0] || 1)); break;
            case 'D': this.cursorX = Math.max(0, this.cursorX - (parts[0] || 1)); break;
            case 'J': this.eraseInDisplay(parts[0] || 0); break;
            case 'K': this.eraseInLine(parts[0] || 0); break;
            case 'h': if (isPrivate) this.handlePrivateMode(parts[0], true); break;
            case 'l': if (isPrivate) this.handlePrivateMode(parts[0], false); break;
            case 'n': if (parts[0] === 6) this.reportCursorPosition(); break;
            case 'r':
                this.scrollTop = Math.max(0, (parts[0] || 1) - 1);
                this.scrollBottom = Math.min(this.rows - 1, (parts[1] || this.rows) - 1);
                this.cursorX = 0;
                this.cursorY = 0;
                break;
        }
    }

    private reportCursorPosition() {
        const report = `\x1b[${this.cursorY + 1};${this.cursorX + 1}R`;
        if (this.onInputCallback) this.onInputCallback(report);
    }

    private handlePrivateMode(mode: number, value: boolean) {
        switch (mode) {
            case 1049:
            case 47:
            case 1047:
                this.switchBuffer(value);
                break;
            case 25: this.showCursor = value; break;
        }
    }

    private switchBuffer(toAlt: boolean) {
        if (this.isAltBuffer === toAlt) return;
        if (toAlt) {
            this.savedCursorMain = { x: this.cursorX, y: this.cursorY };
            this.buffer = this.altBuffer;
            this.cursorX = this.savedCursorAlt.x;
            this.cursorY = this.savedCursorAlt.y;
        } else {
            this.savedCursorAlt = { x: this.cursorX, y: this.cursorY };
            this.buffer = this.mainBuffer;
            this.cursorX = this.savedCursorMain.x;
            this.cursorY = this.savedCursorMain.y;
        }
        this.isAltBuffer = toAlt;
    }

    private handleSGR(parts: number[]) {
        if (parts.length === 0 || (parts.length === 1 && parts[0] === 0)) {
            this.currentAttrs = { fg: this.theme.foreground, bg: 'transparent', bold: false, italic: false, underline: false };
            return;
        }

        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (p === 0) {
                this.currentAttrs = { fg: this.theme.foreground, bg: 'transparent', bold: false, italic: false, underline: false };
            } else if (p === 1) this.currentAttrs.bold = true;
            else if (p === 3) this.currentAttrs.italic = true;
            else if (p === 4) this.currentAttrs.underline = true;
            else if (p === 22) this.currentAttrs.bold = false;
            else if (p >= 30 && p <= 37) this.currentAttrs.fg = this.getThemeColor(p - 30);
            else if (p === 39) this.currentAttrs.fg = this.theme.foreground;
            else if (p >= 40 && p <= 47) this.currentAttrs.bg = this.getThemeColor(p - 40);
            else if (p === 49) this.currentAttrs.bg = 'transparent';
            else if (p >= 90 && p <= 97) this.currentAttrs.fg = this.getThemeColor(p - 90, true);
            else if (p >= 100 && p <= 107) this.currentAttrs.bg = this.getThemeColor(p - 100, true);
            else if (p === 38 || p === 48) {
                if (parts[i+1] === 5) {
                    const colorIndex = parts[i+2];
                    if (p === 38) this.currentAttrs.fg = this.get256Color(colorIndex);
                    else this.currentAttrs.bg = this.get256Color(colorIndex);
                    i += 2;
                } else if (parts[i+1] === 2) {
                    const r = parts[i+2], g = parts[i+3], b = parts[i+4];
                    const color = `rgb(${r},${g},${b})`;
                    if (p === 38) this.currentAttrs.fg = color;
                    else this.currentAttrs.bg = color;
                    i += 4;
                }
            }
        }
    }

    private getThemeColor(index: number, bright: boolean = false): string {
        const colors = [
            bright ? this.theme.brightBlack : this.theme.black,
            bright ? this.theme.brightRed : this.theme.red,
            bright ? this.theme.brightGreen : this.theme.green,
            bright ? this.theme.brightYellow : this.theme.yellow,
            bright ? this.theme.brightBlue : this.theme.blue,
            bright ? this.theme.brightMagenta : this.theme.magenta,
            bright ? this.theme.brightCyan : this.theme.cyan,
            bright ? this.theme.brightWhite : this.theme.white,
        ];
        return colors[index] || this.theme.foreground;
    }

    private get256Color(index: number): string {
        if (index < 8) return this.getThemeColor(index);
        if (index < 16) return this.getThemeColor(index - 8, true);
        if (index < 232) {
            const r = Math.floor((index - 16) / 36) * 51;
            const g = Math.floor(((index - 16) % 36) / 6) * 51;
            const b = ((index - 16) % 6) * 51;
            return `rgb(${r},${g},${b})`;
        }
        const gray = (index - 232) * 10 + 8;
        return `rgb(${gray},${gray},${gray})`;
    }

    private eraseInDisplay(mode: number) {
        if (mode === 0) {
            this.eraseInLine(0);
            for (let y = this.cursorY + 1; y < this.rows; y++) {
                this.buffer[y] = this.createEmptyRow();
            }
        } else if (mode === 1) {
            this.eraseInLine(1);
            for (let y = 0; y < this.cursorY; y++) {
                this.buffer[y] = this.createEmptyRow();
            }
        } else if (mode === 2 || mode === 3) {
            for (let y = 0; y < this.rows; y++) {
                this.buffer[y] = this.createEmptyRow();
            }
            this.cursorX = 0;
            this.cursorY = 0;
        }
    }

    private eraseInLine(mode: number) {
        if (mode === 0) {
            for (let x = this.cursorX; x < this.cols; x++) this.buffer[this.cursorY][x] = { char: ' ', attrs: { ...this.currentAttrs }, width: 1 };
        } else if (mode === 1) {
            for (let x = 0; x <= Math.min(this.cursorX, this.cols - 1); x++) this.buffer[this.cursorY][x] = { char: ' ', attrs: { ...this.currentAttrs }, width: 1 };
        } else if (mode === 2) {
            this.buffer[this.cursorY] = this.createEmptyRow();
        }
    }

    public resize(cols: number, rows: number) {
        this.cols = cols;
        this.rows = rows;
        this.mainBuffer = this.resizeBuffer(this.mainBuffer, cols, rows);
        this.altBuffer = this.resizeBuffer(this.altBuffer, cols, rows);
        this.buffer = this.isAltBuffer ? this.altBuffer : this.mainBuffer;
        this.cursorX = Math.min(this.cursorX, cols - 1);
        this.cursorY = Math.min(this.cursorY, rows - 1);
        this.scrollBottom = rows - 1;
        this.version++;
    }

    private resizeBuffer(oldBuffer: Cell[][], cols: number, rows: number): Cell[][] {
        const newBuffer = Array.from({ length: rows }, () =>
            Array.from({ length: cols }, () => ({ char: ' ', attrs: { ...this.currentAttrs }, width: 1 }))
        );
        for (let y = 0; y < Math.min(oldBuffer.length, rows); y++) {
            for (let x = 0; x < Math.min(oldBuffer[y].length, cols); x++) {
                newBuffer[y][x] = oldBuffer[y][x];
            }
        }
        return newBuffer;
    }

    public clear() {
        this.mainBuffer = this.createEmptyBuffer();
        this.altBuffer = this.createEmptyBuffer();
        this.buffer = this.mainBuffer;
        this.cursorX = 0;
        this.cursorY = 0;
        this.scrollback = [];
        this.scrollOffset = 0;
        this.isAltBuffer = false;
        this.scrollTop = 0;
        this.scrollBottom = this.rows - 1;
        this.version++;
    }

    public getShowCursor() { return this.showCursor; }

    public scroll(delta: number) {
        if (this.isAltBuffer) return;
        this.scrollOffset = Math.max(0, Math.min(this.scrollback.length, this.scrollOffset + delta));
        this.version++;
    }

    public getSelectionText(selection: { startX: number, startY: number, endX: number, endY: number }): string {
        let text = '';
        const startLine = Math.min(selection.startY, selection.endY);
        const endLine = Math.max(selection.startY, selection.endY);

        for (let y = startLine; y <= endLine; y++) {
            let row: Cell[];
            if (y < this.scrollback.length) row = this.scrollback[y];
            else row = this.buffer[y - this.scrollback.length];

            if (!row) continue;

            let lineText = '';
            const isStartLine = y === startLine;
            const isEndLine = y === endLine;

            let startX = 0;
            let endX = this.cols - 1;

            if (isStartLine && isEndLine) {
                startX = Math.min(selection.startX, selection.endX);
                endX = Math.max(selection.startX, selection.endX);
            } else if (isStartLine) {
                startX = selection.startY < selection.endY ? selection.startX : selection.endX;
            } else if (isEndLine) {
                endX = selection.startY < selection.endY ? selection.endX : selection.startX;
            }

            for (let x = startX; x <= endX; x++) {
                const cell = row[x];
                if (cell && cell.char && cell.width > 0) lineText += cell.char;
            }
            text += lineText + (y < endLine ? '\n' : '');
        }
        return text;
    }
}
