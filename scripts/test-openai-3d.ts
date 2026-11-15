import { loadProviderConfig } from '../apps/api/src/config/provider';
import { LocalStore } from '../apps/api/src/db/store';
import { createBoard, applyOps, type Auth } from '../apps/api/src/services/core';
import { createRun, Worker } from '../apps/api/src/services/runner';
import { STARTER_SCENE } from 'contract';
await loadProviderConfig();
if (!process.env.OPENAI_API_KEY) throw Error('OpenAI provider is not configured.');
const store = await new LocalStore().init();
const user = { id: 'usr_3d_test', name: '3D integration tester', email: '3d@example.com', role: 'owner' as const, createdAt: new Date().toISOString() };
const auth: Auth = { user, actor: { kind: 'user', id: user.id, name: user.name }, scopes: ['boards:read', 'boards:write'] };
const boardId = await store.transaction(s => {
    s.users.push({ ...user, passwordHash: '' });
    s.agents.push({ id: 'agt_3d_test', name: '3D integration builder', harness: 'test', scopes: ['boards:read', 'boards:write'], capabilities: ['add', 'edit'], instructions: '', boardIds: null, mcpServers: [], runner: { kind: 'builtin' }, keyHash: '', keyPrefix: '', status: 'active', lastSeenAt: null, createdAt: user.createdAt });
    const b = createBoard(s, auth, 'Isolated bicycle integration');
    applyOps(s, auth, b.id, { ops: [{ op: 'create', id: 'bicycle', data: STARTER_SCENE }] }); return b.id;
});
await store.transaction(s => createRun(s, auth, boardId, 'agt_3d_test', 'Build a 3D model of a bicycle and show how the chain drives the wheel. Give each part a useful name and explanation. Keep the starter part ID by turning it into a bicycle part; add the other parts, with explicit out offsets for a clear breakdown.', { elementId: 'bicycle' }));
const worker = new Worker(store, async () => {});
try {
    await worker.tick(); const s = await store.read(), run = s.runs[0], model = s.boards[boardId].elements.bicycle;
    const parts = model.type === 'scene3d' ? model.parts : [];
    const passed = run.status === 'done' && parts.length > 4 && parts.every(p => p.name && p.info && p.out) && /chain/i.test(parts.map(p => p.name + ' ' + p.info).join(' ')) && Object.keys(s.boards[boardId].elements).length === 1;
    console.log(JSON.stringify({ passed, status: run.status, partCount: parts.length, parts: parts.map(p => ({ name: p.name, info: p.info })), steps: run.steps.map(step => ({ name: step.name, status: step.status, note: step.note })), error: run.error }));
    if (!passed) process.exitCode = 1;
} finally { await worker.stop(); await store.close(); }
