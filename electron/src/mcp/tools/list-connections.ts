import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { loadConfig } from '../../config.js'

export function installListConnectionsTool(server: McpServer): void {
    server.registerTool(
        'list_connections',
        {
            description: 'Get list of saved SSH connections enabled for MCP access.',
            inputSchema: {}
        },
        async () => {
            const config = loadConfig()
            if (!config.mcpEnabled) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'MCP server is disabled.' }]
                }
            }

            const allowedIds = new Set(config.mcpAllowedServerIds || [])
            const allowedFavorites = (config.favorites || []).filter(f => f.id && allowedIds.has(f.id))

            const connectionsList = allowedFavorites.map(f => ({
                id: f.id,
                name: f.name || f.host,
                host: f.host,
                user: f.user,
                port: f.port || 22,
                osPrettyName: f.osPrettyName
            }))

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ connections: connectionsList }, null, 2)
                    }
                ]
            }
        }
    )
}