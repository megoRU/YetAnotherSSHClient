import { type ConnectConfig } from 'ssh2'
import type { SSHConfig } from '../../src/types.js'
import { initializeVaultAndMigrate, loadConfig } from './config.js'
import { t } from './i18n-main.js'
import { LocalizedError, PrivateKeyError, resolvePrivateKey } from './private-key.js'
import { vault } from './vault.js'

/**
 * Заполняет ConnectConfig учётными данными строго по config.authType:
 * 'key' -> только privateKey (фолбэка на пароль нет), 'password' -> только password.
 * Используется всеми точками подключения (SSH-терминал, SFTP, port-forwarding, MCP),
 * чтобы ssh2 не выбирал метод авторизации из «двух доступных» произвольным образом.
 */
export function applyAuthConfig(config: SSHConfig, connectConfig: ConnectConfig): void {
    if (config.authType === 'key') {
        if (!config.privateKey && !config.privateKeyPath) {
            throw new PrivateKeyError('missing', 'PRIVATE_KEY_NOT_SET')
        }
        initializeVaultAndMigrate(loadConfig())
        connectConfig.privateKey = resolvePrivateKey(config)
        return
    }

    const appConfig = loadConfig()
    initializeVaultAndMigrate(appConfig)
    const serverId = config.id
    if (serverId && appConfig.encryptedPasswords?.[serverId]) {
        try {
            connectConfig.password = vault.decrypt(appConfig.encryptedPasswords[serverId])
        } catch {
            throw new LocalizedError(t('errors.vaultDecryptFailed'))
        }
        return
    }
    connectConfig.password = config.password
}
