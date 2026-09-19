import type { BrowserWindow } from 'electron'
import type { SftpProgress } from '../../../src/types.js'

const FLUSH_INTERVAL_MS = 100

interface PendingBatch {
    sessionId: string
    win: BrowserWindow
    updates: Map<string, SftpProgress>
}

/**
 * Глобальный асинхронный «сглаживатель» SFTP-прогресса по сессии.
 *
 * При загрузке/скачивании папки с тысячами мелких файлов каждое файловое
 * fastPut/fastGet отправляет финальное событие прогресса, поэтому без
 * агрегации renderer получает тысячи `sftp-progress-*` IPC-сообщений в секунду.
 * Каждое такое сообщение обрабатывается главным потоком renderer'а, из-за чего
 * главная нить перегружается, и окно приложения начинает лагать/фризиться
 * (особенно заметно при перетаскивании окна по экрану).
 *
 * Здесь события копятся по сессии и отправляются в renderer не чаще, чем раз
 * в FLUSH_INTERVAL_MS, при этом для каждого transferId доставляется только
 * последнее значение.
 */
class SftpProgressBatcher {
    private batches = new Map<string, PendingBatch>()
    private timers = new Map<string, NodeJS.Timeout>()

    public push(sessionId: string, win: BrowserWindow, progress: SftpProgress): void {
        if (!progress || !progress.id || win.isDestroyed()) return

        let batch = this.batches.get(sessionId)
        if (!batch || batch.win !== win) {
            batch = { sessionId, win, updates: new Map() }
            this.batches.set(sessionId, batch)
        }
        batch.updates.set(progress.id, progress)

        if (progress.progress >= 100) {
            // Финальное событие отправляем сразу, чтобы панель мгновенно показала результат.
            this.flush(sessionId)
            return
        }

        if (!this.timers.has(sessionId)) {
            const timer = setTimeout(() => this.flush(sessionId), FLUSH_INTERVAL_MS)
            this.timers.set(sessionId, timer)
        }
    }

    public flush(sessionId: string): void {
        const timer = this.timers.get(sessionId)
        if (timer) {
            clearTimeout(timer)
            this.timers.delete(sessionId)
        }

        const batch = this.batches.get(sessionId)
        if (!batch) return
        this.batches.delete(sessionId)

        if (batch.win.isDestroyed()) return

        for (const update of batch.updates.values()) {
            batch.win.webContents.send(`sftp-progress-${sessionId}`, update)
        }
    }
}

export const sftpProgressBatcher = new SftpProgressBatcher()