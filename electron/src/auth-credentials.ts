import { type ConnectConfig } from 'ssh2'
import type { EncryptedSecret, SSHConfig } from '../../src/types.js'
import { initializeVaultAndMigrate, loadConfig } from './config.js'
import { t } from './i18n-main.js'
import {
    decryptSessionSecret,
    isEncryptedPrivateKeyContent,
    LocalizedError,
    PrivateKeyError,
    resolvePrivateKey,
    tryDecryptEncryptedSecret
} from './private-key.js'
import { vault } from './vault.js'

/**
 * Данные, введённые пользователем в текущей сессии (форма логина или запрос авторизации
 * от сервера). Имеют приоритет над сохранёнными значениями и не пишутся в конфиг.
 */
export interface SessionAuth {
    /** Пароль, введённый в ответ на запрос сервера. */
    password?: string;
    /** Парольная фраза зашифрованного приватного ключа. */
    keyPassphrase?: string;
    /** Приватный ключ, введённый пользователем вместо пароля (зашифрованный blob). */
    privateKey?: EncryptedSecret;
}

/**
 * Логин обязателен для подключения: без него ssh2 отправляет серверу пустое имя
 * пользователя. Единственная причина прервать подключение до TCP — отсутствие логина.
 * Пароль запрашивает сам сервер (keyboard-interactive или отказ авторизации),
 * поэтому он проверяется не здесь.
 */
export function isLoginRequired(config: SSHConfig): boolean {
    return !config.user?.trim()
}

/**
 * Заполняет ConnectConfig учётными данными строго по config.authType:
 * 'key' -> только privateKey (фолбэка на пароль нет), 'password' -> только password.
 * Используется всеми точками подключения (SSH-терминал, SFTP, port-forwarding, MCP),
 * чтобы ssh2 не выбирал метод авторизации из «двух доступных» произвольным образом.
 *
 * Данные из `session` (введённые пользователем в этой вкладке) имеют приоритет над
 * сохранёнными. Если ключ зашифрован, а парольная фраза неизвестна, выбрасывается
 * PrivateKeyError с failure 'passphrase' — вызывающий код запрашивает её у пользователя.
 */
export function applyAuthConfig(config: SSHConfig, connectConfig: ConnectConfig, session: SessionAuth = {}): void {
    const sessionKey = session.privateKey ? decryptSessionSecret(session.privateKey) : null

    if (config.authType === 'key' || sessionKey) {
        const key = sessionKey ?? resolvePrivateKey(config)
        connectConfig.privateKey = key
        if (isEncryptedPrivateKeyContent(key.toString('utf8'))) {
            const passphrase = session.keyPassphrase ?? config.keyPassphrase ?? resolveStoredKeyPassphrase(config)
            if (!passphrase) {
                throw new PrivateKeyError('passphrase', 'PRIVATE_KEY_PASSPHRASE_REQUIRED')
            }
            connectConfig.passphrase = passphrase
        }
        return
    }

    const password = resolvePasswordForAuth(config, session)
    if (password) {
        connectConfig.password = password
    }
}

/**
 * Возвращает пароль, доступный для подключения: введённый в текущей сессии,
 * сохранённый в вольте для этого сервера или переданный в конфигурации.
 * null, если пароля нет нигде — тогда его запросит сервер.
 */
export function resolvePasswordForAuth(config: SSHConfig, session: SessionAuth = {}): string | null {
    if (session.password) {
        return session.password
    }

    const appConfig = loadConfig()
    void initializeVaultAndMigrate(appConfig)
    const serverId = config.id
    if (serverId && appConfig.encryptedPasswords?.[serverId]) {
        try {
            return vault.decrypt(appConfig.encryptedPasswords[serverId])
        } catch {
            throw new LocalizedError(t('errors.vaultDecryptFailed'))
        }
    }
    return config.password ?? null
}

/** Парольная фраза ключа, сохранённая в вольте для этого сервера (null, если её нет). */
function resolveStoredKeyPassphrase(config: SSHConfig): string | null {
    const serverId = config.id
    if (!serverId) return null

    const appConfig = loadConfig()
    void initializeVaultAndMigrate(appConfig)
    const stored = appConfig.encryptedKeyPassphrases?.[serverId]
    if (!stored) return null
    return tryDecryptEncryptedSecret(stored)
}
