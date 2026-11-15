import { it, expect } from 'vitest';
import { publicAddress, validateUrl } from '../apps/api/src/lib/outbound';
import { LocalStore } from '../apps/api/src/db/store';
import { passwordHash, passwordCheck, hash } from '../apps/api/src/services/core';
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
it('stage 5: refuses local, private and link-local addresses, including IPv6', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fc00::1', '0.0.0.0', '224.0.0.1'])
        expect(publicAddress(ip), ip).toBe(false);
    expect(publicAddress('8.8.8.8')).toBe(true);
});
it('requires encrypted HTTP endpoints before DNS resolution', async () => { await expect(validateUrl('http://localhost')).rejects.toMatchObject({ code: 'validation_failed' }); await expect(validateUrl('https://user:password@example.com')).rejects.toMatchObject({ code: 'validation_failed' }); });
it('hashes passwords with Argon2id and still verifies legacy scrypt hashes', async () => {
    const a = await passwordHash('secret'), b = await passwordHash('secret');
    expect(a).not.toBe(b);
    expect(a.startsWith('$argon2id$')).toBe(true);
    expect(a).toContain('m=19456,t=2,p=1');
    expect(a).not.toContain('secret');
    expect(await passwordCheck('secret', a)).toBe(true);
    expect(await passwordCheck('different', a)).toBe(false);
    expect(hash('abc')).toHaveLength(64);
    const legacySalt = randomBytes(16).toString('hex');
    const legacyKey = await promisify(scryptCb)('legacy-secret', legacySalt, 64) as Buffer;
    const legacy = legacySalt + ':' + legacyKey.toString('hex');
    expect(await passwordCheck('legacy-secret', legacy)).toBe(true);
    expect(await passwordCheck('different', legacy)).toBe(false);
});
it('persists local writes across restart and never persists a failed transaction', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentboard-test-'));
    const file = join(dir, 'state.json');
    try {
        const store = await new LocalStore(file).init();
        await store.transaction(s => { s.settings.name = 'Saved workspace'; });
        await expect(store.transaction(s => { s.settings.name = 'Lost change'; throw Error('rollback'); })).rejects.toThrow('rollback');
        const reopened = await new LocalStore(file).init();
        expect((await reopened.read()).settings.name).toBe('Saved workspace');
        expect(JSON.parse(await readFile(file, 'utf8')).settings.name).toBe('Saved workspace');
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
