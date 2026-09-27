import type { SSHConfig } from '../types';

export const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2, 11);
};

/**
 * Добавляет сервер в избранное либо обновляет уже сохранённый.
 *
 * Сопоставление идёт только по `id`: новый сервер (без `id`) всегда
 * добавляется отдельной записью. Сверка по host/user/port затирала
 * уже сохранённый сервер (вместе с его паролем и ключом в хранилище),
 * а при правке сервера — переписывала чужую запись с тем же адресом.
 */
export const upsertFavorite = (favorites: SSHConfig[], favorite: SSHConfig): SSHConfig[] => {
    const existingIndex = favorite.id
        ? favorites.findIndex(f => f.id === favorite.id)
        : -1;

    if (existingIndex < 0) {
        return [...favorites, favorite];
    }

    const result = [...favorites];
    result[existingIndex] = favorite;
    return result;
};

export const getOSIcon = (osPrettyName?: string) => {
    if (!osPrettyName) return './icons/os/default.svg';
    const name = osPrettyName.toLowerCase();
    if (name.includes('ubuntu')) return './icons/os/ubuntu.svg';
    if (name.includes('debian')) return './icons/os/debian.svg';
    if (name.includes('centos')) return './icons/os/centos.svg';
    if (name.includes('fedora')) return './icons/os/fedora.svg';
    if (name.includes('alma')) return './icons/os/alma.svg';
    if (name.includes('rocky')) return './icons/os/rocky.svg';
    if (name.includes('arch')) return './icons/os/arch.svg';
    if (name.includes('alpine')) return './icons/os/alpine.svg';
    return './icons/os/default.svg';
};

export const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const normalizeRemotePath = (p: string) => {
    if (!p) return '/';
    const normalized = p.replace(/\/+/g, '/').replace(/\/$/, '');
    return normalized || '/';
};

export const stripHtml = (html: string | undefined | null) => {
    if (!html) return '';
    return html
        .replace(/<\/li>|<\/h2>|<\/ul>|<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => `• ${line}`)
        .join('\n');
};

export const playSuccessSound = (volume: number = 0.5) => {
    const audio = new Audio('./sound/success.wav');
    audio.volume = Math.min(1, Math.max(0, volume));
    audio.play().catch(err => console.error('Failed to play success sound:', err));
};
