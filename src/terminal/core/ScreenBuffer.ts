import type { Cell, CellStyle } from '../types';

function createStyle(): CellStyle {
    return { fg: 7, bg: 0, bold: false, italic: false, underline: false, inverse: false };
}

function createCell(): Cell {
    return { grapheme: ' ', width: 1, style: createStyle() };
}

export class ScreenBuffer {
    private columns: number;
    private rows: number;
    private readonly lines: Cell[][];
    private cursorX: number;
    private cursorY: number;
    private readonly damage: Set<number>;

    public constructor(columns: number, rows: number) {
        this.columns = columns;
        this.rows = rows;
        this.lines = [];
        this.damage = new Set<number>();
        this.cursorX = 0;
        this.cursorY = 0;
        this.reset();
    }

    public reset(): void {
        this.lines.length = 0;
        for (let row = 0; row < this.rows; row += 1) {
            this.lines.push(this.createRow());
            this.damage.add(row);
        }
        this.cursorX = 0;
        this.cursorY = 0;
    }

    private createRow(): Cell[] {
        const row: Cell[] = [];
        for (let column = 0; column < this.columns; column += 1) {
            row.push(createCell());
        }
        return row;
    }

    public putText(text: string, widthResolver: (value: string) => number): void {
        const row = this.lines[this.cursorY];
        for (const character of Array.from(text)) {
            if (character === '\n') {
                this.newLine();
                continue;
            }
            if (character === '\r') {
                this.cursorX = 0;
                continue;
            }
            const width = widthResolver(character);
            if (this.cursorX >= this.columns) {
                this.newLine();
            }
            row[this.cursorX] = { grapheme: character, width, style: createStyle() };
            this.damage.add(this.cursorY);
            this.cursorX += width;
        }
    }

    public newLine(): void {
        this.cursorX = 0;
        this.cursorY += 1;
        if (this.cursorY >= this.rows) {
            this.lines.shift();
            this.lines.push(this.createRow());
            this.cursorY = this.rows - 1;
            for (let row = 0; row < this.rows; row += 1) {
                this.damage.add(row);
            }
        }
    }

    public resize(columns: number, rows: number): void {
        this.columns = columns;
        this.rows = rows;
        this.reset();
    }

    public getDamagedRows(): number[] {
        const rows = Array.from(this.damage.values()).sort((a, b) => a - b);
        this.damage.clear();
        return rows;
    }

    public getLine(row: number): Cell[] {
        return this.lines[row];
    }

    public getCursor(): { x: number; y: number } {
        return { x: this.cursorX, y: this.cursorY };
    }
}
