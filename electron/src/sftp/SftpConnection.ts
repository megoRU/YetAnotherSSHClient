import type { IpcMainEvent } from 'electron'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import * as net from 'node:net'
import * as fs from 'node:fs'
import {
    cleanupConnection,
    sftpClients,
    sshClients,
    sshConfigs,
    sshSockets
} from '../ssh-manager.js'
import { loadConfig, initializeVaultAndMigrate } from '../config.js'
import { vault } from '../vault.js'
import { t } from '../i18n-main.js'
import type { SftpConnectPayload } from '../../../src/types.js'
import { formatSshError } from './sftp-utils.js'

export async function resolveConnectConfig(config: SftpConnectPayload['config']): Promise<ConnectConfig> {
    const connectConfig: ConnectConfig = {
        username: config.user,
        host: config.host,
        port: config.port || 22,
        readyTimeout: 20000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3
    }

    if (config.authType === 'key' && config.privateKeyPath) {
        try {
            connectConfig.privateKey = await fs.promises.readFile(config.privateKeyPath)
        } catch (err) {
            throw new Error(t('errors.readPrivateKeyFailed', { message: String(err) }))
        }
    } else {
        const appConfig = loadConfig()
        initializeVaultAndMigrate(appConfig)
        const serverId = config.id
        if (serverId && appConfig.encryptedPasswords?.[serverId]) {
            try {
                connectConfig.password = vault.decrypt(appConfig.encryptedPasswords[serverId])
            } catch {
                throw new Error(t('errors.vaultDecryptFailed'))
            }
        } else {
            connectConfig.password = config.password
        }
    }

    return connectConfig
}

export class SftpConnectionService {
    public getSftpClient(id: string): SFTPWrapper | undefined {
        return sftpClients.get(id)
    }

    public getSshClient(id: string): Client | undefined {
        return sshClients.get(id)
    }

    public hasActiveSshClient(id: string): boolean {
        const client = sshClients.get(id)
        // @ts-expect-error - Checking internal _sock for activity
        return !!(client && client._sock && !client._sock.destroyed)
    }

    public connect(event: IpcMainEvent, payload: SftpConnectPayload): void {
        const { id, config } = payload
        console.log(`[SFTP] Connecting to ${config.host}:${config.port || 22} (ID: ${id})`)

        const existingClient = this.getSshClient(id)
        if (this.hasActiveSshClient(id) && existingClient) {
            console.log(`[SFTP] Reusing existing SSH client for ID: ${id}`)
            existingClient.sftp((err, sftp) => {
                if (err) {
                    const formattedError = formatSshError(err)
                    console.error(`[SFTP] SFTP request error (reuse): ${formattedError}`)
                    event.reply(`sftp-error-${id}`, formattedError)
                    return
                }
                console.log(`[SFTP] SFTP session ready (reuse) for ID: ${id}`)
                sftpClients.set(id, sftp)
                event.reply(`sftp-status-${id}`, t('sftp.ready'))
            })
            return
        }

        cleanupConnection(id)

        const sshClient = new Client()
        sshClients.set(id, sshClient)
        sshConfigs.set(id, config)

        sshClient.on('error', (err: Error & { level?: string }) => {
            const formattedError = formatSshError(err)
            console.error(`[SFTP] SSH client error for ID: ${id}: ${formattedError}`)
            event.reply(`sftp-error-${id}`, formattedError)
            cleanupConnection(id)
        })

        const socket = net.connect({
            port: config.port || 22,
            host: config.host,
            timeout: 15000
        })
        sshSockets.set(id, socket)

        socket.on('connect', async () => {
            console.log(`[SFTP] TCP socket connected for ID: ${id}`)
            socket.setNoDelay(true)
            let connectConfig: ConnectConfig
            try {
                connectConfig = await resolveConnectConfig(config)
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                console.error(`[SFTP] Auth config resolution error: ${message}`)
                event.reply(`sftp-error-${id}`, message)
                cleanupConnection(id)
                return
            }
            connectConfig.sock = socket

            console.log(`[SFTP] Starting SSH handshake for ID: ${id}`)
            sshClient.connect(connectConfig)
        })

        socket.on('timeout', () => {
            console.error(`[SFTP] TCP connection timeout for ID: ${id}`)
            event.reply(`sftp-error-${id}`, t('common.tcpTimeout'))
            cleanupConnection(id)
        })

        socket.on('error', (err: Error) => {
            console.error(`[SFTP] Socket error for ID: ${id}: ${err.message}`)
            event.reply(`sftp-error-${id}`, t('errors.socketError', { message: err.message }))
            cleanupConnection(id)
        })

        sshClient.on('ready', () => {
            console.log(`[SFTP] SSH client ready, requesting SFTP for ID: ${id}`)
            sshClient.sftp((err, sftp) => {
                if (err) {
                    const formattedError = formatSshError(err)
                    console.error(`[SFTP] SFTP request error: ${formattedError}`)
                    event.reply(`sftp-error-${id}`, formattedError)
                    return
                }
                console.log(`[SFTP] SFTP session ready for ID: ${id}`)
                sftpClients.set(id, sftp)
                event.reply(`sftp-status-${id}`, t('sftp.ready'))
            })
        })

        sshClient.on('end', () => {
            console.log(`[SFTP] SSH connection ended for ID: ${id}`)
            event.reply(`sftp-status-${id}`, t('sftp.connectionEnded'))
            cleanupConnection(id)
        })

        sshClient.on('close', () => {
            console.log(`[SFTP] SSH connection closed for ID: ${id}`)
            event.reply(`sftp-status-${id}`, t('sftp.connectionClosed'))
            cleanupConnection(id)
        })
    }
}
