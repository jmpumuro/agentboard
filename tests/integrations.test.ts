import { it, expect, vi, afterEach } from 'vitest';
vi.mock('../apps/api/src/lib/outbound', () => ({ validateUrl: vi.fn(async () => ({})), safePost: vi.fn() }));
import { encrypt, decrypt } from '../apps/api/src/lib/secrets';
import { prepareAgent } from '../apps/api/src/services/agents';
import { safePost } from '../apps/api/src/lib/outbound';
import { createApp } from '../apps/api/src/server';
import { LocalStore } from '../apps/api/src/db/store';
import { createHmac } from 'node:crypto';
const oldKey = process.env.SECRET_ENCRYPTION_KEY;
afterEach(() => {
    if (oldKey === undefined)
        delete process.env.SECRET_ENCRYPTION_KEY;
    else
        process.env.SECRET_ENCRYPTION_KEY = oldKey;
    vi.mocked(safePost).mockReset();
});
it('stage 6: encrypts authenticated secrets and refuses unconfigured encryption', () => { delete process.env.SECRET_ENCRYPTION_KEY; expect(() => encrypt('private')).toThrow('SECRET_ENCRYPTION_KEY'); process.env.SECRET_ENCRYPTION_KEY = '1'.repeat(64); const encoded = encrypt('private-token'); expect(encoded).not.toContain('private-token'); expect(decrypt(encoded)).toBe('private-token'); process.env.SECRET_ENCRYPTION_KEY = '2'.repeat(64); expect(() => decrypt(encoded)).toThrow(); });
it('preserves external secrets on edits and rotates webhook secrets on URL change', async () => { process.env.SECRET_ENCRYPTION_KEY = '1'.repeat(64); const input = { name: 'Researcher', harness: 'custom', scopes: ['boards:read'], mcpServers: [{ name: 'Library', url: 'https://example.com/mcp', secret: 'Bearer secret' }], runner: { kind: 'webhook', url: 'https://example.com/run' } }; const prepared = await prepareAgent(input); expect(prepared.once).toBeTruthy(); expect(prepared.fields.mcpServers[0].hasSecret).toBe(true); const old = { ...prepared.fields, id: 'agt_a' } as any; const next = await prepareAgent({ ...input, mcpServers: [{ name: 'Library', url: 'https://example.com/mcp' }] }, old); expect(next.fields.secrets).toEqual(prepared.fields.secrets); expect(next.once).toBeUndefined(); const changed = await prepareAgent({ ...input, runner: { kind: 'webhook', url: 'https://example.com/run2' } }, old); expect(changed.once).not.toBe(prepared.once); });
it('delivers signed webhooks, accepts attributed progress and tracks their writes for undo', async () => {
    process.env.SECRET_ENCRYPTION_KEY = '1'.repeat(64);
    const app = createApp(await new LocalStore().init());
    try {
        const signup = await app.handle({ url: '/api/v1/auth/signup', method: 'POST', headers: { origin: 'http://localhost:4173' }, body: { name: 'Owner', email: 'owner@example.com', password: 'password123' } });
        const cookie = signup.headers!['Set-Cookie'].split(';')[0];
        const req = (url: string, body?: any, token?: string) => app.handle({ url: '/api/v1' + url, method: 'POST', headers: { origin: 'http://localhost:4173', ...(token ? { authorization: 'Bearer ' + token } : { cookie }) }, body });
        const b = (await req('/boards', { title: 'Webhook work' })).body;
        const ag = (await req('/agents', { name: 'External', harness: 'custom', scopes: ['boards:read', 'boards:write'], runner: { kind: 'webhook', url: 'https://example.com/run' } })).body;
        expect(ag.webhookSecret).toBeTruthy();
        let signed = false;
        vi.mocked(safePost).mockImplementation(async (_url, payload: any, headers: any) => { const expected = createHmac('sha256', ag.webhookSecret).update(headers['X-AgentBoard-Timestamp'] + '.' + JSON.stringify(payload)).digest('hex'); signed = expected === headers['X-AgentBoard-Signature']; expect((await req('/runs/' + payload.run.id + '/steps', { kind: 'plan', name: 'plan', note: 'Working', status: 'done' }, ag.key)).status).toBe(200); await req('/boards/' + b.id + '/ops', { ops: [{ op: 'create', data: { type: 'note', x: 0, y: 0, w: 200, h: 150, text: 'From harness', color: 'blue' } }] }, ag.key); await req('/runs/' + payload.run.id + '/finish', { reply: 'Done' }, ag.key); return { ok: true }; });
        await app.worker.start();
        const run = (await req('/boards/' + b.id + '/runs', { agentId: ag.agent.id, message: 'Help' })).body;
        await app.worker.tick();
        expect(signed).toBe(true);
        const result = await app.handle({ url: '/api/v1/runs/' + run.id, method: 'GET', headers: { cookie } });
        expect(result.body.status).toBe('done');
        expect(result.body.batches).toHaveLength(1);
        expect(result.body.touched).toHaveLength(1);
        await req('/runs/' + run.id + '/revert');
        const elements = await app.handle({ url: '/api/v1/boards/' + b.id + '/elements', method: 'GET', headers: { cookie } });
        expect(elements.body.elements).toHaveLength(0);
    }
    finally {
        await app.close();
    }
});
