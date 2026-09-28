import type { McpAgent } from '../types';

/** Имя тестового MCP-клиента: в UI он не показывается. */
const FALLBACK_TEST_AGENT = 'mcp-remote-fallback-test';

/**
 * Ключ агента для склейки дублей.
 *
 * Каждый запуск MCP-клиента создаёт свою сессию, поэтому один и тот же агент
 * (например opencode) присутствует в статусе несколько раз. В интерфейсе это
 * один агент, а не несколько одинаковых плашек.
 */
export const agentKey = (agent: McpAgent): string => `${agent.name}\u0000${agent.version || ''}`;

/**
 * Нормализованная коллекция агентов для UI: без дублей и тестового клиента,
 * от свежих к старым (`lastSeen` по убыванию).
 *
 * Из нескольких сессий одного агента остаётся самая свежая.
 */
export const collectAgents = (agents: McpAgent[] | undefined): McpAgent[] => {
    const unique = new Map<string, McpAgent>();

    for (const agent of agents || []) {
        const name = String(agent.name || '');
        if (name.includes(FALLBACK_TEST_AGENT)) continue;

        const key = agentKey(agent);
        const current = unique.get(key);
        if (!current || (agent.lastSeen || 0) > (current.lastSeen || 0)) {
            unique.set(key, agent);
        }
    }

    return Array.from(unique.values()).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
};
