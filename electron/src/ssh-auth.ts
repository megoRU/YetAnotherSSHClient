import type { IpcMainEvent } from 'electron'
import type { SSHConfig } from '../../src/types.js'
import type { SshAuthChallenge, SshAuthChallengeKind } from '../../src/ipc/ssh.js'
import { MAX_AUTH_ATTEMPTS } from '../../src/ipc/ssh.js'

export { MAX_AUTH_ATTEMPTS }

/** Тип завершителя keyboard-interactive, который ssh2 ждёт в текущей попытке. */
export type KeyboardInteractiveFinisher = (responses: string[]) => void

/** Ответ на запрос keyboard-interactive: подставляет введённое значение вместо одного приглашения. */
export type KeyboardInteractiveAnswerer = (secret: string) => void

/**
 * Формирует массив ответов для ssh2: сервер ждёт по одному ответу на каждое
 * приглашение, введённое значение подставляется к первому.
 */
export function buildKeyboardResponses(secret: string, promptCount: number): string[] {
    const size = Math.max(promptCount, 1)
    return [secret, ...new Array<string>(size - 1).fill('')]
}

interface SshAuthState {
    /** Конфигурация последней попытки подключения. */
    config: SSHConfig;
    cols: number;
    rows: number;
    /** Номер текущей попытки ввода, начиная с 1. */
    attempt: number;
    /** Ответчик, если сервер ждёт ответа в рамках текущего SSH-соединения. */
    answer?: KeyboardInteractiveAnswerer;
}

const authStates = new Map<string, SshAuthState>()

/**
 * Сохраняет параметры текущей попытки подключения, чтобы ответ пользователя
 * можно было применить без запроса конфигурации у рендерера.
 *
 * @param {number} attempt - Число уже выданных запросов авторизации (0 — первый запрос).
 */
export function beginAuthAttempt(
    id: string,
    config: SSHConfig,
    cols: number,
    rows: number,
    attempt: number
): void {
    authStates.set(id, { config, cols, rows, attempt })
}

/** Возвращает состояние текущей попытки авторизации (null, если её нет). */
export function getAuthState(id: string): SshAuthState | null {
    return authStates.get(id) ?? null
}

/** Сбрасывает состояние авторизации: подключение завершено, отменено или закрыто. */
export function clearAuthState(id: string): void {
    authStates.delete(id)
}

/**
 * Запоминает ответчик на запрос keyboard-interactive для текущего соединения.
 * ssh2 ждёт столько ответов, сколько приглашений прислал сервер: введённое
 * значение подставляется к первому приглашению, остальные остаются пустыми.
 */
export function setKeyboardFinisher(
    id: string,
    finish: KeyboardInteractiveFinisher,
    promptCount: number
): void {
    const state = authStates.get(id)
    if (!state) return
    state.answer = secret => finish(buildKeyboardResponses(secret, promptCount))
}

/**
 * Забирает ответчик на keyboard-interactive (одноразово): ответ на такой запрос
 * не требует переподключения.
 */
export function takeKeyboardFinisher(id: string): KeyboardInteractiveAnswerer | null {
    const state = authStates.get(id)
    const answer = state?.answer ?? null
    if (state) delete state.answer
    return answer
}

/**
 * Отправляет рендереру запрос авторизации и возвращает номер выданной попытки.
 * Попытки считаются по факту запросов, поэтому лимит ограничивает и повторные
 * подсказки сервера, и повторный ввод после неудачной авторизации.
 */
export function requestAuthChallenge(
    event: IpcMainEvent,
    id: string,
    kind: SshAuthChallengeKind,
    extra: { prompt?: string; instructions?: string; failed?: boolean } = {}
): number {
    const state = authStates.get(id)
    const attempt = (state?.attempt ?? 0) + 1
    if (state) state.attempt = attempt

    const challenge: SshAuthChallenge = { kind, attempt }
    if (extra.prompt) challenge.prompt = extra.prompt
    if (extra.instructions) challenge.instructions = extra.instructions
    if (extra.failed !== undefined) challenge.failed = extra.failed

    event.reply(`ssh-auth-challenge-${id}`, challenge)
    return attempt
}
