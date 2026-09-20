import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpStatus } from '../../../../src/types.js'
import { installListConnectionsTool } from './list-connections.js'
import { installExecuteCommandTool } from './execute-command.js'

export function registerMcpTools(
    server: McpServer,
    getMcpStatusFn: () => McpStatus
): void {
    installListConnectionsTool(server)
    installExecuteCommandTool(server, getMcpStatusFn)
}