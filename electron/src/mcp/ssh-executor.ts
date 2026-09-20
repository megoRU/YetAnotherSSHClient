import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import * as fs from 'node:fs'
import { loadConfig, initializeVaultAndMigrate } from '../config.js'
import { vault } from '../vault.js'
import { SSHConfig } from '../../../src/types.js'
import { sessionManager } from './session-manager.js'
import { StreamOutputCollector } from './stream-output-collector.js'

export function recheckAuthorizationBeforeExecution(
    connectionId: string,
    sessionId?: string
): { authorized: boolean; reason?: string; server?: SSHConfig } {
    const config = loadConfig()

    // 1. MCP enabled
    if (!config.mcpEnabled) {
        return { authorized: false, reason: 'MCP server is disabled' }
    }

    // 2. Session exists (if sessionId is provided)
    if (sessionId && !sessionManager.hasTransport(sessionId)) {
        return { authorized: false, reason: 'MCP session is no longer active' }
    }

    // 3. connectionId is in mcpAllowedServerIds
    const allowedIds = config.mcpAllowedServerIds || []
    if (!allowedIds.includes(connectionId)) {
        return { authorized: false, reason: `Server '${connectionId}' is not authorized for MCP access` }
    }

    // 4. Server exists in favorites
    const server = (config.favorites || []).find(f => f.id === connectionId)
    if (!server) {
        return { authorized: false, reason: `Server '${connectionId}' not found in configuration` }
    }

    return { authorized: true, server }
}

export async function executeIsolatedSshCommand(
    config: SSHConfig,
    command: string,
    signal?: AbortSignal
): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
        const client = new Client()

        let activeStream: ClientChannel | null = null
        const stdoutCollector = new StreamOutputCollector()
        const stderrCollector = new StreamOutputCollector()
        let isResolved = false

        let timeoutTimer: NodeJS.Timeout | null = null
        const onAbort = () => cleanup(new Error('SSH command execution was cancelled'))

        const cleanup = (err?: Error) => {
            if (isResolved) return
            isResolved = true

            if (timeoutTimer) {
                clearTimeout(timeoutTimer)
                timeoutTimer = null
            }
            if (onAbort) signal?.removeEventListener('abort', onAbort)

            if (activeStream) {
                activeStream.removeAllListeners()
                if (activeStream.stderr) {
                    activeStream.stderr.removeAllListeners()
                }
                try { activeStream.destroy() } catch { /* ignore */ }
                try { activeStream.close() } catch { /* ignore */ }
                activeStream = null
            }

            client.removeAllListeners()
            try { client.end() } catch { /* ignore */ }
            try { client.destroy() } catch { /* ignore */ }

            if (err) {
                reject(err)
            }
        }

        if (signal?.aborted) {
            onAbort()
            return
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        timeoutTimer = setTimeout(() => {
            cleanup(new Error('SSH command execution timed out after 120 seconds'))
        }, 120000)

        client.on('error', (err) => {
            cleanup(err)
        })

        client.on('ready', () => {
            client.exec(command, (err, stream) => {
                if (err) {
                    return cleanup(err)
                }

                if (isResolved) {
                    try { stream.destroy() } catch { /* ignore */ }
                    return
                }

                activeStream = stream

                stream.on('error', (streamErr: Error) => {
                    cleanup(streamErr)
                })

                stream.on('data', (data: Buffer) => {
                    if (isResolved) return
                    stdoutCollector.write(data)
                })

                if (stream.stderr) {
                    stream.stderr.on('data', (data: Buffer) => {
                        if (isResolved) return
                        stderrCollector.write(data)
                    })
                }

                stream.on('close', (code: number) => {
                    if (isResolved) return
                    const finalStdout = stdoutCollector.getOutput()
                    const finalStderr = stderrCollector.getOutput()
                    cleanup()
                    resolve({ stdout: finalStdout, stderr: finalStderr, code })
                })
            })
        })

        const connectConfig: ConnectConfig = {
            host: config.host,
            port: config.port || 22,
            username: config.user,
            readyTimeout: 15000,
        }

        if (config.authType === 'key' && config.privateKeyPath) {
            try {
                connectConfig.privateKey = fs.readFileSync(config.privateKeyPath)
            } catch (err) {
                return cleanup(err instanceof Error ? err : new Error(String(err)))
            }
        } else {
            const appConfig = loadConfig()
            initializeVaultAndMigrate(appConfig)
            const serverId = config.id
            if (serverId && appConfig.encryptedPasswords?.[serverId]) {
                try {
                    connectConfig.password = vault.decrypt(appConfig.encryptedPasswords[serverId])
                } catch {
                    return cleanup(new Error('Vault decryption failed'))
                }
            } else {
                connectConfig.password = config.password
            }
        }

        try {
            client.connect(connectConfig)
        } catch (err) {
            cleanup(err instanceof Error ? err : new Error(String(err)))
        }
    })
}
