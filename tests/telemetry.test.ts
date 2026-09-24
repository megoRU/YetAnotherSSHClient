import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendTelemetry } from '../electron/src/telemetry.js'

vi.mock('../electron/src/config.js', () => ({
    loadConfig: (): { clientId: string } => ({ clientId: 'stored-client-id' }),
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

    it('отправляет корректный payload один раз с HTTP POST', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
        vi.stubGlobal('fetch', fetchMock)

        await sendTelemetry()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

        expect(url).toBe('https://api.megoru.ru/api/telemetry')
        expect(init.method).toBe('POST')

        const headers = init.headers as Record<string, string>
        expect(headers['Content-Type']).toBe('application/json')

        const payload = JSON.parse(init.body as string)
        expect(payload).toEqual({
            version: '3.1.1',
            clientId: 'test-client-id',
            os: expectedOsName(process.platform)
        })
    })

    it('молча переживает ошибку сети и не бросает исключение', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

        await expect(sendTelemetry()).resolves.toBeUndefined()

        expect(warnSpy).toHaveBeenCalled()
    })

    it('молча переживает ошибку сервера (не-204 статус)', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

        await expect(sendTelemetry()).resolves.toBeUndefined()

        expect(warnSpy).toHaveBeenCalled()
    })
})