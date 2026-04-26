export const getXtermTheme = (theme: string) => {
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
                cyan: '#427b58',
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
                background: '#f5f5f5',
                foreground: '#2e2e2e',
                cursor: '#2e2e2e',
                selectionBackground: '#cce2ff',
                black: '#2e2e2e',
                red: '#c94f4f',
                green: '#6a9955',
                yellow: '#b89500',
                blue: '#4b6ea8',
                magenta: '#a05fbf',
                cyan: '#4fa3a3',
                white: '#6e6e6e',
                brightBlack: '#8a8a8a',
                brightRed: '#e06c75',
                brightGreen: '#8ec07c',
                brightYellow: '#d7ba7d',
                brightBlue: '#6c8ed4',
                brightMagenta: '#c586c0',
                brightCyan: '#56b6c2',
                brightWhite: '#1e1e1e',
            };
    }
};
