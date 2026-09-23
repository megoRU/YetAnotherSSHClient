import { describe, it, expect, vi } from 'vitest'

vi.mock('../electron/src/i18n-main.js', () => ({
    t: (key: string): string => key
}))

import {
    escapeRemotePath,
    formatSshError,
    getTempRemotePath,
    isNoSuchFileError,
    normalizeRemotePath
} from '../electron/src/sftp/sftp-utils.js'

describe('normalizeRemotePath', () => {
    it('схлопывает повторяющиеся слэши и убирает хвостовой', () => {
        expect(normalizeRemotePath('/a//b///c/')).toBe('/a/b/c')
        expect(normalizeRemotePath('/a/b/')).toBe('/a/b')
    })

    it('возвращает "/" для пустого пути или корня', () => {
        expect(normalizeRemotePath('')).toBe('/')
        expect(normalizeRemotePath('///')).toBe('/')
    })

    it('не трогает корректный путь', () => {
        expect(normalizeRemotePath('/var/log')).toBe('/var/log')
    })
})

describe('getTempRemotePath', () => {
    it('добавляет temp-имя в ту же директорию', () => {
        expect(getTempRemotePath('/home/user/file.txt', 'tx123')).toBe('/home/user/.file.txt.uploading-tx123')
    })

    it('обрабатывает корень', () => {
        expect(getTempRemotePath('/', 'tx123')).toBe('/.uploading-tx123')
        expect(getTempRemotePath('', 'tx123')).toBe('/.uploading-tx123')
    })

    it('работает для пути без промежуточных директорий', () => {
        expect(getTempRemotePath('/vmlinuz', 't1')).toBe('/.vmlinuz.uploading-t1')
    })
})

describe('isNoSuchFileError', () => {
    it('распознаёт ssh2-код 2 (SSH_FX_NO_SUCH_FILE)', () => {
        expect(isNoSuchFileError({ code: 2 })).toBe(true)
    })

    it('распознаёт ENOENT и текстовые варианты', () => {
        expect(isNoSuchFileError({ code: 'ENOENT' })).toBe(true)
        expect(isNoSuchFileError({ message: 'No such file or directory' })).toBe(true)
        expect(isNoSuchFileError({ message: 'ENOENT: no such file' })).toBe(true)
    })

    it('не распознаёт другие ошибки и falsy-значения', () => {
        expect(isNoSuchFileError({ code: 1 })).toBe(false)
        expect(isNoSuchFileError({ code: 13 })).toBe(false)
        expect(isNoSuchFileError(new Error('PERMISSION DENIED'))).toBe(false)
        expect(isNoSuchFileError(null)).toBe(false)
        expect(isNoSuchFileError(undefined)).toBe(false)
    })
})

describe('escapeRemotePath', () => {
    it('оборачивает простой путь в одинарные кавычки', () => {
        expect(escapeRemotePath('/home/user/file.txt')).toBe("'/home/user/file.txt'")
    })

    it('экранирует одинарную кавычку (чем ломали command injection)', () => {
        expect(escapeRemotePath("it's 'quoted'")).toBe("'it'\\''s '\\''quoted'\\'''")
    })

    it('не интерпретирует $(), ; и пробелы внутри кавычек', () => {
        const escaped = escapeRemotePath('$(rm -rf /); echo pwn')
        expect(escaped).toBe("'$(rm -rf /); echo pwn'")
        expect(escaped.startsWith("'")).toBe(true)
        expect(escaped.endsWith("'")).toBe(true)
    })
})

describe('formatSshError', () => {
    it('мапит ошибку аутентификации на AUTH_FAILURE', () => {
        const err = Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' })
        expect(formatSshError(err)).toBe('AUTH_FAILURE: terminal.authFailed')
    })

    it('мапит "Cannot parse privateKey" на invalidPrivateKey', () => {
        expect(formatSshError(new Error('Cannot parse privateKey: malformed PEM')))
            .toBe('errors.invalidPrivateKey')
    })

    it('возвращает исходное сообщение для прочих ошибок', () => {
        expect(formatSshError(new Error('Connection timeout'))).toBe('Connection timeout')
    })
})