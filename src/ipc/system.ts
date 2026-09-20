import type { AppConfig, LocalTerminalStartPayload, LocalTerminalStartResult } from '../types.js'

export type { AppConfig, LocalTerminalStartPayload, LocalTerminalStartResult }

/** Конфигурация, сохраняемая через IPC (save-config). */
export type SaveConfigPayload = AppConfig;

/** Результат импорта конфигурации (import-config). */
export interface ImportConfigResult {
    config: AppConfig;
}

/** Статус локального файла/папки (fs-stat). */
export interface FsStatResult {
    isDir: boolean;
    size: number;
}

/** Данные для ввода в локальный терминал (local-terminal-input). */
export interface LocalTerminalInputPayload {
    id: string;
    data: string;
}

/** Данные для изменения размеров локального терминала (local-terminal-resize). */
export interface LocalTerminalResizePayload {
    id: string;
    cols: number;
    rows: number;
}

/** Сообщение лога от рендерера (log-renderer-msg). */
export interface RendererLogMessage {
    level?: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
    message: string;
}