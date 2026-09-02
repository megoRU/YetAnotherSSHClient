import assert from 'node:assert'
import { sanitizeText, sanitizeData, formatArg } from './logger.js'

function testSanitizeText() {
    const text = 'Connection failed for password: "mySuperPassword123" and token=secretTokenVal'
    const sanitized = sanitizeText(text)
    assert(!sanitized.includes('mySuperPassword123'), 'Text should not contain plain password')
    assert(!sanitized.includes('secretTokenVal'), 'Text should not contain plain token')
    assert(sanitized.includes('password: [REDACTED]'), 'Text should contain password: [REDACTED]')
    assert(sanitized.includes('token=[REDACTED]'), 'Text should contain token=[REDACTED]')

    const bearerText = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
    assert.strictEqual(sanitizeText(bearerText), 'Authorization: Bearer [REDACTED]')

    const keyText = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----'
    assert.strictEqual(sanitizeText(keyText), '[REDACTED PRIVATE KEY]')
}

function testExpandedSensitiveKeys() {
    const sensitiveData = {
        sshPassword: 'secretSshPassword123',
        passwordHash: '$2a$12$eImiTXuWVxfM37uY4JANjO',
        apiToken: 'api_token_abc_xyz',
        clientSecret: 'client_secret_98765',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSlAgEAAoIBAQ...',
        ssh_key: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC...',
        normalField: 'public_information_here'
    }

    const sanitized = sanitizeData(sensitiveData) as Record<string, unknown>

    // Check all sensitive keys are redacted
    assert.strictEqual(sanitized.sshPassword, '[REDACTED]', 'sshPassword should be redacted')
    assert.strictEqual(sanitized.passwordHash, '[REDACTED]', 'passwordHash should be redacted')
    assert.strictEqual(sanitized.apiToken, '[REDACTED]', 'apiToken should be redacted')
    assert.strictEqual(sanitized.clientSecret, '[REDACTED]', 'clientSecret should be redacted')
    assert.strictEqual(sanitized.private_key, '[REDACTED]', 'private_key should be redacted')
    assert.strictEqual(sanitized.ssh_key, '[REDACTED]', 'ssh_key should be redacted')

    // Check normal non-sensitive field remains preserved
    assert.strictEqual(sanitized.normalField, 'public_information_here', 'normalField should remain unchanged')

    // Confirm original object remains 100% unmutated
    assert.strictEqual(sensitiveData.sshPassword, 'secretSshPassword123', 'original sshPassword must not be mutated')
    assert.strictEqual(sensitiveData.clientSecret, 'client_secret_98765', 'original clientSecret must not be mutated')
}

function testRendererStyleObjectFormatting() {
    const rendererConsoleObj = {
        user: 'developer',
        sshPassword: 'mySshPasswordValue',
        nested: {
            apiToken: 'myApiTokenValue'
        }
    }

    const formatted = formatArg(rendererConsoleObj)
    assert(!formatted.includes('mySshPasswordValue'), 'Formatted string must not leak sshPassword')
    assert(!formatted.includes('myApiTokenValue'), 'Formatted string must not leak apiToken')
    assert(formatted.includes('[REDACTED]'), 'Formatted string must contain [REDACTED]')

    // Original object must remain completely unchanged
    assert.strictEqual(rendererConsoleObj.sshPassword, 'mySshPasswordValue', 'Original object must not be modified')
    assert.strictEqual(rendererConsoleObj.nested.apiToken, 'myApiTokenValue', 'Original nested object must not be modified')
}

function testSanitizeDataDefaults() {
    const originalObj = {
        username: 'admin',
        password: 'superSecretPassword',
        details: {
            token: 'abc123token',
            host: '127.0.0.1'
        }
    }

    const sanitized = sanitizeData(originalObj) as typeof originalObj

    // Original object remains untouched
    assert.strictEqual(originalObj.password, 'superSecretPassword')
    assert.strictEqual(originalObj.details.token, 'abc123token')

    // Sanitized copy has sensitive keys masked
    assert.strictEqual(sanitized.password, '[REDACTED]')
    assert.strictEqual(sanitized.details.token, '[REDACTED]')
    assert.strictEqual(sanitized.username, 'admin')
    assert.strictEqual(sanitized.details.host, '127.0.0.1')

    // Test circular reference
    const circularObj: Record<string, unknown> = { key: 'value' }
    circularObj.self = circularObj
    const sanitizedCircular = sanitizeData(circularObj) as Record<string, unknown>
    assert.strictEqual(sanitizedCircular.key, 'value')
    assert.strictEqual(sanitizedCircular.self, '[CIRCULAR]')
}

function testFormatArg() {
    const err = new Error('Database password: mySecretPass')
    const formatted = formatArg(err)
    assert(!formatted.includes('mySecretPass'), 'Formatted error should not leak password')
    assert(formatted.includes('password: [REDACTED]'), 'Formatted error should contain redacted password')
}

try {
    testSanitizeText()
    testExpandedSensitiveKeys()
    testRendererStyleObjectFormatting()
    testSanitizeDataDefaults()
    testFormatArg()
    console.log('All expanded logger sanitization unit tests passed successfully!')
} catch (e) {
    console.error('Logger unit test failed:', e)
    process.exit(1)
}
