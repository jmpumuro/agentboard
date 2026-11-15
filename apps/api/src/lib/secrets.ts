import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { fail } from './errors';
function encryptionKey() {
    const value = process.env.SECRET_ENCRYPTION_KEY;
    if (!value || !/^[a-f0-9]{64}$/i.test(value))
        fail('validation_failed', 'Set SECRET_ENCRYPTION_KEY to 32 random bytes encoded as 64 hex characters before storing external credentials.');
    return Buffer.from(value, 'hex');
}
export function encrypt(value: string) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64url')).join('.'); }
export function decrypt(value: string) { const [iv, tag, data] = value.split('.').map(v => Buffer.from(v, 'base64url')); const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'); }
