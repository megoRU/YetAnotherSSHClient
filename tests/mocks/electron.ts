/**
 * Стаб electron для unit-тестов (node-окружения vitest).
 * Покрывает только те части API, которые реально достигаются тестами.
 * НЕ используется в продакшен-сборке.
 */
export const app = {
    getLocale: (): string => 'ru-RU',
}

export const safeStorage = {
    isEncryptionAvailable: (): boolean => false,
    encryptString: (value: string): Buffer => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer): string => value.toString('utf8'),
}

export const dialog = {
    showErrorBox: (): void => undefined,
}