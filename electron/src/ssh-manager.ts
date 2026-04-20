import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2'
import * as net from 'node:net'
import * as fs from 'node:fs'
import { SSHConfig } from './types.js'

/** Хранилище конфигураций по ID сессии */
export const sshConfigs = new Map<string, SSHConfig>()

/** Хранилище активных SSH-клиентов по ID сессии */
export const sshClients = new Map<string, Client>()

/** Хранилище открытых потоков оболочки (shell) по ID сессии */
export const shellStreams = new Map<string, ClientChannel>()

/** Хранилище активных SFTP-клиентов по ID сессии */
export const sftpClients = new Map<string, SFTPWrapper>()

/** Хранилище TCP-сокетов для SSH-соединений по ID сессии */
export const sshSockets = new Map<string, net.Socket>()

/** Хранилище активных вотчеров за файлами по ID сессии и локальному пути */
export const sftpWatchers = new Map<string, Map<string, fs.FSWatcher>>()

/** Хранилище активных SFTP-каналов для конкретных передач по их уникальному ID */
export const sftpTransferClients = new Map<string, SFTPWrapper>()

/**
 * Закрывает и удаляет конкретное SSH-соединение по его ID.
 *
 * @param {string} id - Уникальный идентификатор сессии.
 */
export function cleanupConnection(id: string): void {
    if (!sshClients.has(id) && !sshSockets.has(id) && !sftpClients.has(id) && !sftpWatchers.has(id)) return;
    console.log(`[Manager] Cleaning up connection for ID: ${id}`)
    // Очистка вотчеров
    const watchers = sftpWatchers.get(id)
    if (watchers) {
        watchers.forEach(w => w.close())
        sftpWatchers.delete(id)
    }

    // Очистка трансферов, связанных с этой сессией (по префиксу ID если нужно,
    // но обычно проще по завершению SSH клиента они сами закроются).
    // Для надежности можно хранить связь сессия -> трансферы, но ssh2 закроет их при sshClient.destroy()

    sftpClients.get(id)?.end()
    shellStreams.get(id)?.destroy()
    sshClients.get(id)?.destroy()
    sshSockets.get(id)?.destroy()
    sftpClients.delete(id)
    shellStreams.delete(id)
    sshClients.delete(id)
    sshSockets.delete(id)
    sshConfigs.delete(id)
}

/**
 * Закрывает все активные SSH-соединения и очищает хранилища.
 * Используется при выходе из приложения.
 */
export function cleanupAll(): void {
    console.log('[Manager] Cleaning up all connections')
    sftpWatchers.forEach(watchers => watchers.forEach(w => w.close()))
    sftpWatchers.clear()

    sftpTransferClients.forEach(s => s.end())
    sftpTransferClients.clear()

    sftpClients.forEach(s => s.end())
    shellStreams.forEach(s => s.destroy())
    sshClients.forEach(c => c.destroy())
    sshSockets.forEach(s => s.destroy())
    sftpClients.clear()
    shellStreams.clear()
    sshClients.clear()
    sshSockets.clear()
    sshConfigs.clear()
}
