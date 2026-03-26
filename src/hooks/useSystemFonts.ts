import { useState, useEffect } from 'react';

const { ipcRenderer } = window as any;

export const useSystemFonts = () => {
    const [systemFonts, setSystemFonts] = useState<string[]>([
        'JetBrains Mono', 'Menlo', 'Monaco', 'SF Pro Display', 'Helvetica Neue',
        'Consolas', 'Courier New', 'Segoe UI', 'Roboto', 'Ubuntu Mono', 'Arial', 'monospace', 'sans-serif'
    ]);

    useEffect(() => {
        ipcRenderer.invoke('get-system-fonts').then((fonts: string[]) => {
            if (fonts && fonts.length > 0) {
                setSystemFonts(fonts);
            }
        });
    }, []);

    return systemFonts;
};
