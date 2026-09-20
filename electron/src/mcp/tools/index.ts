import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { installListConnectionsTool } from './list-connections.js'
import { installExecuteCommandTool } from './execute-command.js'

export function registerMcpTools(
    server: McpServer,
    getMcpStatusFn?: () => unknown
): void {
    installListConnectionsTool(server)
    installExecuteCommandTool(server, getMcpStatusFn)
}