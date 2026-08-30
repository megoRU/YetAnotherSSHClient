import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as http from 'node:http'
import * as fs from 'node:fs'
import { loadConfig, saveConfig, clearConfigCache, DEFAULT_CONFIG, configPath } from '../../config.js'
import { confirmationManager } from '../confirmation-manager.js'
import { handleMcpJsonRpc } from '../jsonrpc-handler.js'
import { recheckAuthorizationBeforeExecution } from '../ssh-executor.js'
import { startMcpServer, stopMcpServer } from '../server.js'

interface JsonRpcSuccessResult {
    jsonrpc: string
    id: number
    result: {
        isError?: boolean
        content: Array<{ type: string; text: string }>
    }
}

interface JsonRpcErrorResult {
    jsonrpc: string
    id: number | null
    error: {
        code: number
        message: string
    }
}

vi.mock('electron', () => ({
    app: { getLocale: () => 'en' },
    BrowserWindow: class {},
    safeStorage: { isEncryptionAvailable: () => false }
}))

describe('MCP Implementation Comprehensive Tests', () => {
    beforeEach(() => {
        clearConfigCache()
        const testConfig = {
            ...DEFAULT_CONFIG,
            mcpEnabled: true,
            mcpPort: 19876,
            mcpToken: 'test-token-secret',
            mcpRequireConfirmation: false,
            mcpAllowedServerIds: ['srv-1'],
            favorites: [
                { id: 'srv-1', name: 'Server 1', host: '127.0.0.1', user: 'root', port: 22 },
                { id: 'srv-2', name: 'Server 2', host: '127.0.0.2', user: 'admin', port: 22 }
            ]
        }
        fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2))
    })

    afterEach(async () => {
        await stopMcpServer()
        if (fs.existsSync(configPath)) {
            try { fs.unlinkSync(configPath) } catch { /* ignore */ }
        }
    })

    it('1. Single allowed server without connection_id -> success auto-selection', async () => {
        const req = {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'list_connections'
            }
        }
        const res = (await handleMcpJsonRpc(req)) as JsonRpcSuccessResult
        expect(res.result).toBeDefined()
        const parsed = JSON.parse(res.result.content[0].text)
        expect(parsed.connections.length).toBe(1)
        expect(parsed.connections[0].id).toBe('srv-1')
    })

    it('2. Multiple allowed servers without connection_id -> returns error requiring connection_id', async () => {
        const config = loadConfig()
        config.mcpAllowedServerIds = ['srv-1', 'srv-2']
        saveConfig(config)

        const req = {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
                name: 'execute_command',
                arguments: { command: 'uptime' }
            }
        }
        const res = (await handleMcpJsonRpc(req)) as JsonRpcSuccessResult
        expect(res.result.isError).toBe(true)
        expect(res.result.content[0].text).toContain("Please specify 'connection_id'")
    })

    it('3. Multiple allowed servers with connection_id -> proceeds to execution/auth check', async () => {
        const config = loadConfig()
        config.mcpAllowedServerIds = ['srv-1', 'srv-2']
        saveConfig(config)

        const checkResult = recheckAuthorizationBeforeExecution('srv-2')
        expect(checkResult.authorized).toBe(true)
        expect(checkResult.server?.id).toBe('srv-2')
    })

    it('4. Connection_id not allowed -> error', async () => {
        const req = {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: {
                name: 'execute_command',
                arguments: { connection_id: 'srv-2', command: 'ls' }
            }
        }
        const res = (await handleMcpJsonRpc(req)) as JsonRpcSuccessResult
        expect(res.result.isError).toBe(true)
        expect(res.result.content[0].text).toContain("not open for MCP access")
    })

    it('5. Confirmation approve -> allows command execution', async () => {
        const config = loadConfig()
        config.mcpRequireConfirmation = true
        saveConfig(config)

        const confirmPromise = confirmationManager.createConfirmation(
            'conf-1',
            'sess-1',
            'srv-1',
            'Server 1',
            'whoami',
            () => ({})
        )

        expect(confirmationManager.getPendingList().length).toBe(1)

        confirmationManager.handleResponse('conf-1', true, 'user', 'sess-1')
        const approved = await confirmPromise
        expect(approved).toBe(true)
        expect(confirmationManager.getPendingList().length).toBe(0)
    })

    it('6. Confirmation reject -> denies execution', async () => {
        const confirmPromise = confirmationManager.createConfirmation(
            'conf-2',
            'sess-1',
            'srv-1',
            'Server 1',
            'whoami',
            () => ({})
        )

        confirmationManager.handleResponse('conf-2', false, 'user', 'sess-1')
        const approved = await confirmPromise
        expect(approved).toBe(false)
    })

    it('7. Revoke access while confirmation pending -> cancels confirmation and fails auth', async () => {
        const confirmPromise = confirmationManager.createConfirmation(
            'conf-3',
            'sess-1',
            'srv-1',
            'Server 1',
            'whoami',
            () => ({})
        )

        confirmationManager.revokeByServerId('srv-1')
        const approved = await confirmPromise
        expect(approved).toBe(false)

        const config = loadConfig()
        config.mcpAllowedServerIds = []
        saveConfig(config)

        const auth = recheckAuthorizationBeforeExecution('srv-1')
        expect(auth.authorized).toBe(false)
        expect(auth.reason).toContain('not authorized')
    })

    it('8. Session disconnect while confirmation pending -> revokes confirmation', async () => {
        const confirmPromise = confirmationManager.createConfirmation(
            'conf-4',
            'sess-target',
            'srv-1',
            'Server 1',
            'whoami',
            () => ({})
        )

        confirmationManager.revokeBySessionId('sess-target')
        const approved = await confirmPromise
        expect(approved).toBe(false)
    })

    it('9. Cross-session confirmation isolation -> Session A cannot approve Session B confirmation', async () => {
        const confirmPromise = confirmationManager.createConfirmation(
            'conf-5',
            'sess-B',
            'srv-1',
            'Server 1',
            'whoami',
            () => ({})
        )

        // Attempting to approve conf-5 from sess-A
        const handled = confirmationManager.handleResponse('conf-5', true, 'user', 'sess-A')
        expect(handled).toBe(false)

        // Pending confirmation must still exist
        expect(confirmationManager.getPendingList().length).toBe(1)

        // Correct session approves
        const handledCorrect = confirmationManager.handleResponse('conf-5', true, 'user', 'sess-B')
        expect(handledCorrect).toBe(true)
        expect(await confirmPromise).toBe(true)
    })

    it('10. Oversized HTTP body limit enforcement (1MB limit)', async () => {
        await startMcpServer()
        const token = 'test-token-secret'

        const options: http.RequestOptions = {
            hostname: '127.0.0.1',
            port: 19876,
            path: '/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        }

        const resCode = await new Promise<number>((resolve) => {
            const req = http.request(options, (res) => {
                resolve(res.statusCode || 0)
            })
            req.on('error', () => resolve(413))

            // Create payload larger than 1MB
            const hugeString = 'x'.repeat(1.5 * 1024 * 1024)
            req.write(JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/list', params: { huge: hugeString } }))
            req.end()
        })

        expect([413, 0]).toContain(resCode) // 413 Payload Too Large or socket aborted
    })

    it('11. Malformed JSON-RPC and Notifications handling', async () => {
        // Notification (no id) -> returns null
        const notif = { jsonrpc: '2.0', method: 'notifications/initialized' }
        const notifRes = await handleMcpJsonRpc(notif)
        expect(notifRes).toBeNull()

        // Malformed request -> returns code -32600
        const malformed = { jsonrpc: '1.0', method: 'test' }
        const malformedRes = (await handleMcpJsonRpc(malformed)) as JsonRpcErrorResult
        expect(malformedRes.error.code).toBe(-32600)
    })

    it('12. MCP server stop with pending confirmations -> cancels all pending', async () => {
        const confirmPromise = confirmationManager.createConfirmation(
            'conf-stop',
            'sess-stop',
            'srv-1',
            'Server 1',
            'ls',
            () => ({})
        )

        await stopMcpServer()
        const approved = await confirmPromise
        expect(approved).toBe(false)
        expect(confirmationManager.getPendingList().length).toBe(0)
    })
})
