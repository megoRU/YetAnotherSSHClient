import type { UpdateInfo, UpdateProgress, UpdateStatus } from '../types.js'

export type { UpdateInfo, UpdateProgress, UpdateStatus }

/** Результат проверки наличия обновлений (check-updates). */
export interface CheckUpdateResult {
    available: boolean;
    version?: string;
    url?: string;
    releaseNotes?: string;
    error?: string;
}

/** Результат запуска загрузки обновления (start-update-download). */
export type DownloadUpdateResult = string[];