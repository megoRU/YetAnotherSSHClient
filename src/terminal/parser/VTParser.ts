import { splitGraphemes, getCellWidth } from '../unicode/grapheme';
import { ScreenBuffer } from '../core/ScreenBuffer';

export class VTParser {
    private readonly screenBuffer: ScreenBuffer;

    public constructor(screenBuffer: ScreenBuffer) {
        this.screenBuffer = screenBuffer;
    }

    public write(input: string): void {
        const parts = input.split(/(\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07)/g);
        for (const part of parts) {
            if (part.length === 0) {
                continue;
            }
            if (part.startsWith('\x1b[')) {
                this.processCsi(part);
                continue;
            }
            if (part.startsWith('\x1b]')) {
                continue;
            }
            const graphemes = splitGraphemes(part);
            for (const grapheme of graphemes) {
                this.screenBuffer.putText(grapheme, getCellWidth);
            }
        }
    }

    private processCsi(sequence: string): void {
        const finalByte = sequence[sequence.length - 1];
        if (finalByte === 'J') {
            this.screenBuffer.reset();
            return;
        }
        if (finalByte === 'H' || finalByte === 'f') {
            return;
        }
        if (finalByte === 'm') {
            return;
        }
    }
}
