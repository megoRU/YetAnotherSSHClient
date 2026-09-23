import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../electron/src/config.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../electron/src/config.js')>()
    return {
        ...actual,
        loadConfig: vi.fn()
    }
})

vi.mock('../electron/src/mcp/session-manager.js', () => ({
    sessionManager: { hasTransport: vi.fn() }
}))

import { recheckAuthorizationBeforeExecution } from '../electron/src/mcp/ssh-executor.js'
import { loadConfig, DEFAULT_CONFIG } from '../electron/src/config.js'
import { sessionManager } from '../electron/src/mcp/session-manager.js'
import type { AppConfig, SSHConfig } from '../src/types.js'

const SERVER_ID = 'conn-1'

function server(partial: Partial<SSHConfig> = {}): SSHConfig {
    return { id: SERVER_ID, name: 'prod', user: 'root', host: 'prod.example.com', port: 22, ...partial }
}

function appConfig(options: { mcpEnabled?: boolean; allowed?: string[]; favorites?: SSHConfig[] }): AppConfig {
    return {
        ...DEFAULT_CONFIG,
        mcpEnabled: options.mcpEnabled ?? true,
        mcpAllowedServerIds: options.allowed ?? [SERVER_ID],
        favorites: options.favorites ?? [server()]
    }
}

describe('recheckAuthorizationBeforeExecution', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(loadConfig).mockReturnValue(appConfig({}))
        vi.mocked(sessionManager.hasTransport).mockReturnValue(true)
    })

    it('отклоняет, если MCP сервер отключён', () => {
        vi.mocked(loadConfig).mockReturnValue(appConfig({ mcpEnabled: false }))
        const result = recheckAuthorizationBeforeExecution(SERVER_ID, 'sess')
        expect(result).toEqual({ authorized: false, reason: 'MCP server is disabled' })
    })

    it('отклоняет несуществующую сессию (при переданном sessionId)', () => {
        vi.mocked(sessionManager.hasTransport).mockReturnValue(false)
        const result = recheckAuthorizationBeforeExecution(SERVER_ID, 'sess')
        expect(result).toEqual({ authorized: false, reason: 'MCP session is no longer active' })
    })

    it('пропускает проверку сессии, если sessionId не передан', () => {
        vi.mocked(sessionManager.hasTransport).mockImplementation(() => {
            throw new Error('hasTransport не должен вызываться без sessionId')
        })
        const result = recheckAuthorizationBeforeExecution(SERVER_ID)
        expect(result.authorized).toBe(true)
    })

    it('отклоняет сервер, которого нет в mcpAllowedServerIds', () => {
        vi.mocked(loadConfig).mockReturnValue(appConfig({ allowed: ['other-id'] }))
        const result = recheckAuthorizationBeforeExecution(SERVER_ID)
        expect(result).toEqual({ authorized: false, reason: `Server '${SERVER_ID}' is not authorized for MCP access` })
    })

    it('отклоняет id, который разрешён, но отсутствует в favorites', () => {
        vi.mocked(loadConfig).mockReturnValue(appConfig({ favorites: [] }))
        const result = recheckAuthorizationBeforeExecution(SERVER_ID)
        expect(result).toEqual({ authorized: false, reason: `Server '${SERVER_ID}' not found in configuration` })
    })

    it('разрешает выполнение и возвращает сервер', () => {
        const result = recheckAuthorizationBeforeExecution(SERVER_ID, 'sess')
        expect(result.authorized).toBe(true)
        expect(result.server?.id).toBe(SERVER_ID)
    })

    it('allowlist пуста по умолчанию — доступ закрыт', () => {
        vi.mocked(loadConfig).mockReturnValue(appConfig({ allowed: [] }))
        expect(recheckAuthorizationBeforeExecution(SERVER_ID).authorized).toBe(false)
    })
})