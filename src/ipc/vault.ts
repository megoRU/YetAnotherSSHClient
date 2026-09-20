import type { AppConfig } from '../types.js'

export interface VaultStatus {
    isUnlocked: boolean;
    isInitialized: boolean;
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