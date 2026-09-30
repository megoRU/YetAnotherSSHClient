import { describe, it, expect } from 'vitest'
import { mergeLogs } from '../src/utils/mcpLogs.js'
import type { McpLogItem, McpToolCallLog, McpLogStatus } from '../src/types.js'

const CONN = 'srv1'

const toolCall = (id: string, timestamp: number, status: McpLogStatus = 'pending'): McpToolCallLog => ({
    id,
    timestamp,
    connectionId: CONN,
    action: 'execute_command',
    kind: 'tool_call',
    status
})

/**
 * Гонка `mcp-get-logs` и `mcp-log` в реальном виде:
 *   1. вкладка подписалась на `mcp-log` и запросила журнал (`mcp-get-logs`);
 *   2. backend снял снимок истории и начал готовить ответ;
 *   3. пока ответ в пути, пришли живые события (в т.ч. обновление вызова,
 *      который уже был в снимке);
 *   4. вкладка получила ответ и слила его со своим состоянием.
 */
const raceHistory = (eventsDuringFlight: McpLogItem[]): McpLogItem[][] => {
    const buffer: McpLogItem[] = [toolCall('call1', 100, 'pending')]

    // ответ `mcp-get-logs`: снапшот журнала на момент обработки запроса
    const history = [...buffer]
    // ...пока ответ летит в renderer, события уже приходят вживую
    buffer.push(...eventsDuringFlight)
    const live = buffer.filter(event => !history.some(h => h.id === event.id && h.timestamp === event.timestamp))
    return [history, live]
}

describe('mergeLogs: гонка mcp-get-logs и mcp-log', () => {
    it('не теряет событие, пришедшее во время запроса истории', () => {
        const history = [toolCall('call1', 100)]
        const live = [toolCall('call2', 200)]

        const merged = mergeLogs(history, live)
        expect(merged.map(l => l.id)).toEqual(['call2', 'call1'])
    })

    it('показывает обновление вызова, начатого до запроса истории', () => {
        const [history, live] = raceHistory([toolCall('call1', 200, 'running')])

        const merged = mergeLogs(history, live)
        expect(merged).toHaveLength(1)
        expect(merged[0].id).toBe('call1')
        expect(merged[0].status).toBe('running')
    })

    it('не затирает живое обновление версией из истории', () => {
        const history = [toolCall('call1', 100, 'pending')]
        const live = [toolCall('call1', 200, 'success')]

        const merged = mergeLogs(history, live)
        expect(merged).toHaveLength(1)
        expect(merged[0].status).toBe('success')
        expect(merged[0].timestamp).toBe(200)
    })

    it('не дублирует вызов, который пришёл и в истории, и вживую', () => {
        const same = toolCall('call1', 100, 'pending')
        const merged = mergeLogs([same], [same])

        expect(merged).toHaveLength(1)
    })

    it('снимок истории не меняется от событий, пришедших после него', () => {
        const [history, live] = raceHistory([toolCall('call2', 200), toolCall('call1', 300, 'running')])

        // история — стабильный снимок на момент ответа
        expect(history.map(l => l.id)).toEqual(['call1'])
        expect(history[0].status).toBe('pending')

        const merged = mergeLogs(history, live)
        expect(merged.map(l => l.id)).toEqual(['call1', 'call2'])
        expect(merged[0].status).toBe('running')
    })

    it('пустая история не теряет живые события', () => {
        const live = [toolCall('call1', 100)]

        expect(mergeLogs([], live).map(l => l.id)).toEqual(['call1'])
    })
})
