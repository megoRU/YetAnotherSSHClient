const fontLoadPromises = new Map<string, Promise<void>>();

export const ensureTerminalFont = (fontSize: number, fontFamily: string): Promise<void> => {
    const faces = document.fonts;
    if (!faces) return Promise.resolve();

    const key = `${fontSize}px "${fontFamily}"`;
    let promise = fontLoadPromises.get(key);
    if (!promise) {
        promise = (async () => {
            try {
                await faces.load(key);
                await faces.ready;
            } catch {
                /* ignore */
            }
        })();
        fontLoadPromises.set(key, promise);
    }
    return promise;
};