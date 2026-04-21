export const getTerminalTheme = (theme: string) => {
    switch (theme) {
        case 'Dark':
            return {
                background: '#282828',
                foreground: '#ebdbb2',
                cursor: '#ebdbb2',
                selectionBackground: '#504945',
                black: '#282828',
                red: '#cc241d',
                green: '#98971a',
                yellow: '#d79921',
                blue: '#458588',
                magenta: '#b16286',
                cyan: '#689d6a',
                white: '#a89984',
                brightBlack: '#928374',
                brightRed: '#fb4934',
                brightGreen: '#b8bb26',
                brightYellow: '#fabd2f',
                brightBlue: '#83a598',
                brightMagenta: '#d3869b',
                brightCyan: '#8ec07c',
                brightWhite: '#ebdbb2',
            };
        case 'Gruvbox Light':
            return {
                background: '#fbf1c7',
                foreground: '#282828',
                cursor: '#3c3836',
                selectionBackground: '#d5c4a1',
                black: '#282828',
                red: '#cc241d',
                green: '#98971a',
                yellow: '#d79921',
                blue: '#458588',
                magenta: '#b16286',
                cyan: '#689d6a',
                white: '#7c6f64',
                brightBlack: '#928374',
                brightRed: '#9d0006',
                brightGreen: '#79740e',
                brightYellow: '#b57614',
                brightBlue: '#076678',
                brightMagenta: '#8f3f71',
                brightCyan: '#427b58',
                brightWhite: '#3c3836',
            };
        case 'Light':
        default:
            return {
                background: '#ffffff',
                foreground: '#000000',
                cursor: '#000000',
                selectionBackground: '#add6ff',
                black: '#000000',
                red: '#cd3131',
                green: '#00bc00',
                yellow: '#949800',
                blue: '#0451a5',
                magenta: '#bc05bc',
                cyan: '#0598bc',
                white: '#555555',
                brightBlack: '#666666',
                brightRed: '#cd3131',
                brightGreen: '#14e314',
                brightYellow: '#b5ba00',
                brightBlue: '#0451a5',
                brightMagenta: '#bc05bc',
                brightCyan: '#0598bc',
                brightWhite: '#a5a5a5',
            };
    }
};
