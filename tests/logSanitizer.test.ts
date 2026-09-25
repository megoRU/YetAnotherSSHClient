import { describe, it, expect } from 'vitest'
import * as crypto from 'node:crypto'
import { formatArg, sanitizeData, sanitizeText } from '../src/utils/logSanitizer.js'

/** Собирает синтетический PEM-блок: настоящего ключа нет, тело — случайные байты. */
function buildSyntheticPrivateKey(): string {
    const body = crypto.randomBytes(96).toString('base64')
    return [
        '-----BEGIN OPENSSH PRIVATE KEY-----',
        body,
        '-----END OPENSSH PRIVATE KEY-----'
    ].join('\n')
}

/**
 * Значения для проверок генерируются случайно: жёстко заданные в исходниках
 * «пароли» и «токены» сканируются как возможные утёкшие секреты.
 */
function randomValue(prefix: string): string {
    return `${prefix}-${crypto.randomBytes(12).toString('hex')}`
}

describe('sanitizeText', () => {
    it('не изменяет пустую строку', () => {
        expect(sanitizeText('')).toBe('')
    })

    it('вырезает приватные ключи любого PEM-вида', () => {
        const sample = buildSyntheticPrivateKey()
        const keyBody = sample.split('\n')[1]
        const result = sanitizeText(`Ошибка при загрузке:\n${sample}\nКонец`)
        expect(result).not.toContain('BEGIN OPENSSH PRIVATE KEY')
        expect(result).not.toContain(keyBody)
        expect(result).toContain('[REDACTED PRIVATE KEY]')
    })

    it('маскирует Bearer-токены (включая base64url с =padding)', () => {
        const token = `${randomValue('bearer')}._~/-xyz=`
        const result = sanitizeText(`Authorization: Bearer ${token}`)
        expect(result).not.toContain(token.split('.')[0])
        expect(result).toContain('Bearer [REDACTED]')
    })

    it('маскирует параметр password=... в тексте', () => {
        const password = randomValue('pw')
        const result = sanitizeText(`connection string password=${password} port=22`)
        expect(result).not.toContain(password)
        expect(result).toContain('password=[REDACTED]')
    })

    it('маскирует значение по ключу token с двоеточием', () => {
        const token = randomValue('s3cr3t')
        const result = sanitizeText(`token: ${token}`)
        expect(result).not.toContain(token)
        expect(result).toBe('token: [REDACTED]')
    })
})

describe('sanitizeData', () => {
    it('маскирует чувствительные ключи и значения в объекте, не мутируя оригинал', () => {
        const sampleKey = buildSyntheticPrivateKey()
        const password = randomValue('pw')
        const token = randomValue('tok')
        const original = {
            host: 'example.com',
            password,
            privateKey: sampleKey,
            nested: { token }
        }
        const result = sanitizeData(original) as Record<string, unknown>

        expect(result).not.toEqual(original)
        expect(result.host).toBe('example.com')
        expect(result.password).toBe('[REDACTED]')
        expect(result.privateKey).toBe('[REDACTED]')
        expect((result.nested as Record<string, unknown>).token).toBe('[REDACTED]')

        expect(original.password).toBe(password)
        expect(original.privateKey).toBe(sampleKey)
        expect(original.nested.token).toBe(token)
    })

    it('маскирует содержимое строки с секретом', () => {
        const token = randomValue('tok')
        const result = sanitizeData({ uri: `https://u:p@h/path?token=${token}` })
        expect(JSON.stringify(result)).not.toContain(token)
    })

    it('обрезает циклические ссылки', () => {
        const a: Record<string, unknown> = { name: 'root' }
        a.self = a
        const result = sanitizeData(a) as Record<string, unknown>
        expect(result.name).toBe('root')
        expect(result.self).toBe('[CIRCULAR]')
    })

    it('санитизирует Error: message, stack и чувствительные поля', () => {
        const password = randomValue('pw')
        const err = new Error(`bad password=${password}`)
        Object.assign(err, { password })
        const result = sanitizeData(err) as Record<string, unknown>
        expect(result.name).toBe('Error')
        expect(String(result.message)).not.toContain(password)
        expect(String(result.stack)).not.toContain(password)
        expect(result.password).toBe('[REDACTED]')
    })

    it('возвращает примитивы как есть', () => {
        expect(sanitizeData(42)).toBe(42)
        expect(sanitizeData(true)).toBe(true)
        expect(sanitizeData(null)).toBe(null)
        expect(sanitizeData(undefined)).toBe(undefined)
    })

    it('обрабатывает массивы рекурсивно', () => {
        const result = sanitizeData([{ password: randomValue('pw') }, 'y']) as unknown[]
        expect(result[0]).toEqual({ password: '[REDACTED]' })
        expect(result[1]).toBe('y')
    })
})

describe('formatArg', () => {
    it('форматирует специальные значения', () => {
        expect(formatArg(undefined)).toBe('undefined')
        expect(formatArg(null)).toBe('null')
    })

    it('санитизирует строку с секретом', () => {
        expect(formatArg(`token=${randomValue('tok')}`)).toBe('token=[REDACTED]')
    })

    it('возвращает stack для Error', () => {
        const err = new Error('boom')
        const result = formatArg(err)
        expect(result).toContain('Error: boom')
    })

    it('сериализует объект без секретов', () => {
        const result = formatArg({ user: 'root', password: randomValue('pw') })
        expect(result).toBe('{"user":"root","password":"[REDACTED]"}')
    })
})