import type { SSHConfig, SshConnectPayload } from '../types.js'

export type { SshConnectPayload }

/** Данные, отправляемые из рендерера в main при вводе в открытую SSH-сессию. */
export interface SshInputPayload {
    id: string;
    data: string;
}

/** Данные для изменения размеров PTY открытой SSH-сессии. */
export interface SshResizePayload {
    id: string;
    cols: number;
    rows: number;
}

/** Запрос на запуск перенаправления портов (ssh-forward-start). */
export interface SshForwardStartPayload {
    id: string;
    config: SSHConfig;
    localAddress: string;
    localPort: number;
    remoteAddress: string;
    remotePort: number;
}