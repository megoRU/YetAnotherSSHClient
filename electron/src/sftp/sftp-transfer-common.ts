import type { BrowserWindow } from 'electron'
import type { Client, SFTPWrapper } from 'ssh2'
import type { SftpProgress } from '../../../src/types.js'
import type { SftpTransferManagerService } from './SftpTransferManager.js'
import { sftpProgressBatcher } from './sftp-progress-batcher.js'
import { getSftpSession } from './sftp-operations.js'

/** Состояние агрегированного прогресса многофайлового трансфера. */
export interface TransferState {
    transferred: number
    total: number
    rootPath: string
}

export function createTransferState(rootPath: string, total: number): TransferState {
    return { transferred: 0, total: total || 0, rootPath }
}

/** Доля прогресса агрегированного трансфера в процентах (0..100). */
export function aggregateTransferProgress(state: TransferState): number {
    return state.total > 0 ? Math.min(Math.round((state.transferred / state.total) * 100), 100) : 100
}

/** Доля прогресса отдельного файла в процентах. */
export function ratioTransferProgress(transferred: number, total: number, fallback: number): number {
    return total > 0 ? Math.round((transferred / total) * 100) : fallback
}

export interface TransferProgressReporterOptions {
    sessionId: string
    transferId: string
    type: 'upload' | 'download'
    getWin: () => BrowserWindow | null
    isActive: () => boolean
    throttleMs?: number
}

export interface TransferProgressReporter {
    /** Отправляет обновление прогресса с троттлингом; финальный прогресс (100) уходит сразу. */
    emit(remotePath: string, progress: number, transferred?: number, total?: number): void
}

/**
 * Троттлинг-обёртка над sftpProgressBatcher для прогресса отдельного файла.
 * Эквивалент прежней логики `lastProgressTime > 100 || transferred === total`.
 */
export function createTransferProgressReporter(options: TransferProgressReporterOptions): TransferProgressReporter {
    const { sessionId, transferId, type, getWin, isActive, throttleMs = 100 } = options
    let lastEmitTime = 0

    return {
        emit(remotePath, progress, transferred, total) {
            if (!isActive()) return
            const now = Date.now()
            if (now - lastEmitTime < throttleMs && progress < 100) return
            lastEmitTime = now
            const win = getWin()
            if (!win) return
            const data: SftpProgress = { id: transferId, remotePath, progress, transferred, total, type }
            sftpProgressBatcher.push(sessionId, win, data)
        }
    }
}

/**
 * Открывает пер-трансферную SFTP-сессию на готовом SSH-клиенте, регистрирует
 * трансфер, выполняет действие и в finally снимает регистрацию и закрывает канал.
 * Заменяет дублирующийся lifecycle-код в upload/download сервисах.
 * Отсутствие клиента проверяется вызывающей стороной (как и в исходном коде).
 */
export async function withTransferSession<T>(
    client: Client,
    transferManager: SftpTransferManagerService,
    id: string,
    options: { transferId?: string; tempRemotePath?: string },
    run: (sftp: SFTPWrapper) => Promise<T>
): Promise<T> {
    const sftp = await getSftpSession(client)
    if (options.transferId) {
        transferManager.registerTransfer(id, options.transferId, sftp, options.tempRemotePath)
    }
    try {
        return await run(sftp)
    } finally {
        if (options.transferId) {
            transferManager.unregisterTransfer(options.transferId)
        }
        sftp.end()
    }
}