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

function testSanitizeData() {
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
    testSanitizeData()
    testFormatArg()
    console.log('All logger sanitization tests passed successfully!')
} catch (e) {
    console.error('Logger test failed:', e)
    process.exit(1)
}
