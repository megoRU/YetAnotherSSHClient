const PRIVATE_KEY_PATTERNS: RegExp[] = [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
    /PuTTY-User-Key-File/
];

export function looksLikePrivateKey(content: string): boolean {
    if (!content) return false;
    return PRIVATE_KEY_PATTERNS.some(pattern => pattern.test(content));
}
