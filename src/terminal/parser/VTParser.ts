import { splitGraphemes, getCellWidth } from '../unicode/grapheme';
import { ScreenBuffer } from '../core/ScreenBuffer';

export class VTParser {
    private readonly screenBuffer: ScreenBuffer;
    private state: 'text' | 'escape' | 'csi' | 'osc';
    private csiBuffer: string;
    private oscBuffer: string;

    public constructor(screenBuffer: ScreenBuffer) {
        this.screenBuffer = screenBuffer;
        this.state = 'text';
        this.csiBuffer = '';
        this.oscBuffer = '';
    }

    public write(input: string): void {
        for (const char of input) {
            if (this.state === 'text') {
                this.consumeText(char);
                continue;
            }
            if (this.state === 'escape') {
                this.consumeEscape(char);
                continue;
            }
            if (this.state === 'csi') {
                this.consumeCsi(char);
                continue;
            }
            if (this.state === 'osc') {
                this.consumeOsc(char);
            }
        }
    }

    private consumeText(char: string): void {
        if (char === '\u001b') {
            this.state = 'escape';
            return;
        }
        if (char === '\r') {
            this.screenBuffer.carriageReturn();
            return;
        }
        if (char === '\n') {
            this.screenBuffer.newLine();
            return;
        }
        if (char === '\b' || char === '\u007f') {
            this.screenBuffer.backspace();
            return;
        }
        if (char === '\t') {
            this.screenBuffer.putGrapheme(' ', getCellWidth);
            this.screenBuffer.putGrapheme(' ', getCellWidth);
            this.screenBuffer.putGrapheme(' ', getCellWidth);
            this.screenBuffer.putGrapheme(' ', getCellWidth);
            return;
        }
        const graphemes = splitGraphemes(char);
        for (const grapheme of graphemes) {
            this.screenBuffer.putGrapheme(grapheme, getCellWidth);
        }
    }

    private consumeEscape(char: string): void {
        if (char === '[') {
            this.state = 'csi';
            this.csiBuffer = '';
            return;
        }
        if (char === ']') {
            this.state = 'osc';
            this.oscBuffer = '';
            return;
        }
        this.state = 'text';
    }

    private consumeCsi(char: string): void {
        const isFinalByte = char >= '@' && char <= '~';
        if (!isFinalByte) {
            this.csiBuffer += char;
            return;
        }

        this.applyCsi(this.csiBuffer, char);
        this.csiBuffer = '';
        this.state = 'text';
    }

    private consumeOsc(char: string): void {
        if (char === '\u0007') {
            this.oscBuffer = '';
            this.state = 'text';
            return;
        }
        this.oscBuffer += char;
    }

    private applyCsi(parametersBuffer: string, finalByte: string): void {
        const clean = parametersBuffer.trim();
        const rawParts = clean.length > 0 ? clean.split(';') : [];
        const numericParts: number[] = rawParts.map((part: string) => {
            const parsed = Number.parseInt(part, 10);
            if (Number.isNaN(parsed)) {
                return 0;
            }
            return parsed;
        });

        if (finalByte === 'J') {
            if (numericParts.length === 0 || numericParts[0] === 2) {
                this.screenBuffer.reset();
            }
            return;
        }

        if (finalByte === 'K') {
            this.screenBuffer.clearLine();
            return;
        }

        if (finalByte === 'H' || finalByte === 'f') {
            const row = (numericParts[0] || 1) - 1;
            const column = (numericParts[1] || 1) - 1;
            this.screenBuffer.moveCursor(column, row);
            return;
        }

        if (finalByte === 'm') {
            return;
        }
    }
}
