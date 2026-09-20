import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { McpStatus } from '../../../../src/types.js'
import { executeCommandTool } from '../execute-command-service.js'

export function installExecuteCommandTool(
    server: McpServer,
    getMcpStatusFn: () => McpStatus
): void {
    server.registerTool(
        'execute_command',
        {
            description: 'Execute a bash/shell command on an allowed SSH connection and return stdout, stderr, and exit code. If multiple connections are open, connection_id is strictly required.',
            inputSchema: {
                connection_id: z.string().optional().describe('The SSH connection ID (required if multiple connections are open for MCP access).'),
                command: z.string().min(1).describe('The shell command to execute on the SSH server.')
            }
        },
        async (args, extra) => {
            const command = args.command.trim()
            if (!command) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'Command argument is required' }]
                }
            }

            const response = await executeCommandTool({
                args,
                command,
                sessionId: extra.sessionId || '',
                getMcpStatusFn
            })

            return {
                isError: response.isError,
                content: [{ type: 'text', text: response.text }]
            }
        }
    )
}