export const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2, 11);
};

export const toBase64 = (str: string) => {
    try {
        const uint8Array = new TextEncoder().encode(str);
        let binString = "";
        uint8Array.forEach((byte) => {
            binString += String.fromCharCode(byte);
        });
        return btoa(binString);
    } catch {
        return btoa(str);
    }
};

export const fromBase64 = (str: string) => {
    try {
        const binString = atob(str);
        const uint8Array = Uint8Array.from(binString, (m) => m.codePointAt(0)!);
        return new TextDecoder().decode(uint8Array);
    } catch (e) {
        console.error(e);
        try {
            return atob(str);
        } catch (e2) {
            console.error(e2);
            return str;
        }
    }
};

export const getOSIcon = (osPrettyName?: string) => {
    if (!osPrettyName) return './icons/os/default.svg';
    const name = osPrettyName.toLowerCase();
    if (name.includes('ubuntu')) return './icons/os/ubuntu.svg';
    if (name.includes('debian')) return './icons/os/debian.svg';
    if (name.includes('centos')) return './icons/os/centos.svg';
    if (name.includes('fedora')) return './icons/os/fedora.svg';
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
    const audio = new Audio('/sound/success.wav');
    audio.volume = Math.min(1, Math.max(0, volume));
    audio.play().catch(err => console.error('Failed to play success sound:', err));
};
