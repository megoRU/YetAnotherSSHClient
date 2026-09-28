import type { McpLogItem } from './mcp-types.js'

/** Максимум событий, хранимых на одно подключение (старые вытесняются). */
const MAX_EVENTS_PER_CONNECTION = 200
/** Максимум подключений в буфере (наименее недавно использованные вытесняются). */
const MAX_CONNECTIONS = 50
/** Сколько ждать после последнего события, если на вкладку не смотрят. */
const IDLE_CLEAR_MS = 5 * 60 * 1000

/**
 * Кольцевой буфер событий `mcp-log` в main-процессе.
 *
 * Нужен потому, что события рассылаются только в открытые окна: если вкладка MCP
 * закрыта (или приложение свернуто и вкладка не смонтирована), события терялись,
 * и при открытии вкладки журнал действий агента был пуст. Буфер хранит историю
 * независимо от подписчиков, а вкладка при монтировании запрашивает её через
 * IPC-канал `mcp-get-logs` и дополняет живыми событиями.
 *
 * Пока вкладка открыта и активна, история не нужна — её уже держит renderer.
 * Как только вкладка закрылась или стала неактивной, каждое новое событие
 * продлевает отсчёт `IDLE_CLEAR_MS`, после чего история этого подключения
 * удаляется: фоновые события не копятся в памяти бесконечно.
 */
export class McpLogBuffer {
    private byConnection = new Map<string, McpLogItem[]>()
    private visible = new Set<string>()
    private idleTimers = new Map<string, ReturnType<typeof setTimeout>>()

    public append(log: McpLogItem): void {
        this.appendToConnection(log)
        this.scheduleIdleClear(log.connectionId)
    }

    /**
     * История по подключению в хронологическом порядке отправки.
     *
     * Отдаётся копией: внутренний массив меняется на месте (новые события,
     * вытеснение по кольцу, очистка по простою), а вызывающий код должен
     * получить стабильный снимок, а не ссылку на внутреннее состояние буфера.
     */
    public getLogs(connectionId: string): McpLogItem[] {
        const events = this.byConnection.get(connectionId);
        return events ? [...events] : [];
    }

    /**
     * Вкладка MCP сообщает, открыта ли она и активна ли сейчас.
     * `visible = true` — история не очищается по простою, `false` — очистится
     * через `IDLE_CLEAR_MS` после последнего события.
     */
    public setVisible(connectionId: string, isVisible: boolean): void {
        if (isVisible) {
            this.visible.add(connectionId)
            this.clearIdleTimer(connectionId)
            return
        }
        this.visible.delete(connectionId)
        this.scheduleIdleClear(connectionId)
    }

    private appendToConnection(log: McpLogItem): void {
        const events = this.byConnection.get(log.connectionId)
        if (events) {
            events.push(log)
            if (events.length > MAX_EVENTS_PER_CONNECTION) {
                events.splice(0, events.length - MAX_EVENTS_PER_CONNECTION)
            }
            // Обновляем позицию подключения в Map: оно стало «самым свежим».
            this.byConnection.delete(log.connectionId)
            this.byConnection.set(log.connectionId, events)
            return
        }

        if (this.byConnection.size >= MAX_CONNECTIONS) {
            const oldest = this.byConnection.keys().next()
            if (!oldest.done) this.evict(oldest.value)
        }
        this.byConnection.set(log.connectionId, [log])
    }

    private scheduleIdleClear(connectionId: string): void {
        if (this.visible.has(connectionId) || !this.byConnection.has(connectionId)) return
        this.clearIdleTimer(connectionId)
        this.idleTimers.set(connectionId, setTimeout(() => {
            this.idleTimers.delete(connectionId)
            this.byConnection.delete(connectionId)
        }, IDLE_CLEAR_MS))
    }

    private clearIdleTimer(connectionId: string): void {
        const timer = this.idleTimers.get(connectionId)
        if (timer) {
            clearTimeout(timer)
            this.idleTimers.delete(connectionId)
        }
    }

    private evict(connectionId: string): void {
        this.clearIdleTimer(connectionId)
        this.visible.delete(connectionId)
        this.byConnection.delete(connectionId)
    }
}

export const mcpLogBuffer = new McpLogBuffer()

/** Type guard для payload'а события `mcp-log`. */
export function isMcpLogItem(value: unknown): value is McpLogItem {
    if (!value || typeof value !== 'object') return false
    const item = value as Partial<McpLogItem>
    return typeof item.id === 'string' && typeof item.connectionId === 'string' && typeof item.kind === 'string'
}
