import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import { startMcpServer, stopMcpServer } from './server.js'
import { loadConfig, saveConfig } from '../config.js'

function makeHttpRequest(options: http.RequestOptions, body?: string | Buffer): Promise<{ statusCode?: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let resBody = ''
            res.on('data', (chunk) => {
                resBody += chunk
            })
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: resBody
                })
            })
        })
        req.on('error', reject)
        if (body) {
            req.write(body)
        }
        req.end()
    })
}

describe('MCP Server Streamable HTTP Transport', () => {
    const testPort = 3987
    const testToken = 'test-secret-token-1234567890'

    test.before(async () => {
        const config = loadConfig()
        config.mcpEnabled = true
        config.mcpPort = testPort
        config.mcpToken = testToken
        saveConfig(config)

        const started = await startMcpServer()
        assert.equal(started, true, 'MCP server should start successfully')
    })

    test.after(async () => {
        await stopMcpServer()
        const config = loadConfig()
        config.mcpEnabled = false
        saveConfig(config)
    })

    test('Unauthorized access without Bearer token returns 401', async () => {
        const res = await makeHttpRequest({
            hostname: '127.0.0.1',
            port: testPort,
            path: '/mcp',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream'
            }
        }, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }))

        assert.equal(res.statusCode, 401)
        assert.match(res.body, /Unauthorized/)
    })

    test('POST initialize request returns 200, session ID, and event stream', async () => {
        const payload = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' }
            }
        })

        const res = await makeHttpRequest({
            hostname: '127.0.0.1',
            port: testPort,
            path: '/mcp',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${testToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream'
            }
        }, payload)

        assert.equal(res.statusCode, 200)
        assert.equal(res.headers['content-type'], 'text/event-stream')
        assert.ok(res.headers['mcp-session-id'], 'Response should contain mcp-session-id header')
        assert.match(res.body, /protocolVersion/)
    })

    test('POST tools/list with active Mcp-Session-Id returns 200 and list of tools', async () => {
        // 1. Initialize
        const initPayload = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' }
            }
        })

        const initRes = await makeHttpRequest({
            hostname: '127.0.0.1',
            port: testPort,
            path: '/mcp',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${testToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream'
            }
        }, initPayload)

        const sessionId = initRes.headers['mcp-session-id'] as string
        assert.ok(sessionId, 'Session ID required')

        // 2. tools/list
        const toolsPayload = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {}
        })

        const toolsRes = await makeHttpRequest({
            hostname: '127.0.0.1',
            port: testPort,
            path: '/mcp',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${testToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Mcp-Session-Id': sessionId,
                'Mcp-Protocol-Version': '2024-11-05'
            }
        }, toolsPayload)

        assert.equal(toolsRes.statusCode, 200)
        assert.match(toolsRes.body, /list_connections/)
        assert.match(toolsRes.body, /execute_command/)
    })

    test('POST request with non-existent Mcp-Session-Id returns 404', async () => {
        const payload = JSON.stringify({
            jsonrpc: '2.0',
            id: 10,
            method: 'tools/list',
            params: {}
        })

        const res = await makeHttpRequest({
            hostname: '127.0.0.1',
            port: testPort,
            path: '/mcp',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${testToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Mcp-Session-Id': 'non-existent-session-uuid-12345',
                'Mcp-Protocol-Version': '2024-11-05'
            }
        }, payload)

        assert.equal(res.statusCode, 404)
        assert.match(res.body, /Session not found/)
    })

    test('POST request with malformed JSON returns 400', async () => {
        const res = await makeHttpRequest({
            hostname: '127.0.0.1',
            port: testPort,
            path: '/mcp',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${testToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream'
            }
        }, '{ malformed json: true ')

        assert.equal(res.statusCode, 400)
        assert.match(res.body, /Parse error/)
    })

    test('POST request exceeding 1 MB limit returns 413 Payload Too Large', async () => {
        const largeLength = 2 * 1024 * 1024 // 2 MB
        const res = await makeHttpRequest({
            hostname: '127.0.0.1',
            port: testPort,
            path: '/mcp',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${testToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Content-Length': String(largeLength)
            }
        })

        assert.equal(res.statusCode, 413)
        assert.match(res.body, /Payload Too Large/)
    })
})
