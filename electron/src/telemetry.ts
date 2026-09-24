import { app } from 'electron'
import { ensureClientId } from './config.js'

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
 * Выполняется одна попытка без ретраев. Любые сбои (сеть, timeout, ошибка
 * сервера) перехватываются и не влияют на запуск и работу приложения.
 */
export async function sendTelemetry(): Promise<void> {
    try {
        const payload: TelemetryPayload = {
            version: app.getVersion(),
            clientId: ensureClientId(),
            os: getTelemetryOsName()
        }

        const response = await fetch(TELEMETRY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(TELEMETRY_TIMEOUT_MS)
        })

        // Успешный приём — HTTP 204 No Content; остальные статусы обрабатываем молча.
        if (!response.ok) {
            console.warn(`[Telemetry] Unexpected response status: ${response.status}`)
        }
    } catch (err) {
        console.warn('[Telemetry] Failed to send telemetry:', err)
    }
}