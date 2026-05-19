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

    public putGrapheme(grapheme: string, widthResolver: (value: string) => number): void {
        const width = widthResolver(grapheme);
        if (this.cursorX >= this.columns) {
            this.newLine();
        }
        if (this.cursorY < 0 || this.cursorY >= this.rows) {
            return;
        }
        const row = this.lines[this.cursorY];
        row[this.cursorX] = { grapheme, width, style: createStyle() };
        if (width === 2 && this.cursorX + 1 < this.columns) {
            row[this.cursorX + 1] = { grapheme: ' ', width: 0, style: createStyle() };
        }
        this.damage.add(this.cursorY);
        this.cursorX += Math.max(1, width);
    }

    public carriageReturn(): void {
        this.cursorX = 0;
        this.damage.add(this.cursorY);
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
        } else {
            this.damage.add(this.cursorY);
        }
    }

    public backspace(): void {
        if (this.cursorX > 0) {
            this.cursorX -= 1;
        }
        const row = this.lines[this.cursorY];
        row[this.cursorX] = createCell();
        this.damage.add(this.cursorY);
    }

    public clearLine(): void {
        this.lines[this.cursorY] = this.createRow();
        this.cursorX = 0;
        this.damage.add(this.cursorY);
    }

    public moveCursor(column: number, row: number): void {
        const safeColumn = Math.max(0, Math.min(column, this.columns - 1));
        const safeRow = Math.max(0, Math.min(row, this.rows - 1));
        this.cursorX = safeColumn;
        this.cursorY = safeRow;
        this.damage.add(this.cursorY);
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
