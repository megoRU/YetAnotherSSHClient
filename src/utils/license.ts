export interface ValidateLicenseResult {
    success: boolean;
    expiresAt?: number;
    errorType?: 'INVALID_KEY' | 'EXPIRED_LICENSE' | 'NETWORK_ERROR' | 'SERVER_ERROR' | 'INVALID_RESPONSE';
    errorMessage?: string;
}

/**
 * Validates a license key against the license API endpoint.
 *
 * @param key The license key string to validate
 * @returns Promise<ValidateLicenseResult>
 */
export async function validateLicense(key: string): Promise<ValidateLicenseResult> {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
        return {
            success: false,
            errorType: 'INVALID_KEY',
            errorMessage: 'License key cannot be empty'
        };
    }

    try {
        const response = await fetch('https://api.megoru.ru/api/license', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: trimmedKey }),
        });

        if (response.status === 404 || response.status === 400 || response.status === 422 || response.status === 410) {
            let errorType: 'INVALID_KEY' | 'EXPIRED_LICENSE' = 'INVALID_KEY';
            try {
                const data = await response.json() as { error?: string; code?: string; expired?: boolean };
                if (data && (data.expired === true || data.error === 'expired' || data.code === 'EXPIRED')) {
                    errorType = 'EXPIRED_LICENSE';
                }
            } catch {
                // Default to INVALID_KEY if body cannot be parsed
            }
            return {
                success: false,
                errorType,
                errorMessage: errorType === 'EXPIRED_LICENSE' ? 'License key has expired' : 'Invalid license key'
            };
        }

        if (!response.ok) {
            return {
                success: false,
                errorType: 'SERVER_ERROR',
                errorMessage: `Server error (${response.status})`
            };
        }

        const data = await response.json() as { expiresAt?: unknown; expired?: boolean };

        if (data && typeof data.expiresAt === 'number' && Number.isFinite(data.expiresAt) && data.expiresAt > 0) {
            if (data.expiresAt <= Date.now() || data.expired === true) {
                return {
                    success: false,
                    expiresAt: data.expiresAt,
                    errorType: 'EXPIRED_LICENSE',
                    errorMessage: 'License key has expired'
                };
            }
            return {
                success: true,
                expiresAt: data.expiresAt
            };
        }

        return {
            success: false,
            errorType: 'INVALID_RESPONSE',
            errorMessage: 'Invalid response format from license server'
        };
    } catch {
        return {
            success: false,
            errorType: 'NETWORK_ERROR',
            errorMessage: 'Failed to connect to license server'
        };
    }
}
