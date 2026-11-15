import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from '../apps/api/src/db/store';
import { loadProviderConfig } from '../apps/api/src/config/provider';
import { ensureIntegrationAgent } from '../apps/api/src/services/test-agent';
it('loads only authorized provider settings without importing another project’s database', async () => { const dir = await mkdtemp(join(tmpdir(), 'agentboard-provider-')); try {
    const source = join(dir, '.env');
    await writeFile(source, 'OPENAI_API_KEY=test-only-placeholder\nOPENAI_MODEL=test-model\nDATABASE_URL=wrong-database\nPORT=9999\n');
    const env: NodeJS.ProcessEnv = { OPENAI_ENV_FILE: source };
    expect(await loadProviderConfig(env)).toEqual({ configured: true, model: 'test-model' });
    expect(env.OPENAI_API_KEY).toBe('test-only-placeholder');
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.PORT).toBeUndefined();
    env.OPENAI_API_KEY = 'existing-value';
    await loadProviderConfig(env);
    expect(env.OPENAI_API_KEY).toBe('existing-value');
}
finally {
    await rm(dir, { recursive: true, force: true });
} });
it('creates one board-limited integration agent idempotently and leaves existing agents alone', async () => { const store = await new LocalStore().init(); await expect(ensureIntegrationAgent(store)).rejects.toThrow('owner'); await store.transaction(s => { s.users.push({ id: 'owner', name: 'Alex', email: 'alex@example.com', role: 'owner', createdAt: new Date().toISOString(), passwordHash: 'not-a-real-password' }); s.agents.push({ id: 'existing', name: 'Existing agent' } as any); }); const first = await ensureIntegrationAgent(store), second = await ensureIntegrationAgent(store); expect(first.created).toBe(true); expect(second.created).toBe(false); expect(second.agent.id).toBe(first.agent.id); expect(first.agent.boardIds).toEqual([first.boardId]); expect(first.agent.capabilities).not.toContain('delete'); const s = await store.read(); expect(s.agents).toHaveLength(2); expect(s.agents[0]).toEqual({ id: 'existing', name: 'Existing agent' }); expect(Object.keys(s.boards)).toHaveLength(1); expect(first.agent).not.toHaveProperty('keyHash'); await store.transaction(s => { s.agents.find(a => a.id === first.agent.id)!.status = 'revoked'; }); const revoked = await ensureIntegrationAgent(store); expect(revoked.created).toBe(false); expect(revoked.agent.status).toBe('revoked'); await store.close(); });
