import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendTelemetry } from '../electron/src/telemetry.js'

vi.mock('../electron/src/config.js', () => ({
    loadConfig: (): { clientId: string } => ({ clientId: 'test-client-id' }),
}))

/** Ожидаемое имя ОС для текущей платформы (дублирует маппинг из telemetry.ts). */
function expectedOsName(platform: NodeJS.Platform): string {
    switch (platform) {
        case 'win32': return 'windows'
        case 'darwin': return 'macos'
        case 'linux': return 'linux'
        default: return platform
    }
}

describe('sendTelemetry', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('отправляет корректный payload одним HTTP POST', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ status: 204 })
        vi.stubGlobal('fetch', fetchMock)

        await sendTelemetry()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

        expect(url).toBe('https://api.megoru.ru/api/telemetry')
        expect(init.method).toBe('POST')

        const headers = init.headers as Record<string, string>
        expect(headers['Content-Type']).toBe('application/json')

        // Тайм-аут ~5 секунд передаётся через AbortSignal
        expect(init.signal).toBeInstanceOf(AbortSignal)

        const payload = JSON.parse(init.body as string)
        expect(payload).toEqual({
            version: '3.1.1',
            clientId: 'test-client-id',
            os: expectedOsName(process.platform)
        })
    })

    it('успешный HTTP 204 не логируется и не бросает исключение', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
        const fetchMock = vi.fn().mockResolvedValue({ status: 204 })
        vi.stubGlobal('fetch', fetchMock)

        await expect(sendTelemetry()).resolves.toBeUndefined()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(debugSpy).not.toHaveBeenCalled()
    })

    it('HTTP 500 обрабатывается молча, без повторных запросов', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
        const fetchMock = vi.fn().mockResolvedValue({ status: 500 })
        vi.stubGlobal('fetch', fetchMock)

        await expect(sendTelemetry()).resolves.toBeUndefined()

        // Один запрос, без ретраев
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(debugSpy).toHaveBeenCalledTimes(1)
    })

    it('сетевая ошибка не влияет на приложение и не вызывает ретраев', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
        vi.stubGlobal('fetch', fetchMock)

        await expect(sendTelemetry()).resolves.toBeUndefined()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(debugSpy).toHaveBeenCalledTimes(1)
    })

    it('timeout/отклонённый fetch обрабатывается молча, без повторных запросов', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
        const abortError = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
        const fetchMock = vi.fn().mockRejectedValue(abortError)
        vi.stubGlobal('fetch', fetchMock)

        await expect(sendTelemetry()).resolves.toBeUndefined()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(debugSpy).toHaveBeenCalledTimes(1)
    })
})
