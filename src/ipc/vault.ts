import type { AppConfig } from '../types.js'

export interface VaultStatus {
    isUnlocked: boolean;
    isInitialized: boolean;
    /**
     * Секреты доступны без вольта: они лежат в системном хранилище либо вольт
     * уже открыт.
     *
     * Нужен отдельно от `isUnlocked`: после переноса секретов в системное
     * хранилище вольт намеренно остаётся закрытым, и одного `isUnlocked` не
     * хватило бы, чтобы не показать окно ввода ключа тому, кому он не нужен.
     */
    secretsAvailable: boolean;
}

/** Результат операций со сменой ключа/сбросом хранилища. */
export interface VaultKeyMaterial {
    recoveryKey: string;
    config: AppConfig;
}

export type VaultInitResult = VaultKeyMaterial | null;
export type VaultUnlockResult = boolean;
export type VaultRecoveryKeyResult = string | null;
export type VaultPasswordResult = string | null;
export type VaultRegenerateResult = VaultKeyMaterial | null;
export type VaultResetResult = VaultKeyMaterial;