const segmenter: Intl.Segmenter | null = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('en', { granularity: 'grapheme' })
    : null;

export function splitGraphemes(value: string): string[] {
    if (segmenter) {
        const segments: string[] = [];
        const iterator = segmenter.segment(value)[Symbol.iterator]();
        let current = iterator.next();
        while (!current.done) {
            segments.push(current.value.segment);
            current = iterator.next();
        }
        return segments;
    }

    return Array.from(value);
}

export function getCellWidth(grapheme: string): number {
    if (grapheme.length === 0) {
        return 1;
    }
    const codePoint: number = grapheme.codePointAt(0) ?? 0;
    if (codePoint === 0) {
        return 1;
    }
    if (codePoint >= 0x1100 && (
        codePoint <= 0x115f ||
        codePoint === 0x2329 || codePoint === 0x232a ||
        (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
        (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
        (codePoint >= 0xff00 && codePoint <= 0xff60) ||
        (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
        (codePoint >= 0x1f300 && codePoint <= 0x1faff)
    )) {
        return 2;
    }
    return 1;
}
