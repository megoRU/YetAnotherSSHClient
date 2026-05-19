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

export interface TerminalOptions {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
    scrollback: number;
    scrollSensitivity: number;
    theme: TerminalTheme;
}

export interface CellStyle {
    fg: number;
    bg: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    inverse: boolean;
}

export interface Cell {
    grapheme: string;
    width: number;
    style: CellStyle;
}
