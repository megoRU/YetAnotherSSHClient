import { useState, useEffect } from 'react';

const { ipcRenderer } = window;

export const useSystemFonts = () => {
    const [systemFonts, setSystemFonts] = useState<string[]>([
        'JetBrains Mono', 'Menlo', 'Monaco', 'SF Pro Display', 'Helvetica Neue',
        'Consolas', 'Courier New', 'Segoe UI', 'Roboto', 'Ubuntu Mono', 'Arial', 'monospace', 'sans-serif'
    ]);

    useEffect(() => {
        ipcRenderer.invoke('get-system-fonts').then((res: unknown) => {
            const fonts = res as string[];
            if (fonts && fonts.length > 0) {
                setSystemFonts(fonts);
            }
        });
    }, []);

    return systemFonts;
};
