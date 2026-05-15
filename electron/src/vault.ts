import * as crypto from 'node:crypto';

export interface EncryptedData {
    iv: string;
    tag: string;
    data: string;
}

export class VaultService {
    private masterKey: Buffer | null = null;
    private readonly algorithm = 'aes-256-gcm';

    /**
     * Инициализирует мастер-ключ на основе ключа восстановления и соли.
     */
    unlock(recoveryKeyBase64: string, saltBase64: string): void {
        const recoveryKey = Buffer.from(recoveryKeyBase64, 'base64');
        const salt = Buffer.from(saltBase64, 'base64');

        // Key Derivation: scryptSync
        this.masterKey = crypto.scryptSync(recoveryKey, salt, 32);

    }

    isUnlocked(): boolean {
        return this.masterKey !== null;
    }

    lock(): void {
        if (this.masterKey) {
            this.masterKey.fill(0);
            this.masterKey = null;
        }
    }

    /**
     * Шифрует строку с использованием AES-256-GCM.
     */
    encrypt(plaintext: string): EncryptedData {
        if (!this.masterKey) throw new Error('Vault is locked');

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv) as crypto.CipherGCM;

        let encrypted = cipher.update(plaintext, 'utf8', 'base64');
        encrypted += cipher.final('base64');

        const tag = cipher.getAuthTag().toString('base64');

        return {
            iv: iv.toString('base64'),
            tag: tag,
            data: encrypted
        };
    }

    /**
     * Расшифровывает данные.
     */
    decrypt(encrypted: EncryptedData): string {
        if (!this.masterKey) throw new Error('Vault is locked');

        const iv = Buffer.from(encrypted.iv, 'base64');
        const tag = Buffer.from(encrypted.tag, 'base64');
        const data = Buffer.from(encrypted.data, 'base64');

        const decipher = crypto.createDecipheriv(this.algorithm, this.masterKey, iv) as crypto.DecipherGCM;
        decipher.setAuthTag(tag);

        let decrypted = decipher.update(data);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString('utf8');
    }
}

export const vault = new VaultService();
