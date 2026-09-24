import { app } from 'electron'
import { loadConfig } from './config.js'

/** Единая точка приёма телеметрии приложения. */
const TELEMETRY_ENDPOINT = 'https://api.megoru.ru/api/telemetry'

/** Максимальное время ожидания ответа сервера телеметрии. */
const TELEMETRY_TIMEOUT_MS = 5000

interface TelemetryPayload {
    version: string
    clientId: string
    os: string
}

/**
 * Приводит process.platform к читаемому имени ОС для телеметрии.
 */
function getTelemetryOsName(): string {
    switch (process.platform) {
        case 'win32': return 'windows'
        case 'darwin': return 'macos'
        case 'linux': return 'linux'
        default: return process.platform
    }
}

/**
 * Асинхронно отправляет телеметрию при запуске приложения.
 *
 * Выполняется ровно одна попытка без ретраев. clientId берётся из загруженной
 * конфигурации (loadConfig гарантирует его наличие). Любые сбои (сеть, timeout,
 * ошибка сервера) перехватываются и не влияют на запуск и работу приложения.
 */
export async function sendTelemetry(): Promise<void> {
    try {
        const config = loadConfig()
        const payload: TelemetryPayload = {
            version: app.getVersion(),
            clientId: config.clientId,
            os: getTelemetryOsName()
        }

        const response = await fetch(TELEMETRY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(TELEMETRY_TIMEOUT_MS)
        })

        // Контракт API: успешный приём — HTTP 204 No Content. Диагностика на debug-уровне,
        // чтобы сбой телеметрии не выглядел как ошибка приложения.
        if (response.status !== 204) {
            console.debug(`[Telemetry] Unexpected response status: ${response.status}`)
        }
    } catch (err) {
        console.debug('[Telemetry] Failed to send telemetry:', err)
    }
}
