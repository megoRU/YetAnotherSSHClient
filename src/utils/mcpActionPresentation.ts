import type { Language } from './i18n';

export const formatDuration = (ms: number, language: Language): string => {
    const value = Math.max(0, ms);
    if (value < 1000) return language === 'en' ? `${Math.round(value)} ms` : `${Math.round(value)} мс`;
    const sec = value / 1000;
    if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)} ${language === 'en' ? 'sec' : 'сек'}`;
    const minutes = Math.floor(sec / 60);
    const rest = Math.round(sec % 60);
    return language === 'en' ? `${minutes} min ${rest} sec` : `${minutes} мин ${rest} сек`;
};

export const L = (ru: string, en: string, language: Language): string => (language === 'en' ? en : ru);

export type ActionStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export interface ActionCard {
    runId: string;
    toolName?: string;
    command?: string;
    args?: unknown;
    status: ActionStatus;
    timestamp: number;
    startedAt?: number;
    durationMs?: number;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    error?: string;
}

export const ruPlural = (n: number, one: string, few: string, many: string): string => {
    const abs = Math.abs(n) % 100;
    const d = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (d > 1 && d < 5) return few;
    if (d === 1) return one;
    return many;
};
