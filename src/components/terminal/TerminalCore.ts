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

export class TerminalCore {
    public rows: number = 24;
    public cols: number = 80;

    // Main buffer and alternate buffer
    private mainBuffer: Cell[][] = [];
    private altBuffer: Cell[][] = [];
    public buffer: Cell[][] = [];

    public cursorX: number = 0;
    public cursorY: number = 0;
    private savedCursorMain = { x: 0, y: 0 };
    private savedCursorAlt = { x: 0, y: 0 };

    public scrollback: Cell[][] = [];
    public maxScrollback: number = 5000;

    private currentAttrs: CellAttrs;
    private theme: TerminalTheme;
    private decoder = new TextDecoder('utf-8', { ignoreBOM: true });
    private isAltBuffer = false;
    private showCursor = true;

    // Version/Change tracking
    public version = 0;

    constructor(cols: number, rows: number, theme: TerminalTheme) {
        this.cols = cols;
        this.rows = rows;
        this.theme = theme;
        this.currentAttrs = { fg: theme.foreground, bg: 'transparent' };
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

    public write(data: Uint8Array | string) {
        const text = typeof data === 'string' ? data : this.decoder.decode(data, { stream: true });
        let i = 0;

        while (i < text.length) {
            const char = text[i];

            if (char === '\x1b') { // ESC
                if (text[i + 1] === '[') { // CSI
                    let j = i + 2;
                    let sequence = '';
                    while (j < text.length && text[j] >= '\x30' && text[j] <= '\x3f') {
                        sequence += text[j];
                        j++;
                    }
                    if (j < text.length) {
                        const command = text[j];
                        this.handleCSI(sequence, command);
                        i = j + 1;
                        continue;
                    }
                } else if (text[i + 1] === '?') {
                     // Private mode handles or other ESC sequences
                }
            }

            if (char === '\n') {
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
            i++;
        }
        this.version++;
    }

    private isWide(char: string): boolean {
        const code = char.codePointAt(0);
        if (!code) return false;
        // Basic check for emojis and wide characters
        return (
            (code >= 0x1100 && (
                code <= 0x115f || // Hangul Jamo
                code === 0x2329 || code === 0x232a ||
                (0x2e80 <= code && code <= 0xa4cf && code !== 0x303f) || // CJK ... Yi
                (0xac00 <= code && code <= 0xd7a3) || // Hangul Syllables
                (0xf900 <= code && code <= 0xfaff) || // CJK Compatibility Ideographs
                (0xfe10 <= code && code <= 0xfe19) || // Vertical forms
                (0xfe30 <= code && code <= 0xfe6f) || // CJK Compatibility Forms
                (0xff00 <= code && code <= 0xff60) || // Fullwidth Forms
                (0xffe0 <= code && code <= 0xffe6) ||
                (0x20000 <= code && code <= 0x2fffd) ||
                (0x30000 <= code && code <= 0x3fffd)
            )) ||
            (code >= 0x1F300 && code <= 0x1F9FF) // Emojis
        );
    }

    private putChar(char: string) {
        const width = this.isWide(char) ? 2 : 1;

        if (this.cursorX + width > this.cols) {
            this.newLine();
        }

        if (this.cursorY >= this.rows) {
            this.cursorY = this.rows - 1;
        }

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
    }

    private newLine() {
        this.cursorX = 0;
        this.cursorY++;
        if (this.cursorY >= this.rows) {
            if (!this.isAltBuffer) {
                // Circular buffer logic alternative:
                const shiftedRow = this.mainBuffer.shift();
                if (shiftedRow) {
                    this.scrollback.push(shiftedRow);
                    if (this.scrollback.length > this.maxScrollback) {
                        this.scrollback.shift();
                    }
                }
                this.mainBuffer.push(this.createEmptyRow());
            }
            this.cursorY = this.rows - 1;
        }
    }

    private createEmptyRow(): Cell[] {
        return Array.from({ length: this.cols }, () => ({ char: ' ', attrs: { ...this.currentAttrs }, width: 1 }));
    }

    private handleCSI(params: string, command: string) {
        const parts = params.replace('?', '').split(';').map(p => parseInt(p) || 0);
        const isPrivate = params.startsWith('?');

        switch (command) {
            case 'm': // SGR
                this.handleSGR(parts);
                break;
            case 'H': // Cursor Position
            case 'f':
                this.cursorY = Math.min(this.rows - 1, Math.max(0, (parts[0] || 1) - 1));
                this.cursorX = Math.min(this.cols - 1, Math.max(0, (parts[1] || 1) - 1));
                break;
            case 'J': // Erase in Display
                this.eraseInDisplay(parts[0] || 0);
                break;
            case 'K': // Erase in Line
                this.eraseInLine(parts[0] || 0);
                break;
            case 'h': // DECSET
                if (isPrivate) this.handlePrivateMode(parts[0], true);
                break;
            case 'l': // DECRST
                if (isPrivate) this.handlePrivateMode(parts[0], false);
                break;
            case 'n': // Device Status Report
                if (parts[0] === 6) this.reportCursorPosition();
                break;
        }
    }

    private reportCursorPosition() {
        const report = `\x1b[${this.cursorY + 1};${this.cursorX + 1}R`;
        if (this.onInputCallback) this.onInputCallback(report);
    }

    private onInputCallback: ((data: string) => void) | null = null;

    public setInputCallback(cb: (data: string) => void) {
        this.onInputCallback = cb;
    }

    private handlePrivateMode(mode: number, value: boolean) {
        switch (mode) {
            case 1049: // Alternate Buffer
            case 47:
            case 1047:
                this.switchBuffer(value);
                break;
            case 25: // Cursor show/hide
                this.showCursor = value;
                break;
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
            this.currentAttrs = { fg: this.theme.foreground, bg: 'transparent' };
            return;
        }

        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (p === 0) {
                this.currentAttrs = { fg: this.theme.foreground, bg: 'transparent', bold: false, italic: false, underline: false };
            } else if (p === 1) {
                this.currentAttrs.bold = true;
            } else if (p === 3) {
                this.currentAttrs.italic = true;
            } else if (p === 4) {
                this.currentAttrs.underline = true;
            } else if (p === 22) {
                this.currentAttrs.bold = false;
            } else if (p >= 30 && p <= 37) {
                this.currentAttrs.fg = this.getThemeColor(p - 30);
            } else if (p === 39) {
                this.currentAttrs.fg = this.theme.foreground;
            } else if (p >= 40 && p <= 47) {
                this.currentAttrs.bg = this.getThemeColor(p - 40);
            } else if (p === 49) {
                this.currentAttrs.bg = 'transparent';
            } else if (p >= 90 && p <= 97) {
                this.currentAttrs.fg = this.getThemeColor(p - 90, true);
            } else if (p >= 100 && p <= 107) {
                this.currentAttrs.bg = this.getThemeColor(p - 100, true);
            } else if (p === 38 || p === 48) {
                // 256 colors or TrueColor
                if (parts[i+1] === 5) { // 256 colors
                    const colorIndex = parts[i+2];
                    if (p === 38) this.currentAttrs.fg = this.get256Color(colorIndex);
                    else this.currentAttrs.bg = this.get256Color(colorIndex);
                    i += 2;
                } else if (parts[i+1] === 2) { // TrueColor
                    const r = parts[i+2];
                    const g = parts[i+3];
                    const b = parts[i+4];
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
        if (mode === 0) { // Cursor to end
            this.eraseInLine(0);
            for (let y = this.cursorY + 1; y < this.rows; y++) {
                this.buffer[y] = this.createEmptyRow();
            }
        } else if (mode === 1) { // Start to cursor
            this.eraseInLine(1);
            for (let y = 0; y < this.cursorY; y++) {
                this.buffer[y] = this.createEmptyRow();
            }
        } else if (mode === 2 || mode === 3) { // Entire display
            for (let y = 0; y < this.rows; y++) {
                this.buffer[y] = this.createEmptyRow();
            }
            this.cursorX = 0;
            this.cursorY = 0;
        }
    }

    private eraseInLine(mode: number) {
        if (mode === 0) { // Cursor to end
            for (let x = this.cursorX; x < this.cols; x++) {
                this.buffer[this.cursorY][x] = { char: ' ', attrs: { ...this.currentAttrs }, width: 1 };
            }
        } else if (mode === 1) { // Start to cursor
            for (let x = 0; x <= Math.min(this.cursorX, this.cols - 1); x++) {
                this.buffer[this.cursorY][x] = { char: ' ', attrs: { ...this.currentAttrs }, width: 1 };
            }
        } else if (mode === 2) { // Entire line
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
        this.isAltBuffer = false;
        this.version++;
    }

    public getShowCursor() { return this.showCursor; }
}
