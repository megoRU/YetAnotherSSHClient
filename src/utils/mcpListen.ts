import type { McpListenAddress } from '../types';

/**
 * Адреса прослушивания MCP-сервера.
 *
 * Значения повторяют `DEFAULT_MCP_LISTEN_ADDRESS` и `MCP_LISTEN_ADDRESS_ALL`
 * в `src-tauri/src/config.rs`: набор закрытый, оба конца читают один и тот же
 * список, а `normalize_mcp_listen_address` на стороне Rust отбрасывает всё
 * остальное. Дублирование неизбежно — константы живут в разных языках, —
 * поэтому проверка и значения собраны здесь, чтобы UI и миграция конфига
 * пользовались одним источником.
 */
export const MCP_LISTEN_ADDRESS_LOCAL: McpListenAddress = '127.0.0.1';
export const MCP_LISTEN_ADDRESS_ALL: McpListenAddress = '0.0.0.0';

/** Отсеивает значения, которых нет в списке адресов (в т.ч. `undefined`). */
export const isMcpListenAddress = (value: unknown): value is McpListenAddress =>
    value === MCP_LISTEN_ADDRESS_LOCAL || value === MCP_LISTEN_ADDRESS_ALL;

/**
 * Приводит значение из конфига к поддерживаемому адресу.
 *
 * Конфиг, записанный до появления настройки, поля не содержит — он
 * остаётся локальным, как и любой посторонний текст.
 */
export const resolveMcpListenAddress = (value: unknown): McpListenAddress =>
    isMcpListenAddress(value) ? value : MCP_LISTEN_ADDRESS_LOCAL;