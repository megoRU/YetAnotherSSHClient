import { describe, it, expect } from 'vitest'
import { agentKey, collectAgents } from '../src/utils/mcpAgents.js'
import type { McpAgent } from '../src/types.js'

const agent = (id: string, name: string, version: string | undefined, lastSeen: number): McpAgent => ({
    id,
    name,
    version,
    lastSeen
})

describe('collectAgents', () => {
    it('склеивает сессии одного агента в одну плашку', () => {
        const agents = [
            agent('s1', 'opencode', '1.0.0', 100),
            agent('s2', 'opencode', '1.0.0', 300),
            agent('s3', 'opencode', '1.0.0', 200)
        ]

        expect(collectAgents(agents)).toHaveLength(1)
    })

    it('оставляет самую свежую сесию дубля', () => {
        const agents = [
            agent('s1', 'opencode', '1.0.0', 100),
            agent('s3', 'opencode', '1.0.0', 300),
            agent('s2', 'opencode', '1.0.0', 200)
        ]

        expect(collectAgents(agents).map(a => a.id)).toEqual(['s3'])
        expect(collectAgents(agents)[0].lastSeen).toBe(300)
    })

    it('различает агентов по имени и версии', () => {
        const agents = [
            agent('s1', 'opencode', '1.0.0', 100),
            agent('s2', 'opencode', '1.1.0', 200),
            agent('s3', 'claude', '1.0.0', 300)
        ]

        expect(collectAgents(agents).map(a => a.id)).toEqual(['s3', 's2', 's1'])
    })

    it('склеивает агентов без версии', () => {
        const agents = [
            agent('s1', 'opencode', undefined, 100),
            agent('s2', 'opencode', undefined, 200)
        ]

        expect(collectAgents(agents).map(a => a.id)).toEqual(['s2'])
    })

    it('сортирует от свежих к старым', () => {
        const agents = [
            agent('s1', 'a', '1', 100),
            agent('s2', 'b', '1', 300),
            agent('s3', 'c', '1', 200)
        ]

        expect(collectAgents(agents).map(a => a.id)).toEqual(['s2', 's3', 's1'])
    })

    it('прячет тестового клиента', () => {
        const agents = [
            agent('s1', 'mcp-remote-fallback-test', '1.0.0', 400),
            agent('s2', 'opencode', '1.0.0', 100)
        ]

        expect(collectAgents(agents).map(a => a.id)).toEqual(['s2'])
    })

    it('не падает на пустом и отсутствующем списке', () => {
        expect(collectAgents(undefined)).toEqual([])
        expect(collectAgents([])).toEqual([])
    })
})

describe('agentKey', () => {
    it('одинаков для сессий одного агента', () => {
        expect(agentKey(agent('s1', 'opencode', '1.0.0', 1)))
            .toBe(agentKey(agent('s2', 'opencode', '1.0.0', 2)))
    })

    it('различается для разных версий', () => {
        expect(agentKey(agent('s1', 'opencode', '1.0.0', 1)))
            .not.toBe(agentKey(agent('s2', 'opencode', '1.1.0', 1)))
    })
})
