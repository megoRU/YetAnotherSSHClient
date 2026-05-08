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

/** Хранилище временных директорий по ID сессии */
export const sftpTempDirs = new Map<string, Set<string>>()

/** Хранилище активных SFTP-каналов для конкретных передач по их уникальному ID */
export const sftpTransferClients = new Map<string, SFTPWrapper>()

/** Хранилище серверов проброса портов: Map<sessionId, Map<forwardId, net.Server>> */
export const forwardServers = new Map<string, Map<string, net.Server>>()

/**
 * Закрывает и удаляет конкретное SSH-соединение по его ID.
 *
 * @param {string} id - Уникальный идентификатор сессии.
 */
export function cleanupConnection(id: string): void {
    if (!sshClients.has(id) && !sshSockets.has(id) && !sftpClients.has(id) && !sftpWatchers.has(id) && !sftpTempDirs.has(id)) return;
    console.log(`[Manager] Cleaning up connection for ID: ${id}`)
    // Очистка вотчеров
    const watchers = sftpWatchers.get(id)
    if (watchers) {
        watchers.forEach(w => w.close())
        sftpWatchers.delete(id)
    }

    // Очистка временных папок
    const tempDirs = sftpTempDirs.get(id)
    if (tempDirs) {
        tempDirs.forEach(dir => {
            fs.rm(dir, { recursive: true, force: true }, (err) => {
                if (err) {
                    console.error(`[Manager] Failed to remove temp dir ${dir}:`, err)
                } else {
                    console.log(`[Manager] Removed temp dir: ${dir}`)
                }
            })
        })
        sftpTempDirs.delete(id)
    }

    // Очистка трансферов, связанных с этой сессией
    sftpClients.get(id)?.removeAllListeners()
    sftpClients.get(id)?.end()

    shellStreams.get(id)?.removeAllListeners()
    shellStreams.get(id)?.destroy()

    const sshClient = sshClients.get(id)
    if (sshClient) {
        sshClient.removeAllListeners()
        sshClient.destroy()
    }

    const sshSocket = sshSockets.get(id)
    if (sshSocket) {
        sshSocket.removeAllListeners()
        sshSocket.destroy()
    }

    // Очистка проброса портов
    const forwards = forwardServers.get(id)
    if (forwards) {
        forwards.forEach(server => {
            server.removeAllListeners()
            server.close()
        })
        forwardServers.delete(id)
    }

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

    // Мы НЕ удаляем физические папки из sftpTempDirs здесь, чтобы не замедлять выход из приложения
    // (особенно на HDD). Очистка произойдет при следующем запуске в main.ts или уже произошла
    // при вызове cleanupConnection для отдельных сессий.
    sftpTempDirs.clear()

    sftpTransferClients.forEach(s => s.end())
    sftpTransferClients.clear()

    forwardServers.forEach(forwards => forwards.forEach(server => server.close()))
    forwardServers.clear()

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
