const SENSITIVE_KEY_REGEX = /^(password|passwd|passphrase|sshPassword|passwordHash|token|apiToken|clientToken|accessToken|refreshToken|secret|clientSecret|privateKey|private_key|sshKey|ssh_key|authorization|apiKey|recoveryKey)$/i
const SENSITIVE_PARAM_REGEX = /\b(password|passwd|passphrase|sshPassword|passwordHash|token|apiToken|clientToken|accessToken|refreshToken|secret|clientSecret|privateKey|private_key|sshKey|ssh_key|apiKey|recoveryKey)\b(\s*[:=]\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi
const BEARER_TOKEN_REGEX = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi
const PRIVATE_KEY_BLOCK_REGEX = /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g

/**
 * Очищает текстовые сообщения от чувствительных данных
 */
export function sanitizeText(text: string): string {
    if (!text) return text
    return text
        .replace(PRIVATE_KEY_BLOCK_REGEX, '[REDACTED PRIVATE KEY]')
        .replace(BEARER_TOKEN_REGEX, 'Bearer [REDACTED]')
        .replace(SENSITIVE_PARAM_REGEX, '$1$2[REDACTED]')
}

/**
 * Рекурсивно санитизирует объекты, массивы и значения, не изменяя оригинальные объекты
 */
export function sanitizeData(data: unknown, visited = new WeakSet<object>()): unknown {
    if (data === null || data === undefined) {
        return data
    }

    if (typeof data === 'string') {
        return sanitizeText(data)
    }

    if (typeof data !== 'object') {
        return data
    }

    if (visited.has(data as object)) {
        return '[CIRCULAR]'
    }

    if (data instanceof Error) {
        visited.add(data)
        const errorCopy: Record<string, unknown> = {
            name: data.name,
            message: sanitizeText(data.message),
            stack: data.stack ? sanitizeText(data.stack) : undefined
        }
        for (const [key, value] of Object.entries(data)) {
            if (SENSITIVE_KEY_REGEX.test(key)) {
                errorCopy[key] = '[REDACTED]'
            } else {
                errorCopy[key] = sanitizeData(value, visited)
            }
        }
        return errorCopy
    }

    if (Array.isArray(data)) {
        visited.add(data)
        return data.map(item => sanitizeData(item, visited))
    }

    visited.add(data as object)
    const sanitizedObj: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (SENSITIVE_KEY_REGEX.test(key)) {
            sanitizedObj[key] = '[REDACTED]'
        } else {
            sanitizedObj[key] = sanitizeData(value, visited)
        }
    }

    return sanitizedObj
}

/**
 * Форматирует и санитизирует аргументы логирования
 */
export function formatArg(arg: unknown): string {
    if (arg === undefined) return 'undefined'
    if (arg === null) return 'null'
    if (typeof arg === 'string') return sanitizeText(arg)

    const sanitized = sanitizeData(arg)

    if (sanitized instanceof Error || (typeof sanitized === 'object' && sanitized !== null && 'stack' in sanitized && typeof (sanitized as { stack?: unknown }).stack === 'string')) {
        const stackStr = (sanitized as { stack: string }).stack
        return stackStr || `${(sanitized as { name?: string }).name || 'Error'}: ${(sanitized as { message?: string }).message || ''}`
    }

    if (typeof sanitized === 'object') {
        try {
            return JSON.stringify(sanitized)
        } catch {
            return String(sanitized)
        }
    }

    return String(sanitized)
}
