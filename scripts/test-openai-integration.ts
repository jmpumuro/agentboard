import { loadProviderConfig } from '../apps/api/src/config/provider';
import { LocalStore } from '../apps/api/src/db/store';
import { ensureIntegrationAgent } from '../apps/api/src/services/test-agent';
import { passwordHash } from '../apps/api/src/services/core';
import { createRun, Worker } from '../apps/api/src/services/runner';
await loadProviderConfig();
if (!process.env.OPENAI_API_KEY)
    throw Error('OpenAI provider is not configured.');
// A real provider check against an isolated board/store; it cannot touch the user's boards.
const store = await new LocalStore().init();
const owner = { id: 'usr_integration', name: 'Integration tester', email: 'integration@example.com', role: 'owner' as const, createdAt: new Date().toISOString(), passwordHash: await passwordHash(crypto.randomUUID()) };
await store.transaction(s => s.users.push(owner));
const setup = await ensureIntegrationAgent(store);
await store.transaction(s => createRun(s, { actor: { kind: 'user', id: owner.id, name: owner.name }, user: owner, scopes: ['boards:read', 'boards:write'] }, setup.boardId!, setup.agent.id, 'Read this board and use write_board to add exactly one note in open space, with text "OpenAI integration verified". Then finish with a short confirmation.'));
const worker = new Worker(store, async () => { });
try {
    await worker.tick();
    const s = await store.read(), run = s.runs[0];
    const passed = run.status === 'done' && Object.values(s.boards[setup.boardId!].elements).some(e => e.type === 'note' && e.text === 'OpenAI integration verified' && e.createdBy.id === setup.agent.id);
    console.log(JSON.stringify({ passed, status: run.status, steps: run.steps.map(s => ({ name: s.name, status: s.status })), errorCode: run.error?.code ?? null, error: run.error?.message ?? null }));
    if (!passed)
        process.exitCode = 1;
}
finally {
    await worker.stop();
    await store.close();
}
