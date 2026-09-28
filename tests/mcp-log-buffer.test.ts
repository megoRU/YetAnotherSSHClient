import { describe, it, expect, vi, afterEach } from 'vitest'
import { McpLogBuffer, isMcpLogItem, mcpLogBuffer } from '../electron/src/mcp/log-buffer.js'
import type { McpLogItem, McpToolCallLog } from '../src/types.js'

const toolCall = (id: string, connectionId: string, timestamp: number): McpToolCallLog => ({
    id,
    timestamp,
    connectionId,
    action: 'execute_command',
    kind: 'tool_call',
    status: 'pending'
})

describe('McpLogBuffer', () => {
    it('накапливает события без подписчиков (вкладка закрыта)', () => {
        const buffer = new McpLogBuffer()
        buffer.append(toolCall('a1', 'srv1', 1))
        buffer.append(toolCall('a2', 'srv1', 2))

        const logs = buffer.getLogs('srv1')
        expect(logs.map(l => l.id)).toEqual(['a1', 'a2'])
    })

    it('разделяет историю по подключениям', () => {
        const buffer = new McpLogBuffer()
        buffer.append(toolCall('a1', 'srv1', 1))
        buffer.append(toolCall('b1', 'srv2', 2))

        expect(buffer.getLogs('srv1').map(l => l.id)).toEqual(['a1'])
        expect(buffer.getLogs('srv2').map(l => l.id)).toEqual(['b1'])
        expect(buffer.getLogs('unknown')).toEqual([])
    })

    it('вытесняет самые старые события при переполнении', () => {
        const buffer = new McpLogBuffer()
        for (let i = 0; i < 260; i++) {
            buffer.append(toolCall(`a${i}`, 'srv1', i))
        }

        const logs = buffer.getLogs('srv1')
        expect(logs).toHaveLength(200)
        expect(logs[0].id).toBe('a60')
        expect(logs[logs.length - 1].id).toBe('a259')
    })

    it('не отбрасывает историю активных подключений при множестве серверов', () => {
        const buffer = new McpLogBuffer()
        for (let i = 0; i < 60; i++) {
            buffer.append(toolCall(`a${i}`, `srv${i}`, i))
        }
        // srv59 — самое свежее подключение, его история обязана сохраниться
        expect(buffer.getLogs('srv59').map(l => l.id)).toEqual(['a59'])
    })

    it('отдаёт копию: снимок не меняется от следующих событий', () => {
        const buffer = new McpLogBuffer()
        buffer.append(toolCall('a1', 'srv1', 1))

        const snapshot = buffer.getLogs('srv1')
        buffer.append(toolCall('a2', 'srv1', 2))
        // без копии здесь был бы массив из двух событий — ссылка на внутреннее состояние
        expect(snapshot.map(l => l.id)).toEqual(['a1'])
        expect(buffer.getLogs('srv1').map(l => l.id)).toEqual(['a1', 'a2'])
    })

    it('отдаёт копию: правка результата не портит буфер', () => {
        const buffer = new McpLogBuffer()
        buffer.append(toolCall('a1', 'srv1', 1))

        const logs = buffer.getLogs('srv1')
        logs.length = 0
        logs.push(toolCall('hacked', 'srv1', 99))

        expect(buffer.getLogs('srv1').map(l => l.id)).toEqual(['a1'])
    })

    it('общий экземпляр буфера доступен для обработчиков IPC', () => {
        expect(typeof mcpLogBuffer.append).toBe('function')
        expect(typeof mcpLogBuffer.getLogs).toBe('function')
    })
})

describe('McpLogBuffer: очистка по простою', () => {
    const FIVE_MIN = 5 * 60 * 1000

    afterEach(() => {
        vi.useRealTimers()
    })

    it('хранит историю, пока вкладка открыта и активна', () => {
        vi.useFakeTimers()
        const buffer = new McpLogBuffer()
        buffer.setVisible('srv1', true)
        buffer.append(toolCall('a1', 'srv1', 1))

        vi.advanceTimersByTime(FIVE_MIN * 10)
        expect(buffer.getLogs('srv1').map(l => l.id)).toEqual(['a1'])
    })

    it('очищает историю через 5 минут после последнего события, если вкладка не активна', () => {
        vi.useFakeTimers()
        const buffer = new McpLogBuffer()
        buffer.append(toolCall('a1', 'srv1', 1))

        vi.advanceTimersByTime(FIVE_MIN - 1)
        expect(buffer.getLogs('srv1')).toHaveLength(1)

        vi.advanceTimersByTime(1)
        expect(buffer.getLogs('srv1')).toEqual([])
    })

    it('продлевает отсчёт при новых фоновых событиях', () => {
        vi.useFakeTimers()
        const buffer = new McpLogBuffer()
        for (let i = 0; i < 6; i++) {
            buffer.append(toolCall(`a${i}`, 'srv1', i))
            vi.advanceTimersByTime(FIVE_MIN - 1)
        }
        expect(buffer.getLogs('srv1')).toHaveLength(6)

        vi.advanceTimersByTime(FIVE_MIN)
        expect(buffer.getLogs('srv1')).toEqual([])
    })

    it('запускает очистку, когда активная вкладка закрылась', () => {
        vi.useFakeTimers()
        const buffer = new McpLogBuffer()
        buffer.setVisible('srv1', true)
        buffer.append(toolCall('a1', 'srv1', 1))
        vi.advanceTimersByTime(FIVE_MIN * 3)
        expect(buffer.getLogs('srv1')).toHaveLength(1)

        buffer.setVisible('srv1', false)
        vi.advanceTimersByTime(FIVE_MIN - 1)
        expect(buffer.getLogs('srv1')).toHaveLength(1)

        vi.advanceTimersByTime(1)
        expect(buffer.getLogs('srv1')).toEqual([])
    })

    it('отменяет очистку, если вкладку снова открыли', () => {
        vi.useFakeTimers()
        const buffer = new McpLogBuffer()
        buffer.append(toolCall('a1', 'srv1', 1))
        buffer.setVisible('srv1', true)

        vi.advanceTimersByTime(FIVE_MIN * 5)
        expect(buffer.getLogs('srv1').map(l => l.id)).toEqual(['a1'])
    })

    it('не трогает историю других подключений', () => {
        vi.useFakeTimers()
        const buffer = new McpLogBuffer()
        buffer.append(toolCall('a1', 'srv1', 1))
        buffer.append(toolCall('b1', 'srv2', 2))
        buffer.setVisible('srv2', true)

        vi.advanceTimersByTime(FIVE_MIN)
        expect(buffer.getLogs('srv1')).toEqual([])
        expect(buffer.getLogs('srv2').map(l => l.id)).toEqual(['b1'])
    })
})

describe('isMcpLogItem', () => {
    it('принимает событие журнала', () => {
        expect(isMcpLogItem(toolCall('a1', 'srv1', 1))).toBe(true)
    })

    it('отсеивает посторонние payload-ы', () => {
        expect(isMcpLogItem(null)).toBe(false)
        expect(isMcpLogItem('mcp-log')).toBe(false)
        expect(isMcpLogItem({ id: 'a1', connectionId: 'srv1' })).toBe(false)
        expect(isMcpLogItem({ kind: 'tool_call' })).toBe(false)
    })

    it('сужает тип до McpLogItem', () => {
        const value: unknown = toolCall('a1', 'srv1', 1)
        if (isMcpLogItem(value)) {
            const log: McpLogItem = value
            expect(log.kind).toBe('tool_call')
        } else {
            throw new Error('ожидался McpLogItem')
        }
    })
})
