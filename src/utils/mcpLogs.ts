import type { McpLogItem } from '../types';

/**
 * Слияние истории из main-процесса с живыми событиями, полученными по `mcp-log`.
 *
 * Вкладка подписывается на `mcp-log` и параллельно запрашивает накопленную
 * историю (`mcp-get-logs`). Пока ответ идёт, в журнал успевают прийти новые
 * события — в том числе обновления уже начатого вызова инструмента. Один и тот же
 * вызов приходит с одним и тем же `id`, поэтому побеждает более поздняя версия
 * события, а список собирается от новых к старым.
 */
export const mergeLogs = (history: McpLogItem[], live: McpLogItem[]): McpLogItem[] => {
    const byId = new Map<string, McpLogItem>();

    for (const item of history) byId.set(item.id, item);
    for (const item of live) byId.set(item.id, item);

    return Array.from(byId.values()).sort((a, b) => b.timestamp - a.timestamp);
};
