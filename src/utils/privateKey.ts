const PEM_HEADER = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/;
const PEM_FOOTER = /-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/;
const PPK_HEADER = /PuTTY-User-Key-File-\d+:[^\r\n]*/;
const PPK_ENCRYPTION = /Encryption:[ \t]*\S+/;
const PPK_PUBLIC_LINES = /Public-Lines:[ \t]*\d+/;
const PPK_PRIVATE_LINES = /Private-Lines:[ \t]*\d+/;

/**
 * Лёгкая синтаксическая проверка для renderer (быстрая UX-обратная связь).
 * Авторитетная валидация происходит в main-процессе (node:crypto) — см. validatePrivateKeyContent.
 */
export function looksLikePrivateKey(content: string): boolean {
    if (!content || typeof content !== 'string') return false;
    if (PEM_HEADER.test(content) && PEM_FOOTER.test(content)) return true;
    return PPK_HEADER.test(content)
        && PPK_ENCRYPTION.test(content)
        && PPK_PUBLIC_LINES.test(content)
        && PPK_PRIVATE_LINES.test(content);
}
