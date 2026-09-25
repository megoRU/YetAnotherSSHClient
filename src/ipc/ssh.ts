import type { EncryptedSecret, SSHConfig, SshConnectPayload } from '../types.js'

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

/**
 * Статус SSH, означающий, что в конфигурации подключения нет логина: подключение
 * не начинается, рендерер показывает форму ввода логина.
 */
export const LOGIN_REQUIRED_STATUS = 'LOGIN_REQUIRED';

/** Проверяет, что статус означает «требуется логин». */
export function isLoginRequiredStatus(status: string): boolean {
    return status === LOGIN_REQUIRED_STATUS;
}

/** Тип запроса авторизации, инициированного сервером или ключом. */
export type SshAuthChallengeKind = 'password' | 'keyboard' | 'passphrase';

/** Сколько раз подряд пользователь может вводить данные авторизации для одного подключения. */
export const MAX_AUTH_ATTEMPTS = 3;

/** Запрос авторизации, отправленный рендереру через `ssh-auth-challenge-${id}`. */
export interface SshAuthChallenge {
    /** Что именно требуется от пользователя. */
    kind: SshAuthChallengeKind;
    /** Номер попытки ввода, начиная с 1. */
    attempt: number;
    /** Текст приглашения сервера (keyboard-interactive). */
    prompt?: string;
    /** Пояснение сервера (keyboard-interactive). */
    instructions?: string;
    /** Показывать ли серверу, что это не первая попытка. */
    failed?: boolean;
}

/** Ответ рендерера на запрос авторизации. */
export type SshAuthResponse =
    /** Пароль или парольная фраза: применяется к текущей попытке подключения. */
    | { id: string; response: 'secret'; kind: SshAuthChallengeKind; secret: string }
    /** Приватный ключ, введённый пользователем: подключение перезапускается с ним. */
    | { id: string; response: 'privateKey'; privateKey: EncryptedSecret }
    /** Пользователь отказался вводить данные: подключение прерывается. */
    | { id: string; response: 'cancel' };

/**
 * Учётные данные, введённые пользователем в текущей вкладке.
 * Хранятся в памяти компонента и подставляются в payload подключения;
 * сохранение в конфиг выполняется отдельно (см. onCredentialsEntered).
 */
export interface SessionCredentials {
    user?: string;
    password?: string;
    keyPassphrase?: string;
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