import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2'
import * as net from 'node:net'
import * as fs from 'node:fs'
import { SSHConfig } from '../../src/types.js'
import { sftpTransferManager } from './sftp/SftpTransferManager.js'

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

/** Хранилище серверов проброса портов: Map<sessionId, Map<forwardId, net.Server>> */
export const forwardServers = new Map<string, Map<string, net.Server>>()

export function registerTransferClient(sessionId: string, transferId: string, sftp: SFTPWrapper): void {
    sftpTransferManager.registerTransfer(sessionId, transferId, sftp)
}

export function unregisterTransferClient(transferId: string): void {
    sftpTransferManager.unregisterTransfer(transferId)
}

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
    sftpTransferManager.cleanupSessionTransfers(id)

    const sftpClient = sftpClients.get(id)
    if (sftpClient) {
        sftpClient.removeAllListeners()
        sftpClient.end()
    }

    const shellStream = shellStreams.get(id)
    if (shellStream) {
        shellStream.removeAllListeners()
        shellStream.destroy()
    }

    const sshClient = sshClients.get(id)
    if (sshClient) {
        sshClient.removeAllListeners('error')
        sshClient.on('error', () => {})
        sshClient.destroy()
    }

    const sshSocket = sshSockets.get(id)
    if (sshSocket) {
        sshSocket.removeAllListeners('error')
        sshSocket.on('error', () => {})
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

    sftpTempDirs.clear()

    sftpTransferManager.cleanupAllTransfers()

    forwardServers.forEach(forwards => forwards.forEach(server => server.close()))
    forwardServers.clear()

    sftpClients.forEach(s => {
        s.removeAllListeners()
        s.end()
    })
    shellStreams.forEach(s => {
        s.removeAllListeners()
        s.destroy()
    })
    sshClients.forEach(c => {
        c.removeAllListeners('error')
        c.on('error', () => {})
        c.destroy()
    })
    sshSockets.forEach(s => {
        s.removeAllListeners('error')
        s.on('error', () => {})
        s.destroy()
    })
    sftpClients.clear()
    shellStreams.clear()
    sshClients.clear()
    sshSockets.clear()
    sshConfigs.clear()
}
