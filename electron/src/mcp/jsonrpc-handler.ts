import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpStatus } from '../../../src/types.js'
import { VERSION } from '../../../src/types.js'
import { registerMcpTools } from './tools/index.js'

export function createMcpServerInstance(getMcpStatusFn: () => McpStatus) {
    const server = new McpServer({
        name: 'YetAnotherSSHClient-MCP',
        version: VERSION
    })

    registerMcpTools(server, getMcpStatusFn)

    return server
}