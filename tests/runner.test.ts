import { it, expect } from 'vitest';
import { LocalStore } from '../apps/api/src/db/store';
import { createBoard, applyOps, revertRun, type Auth } from '../apps/api/src/services/core';
import { Worker, createRun, type Model } from '../apps/api/src/services/runner';
const auth: Auth = { actor: { kind: 'user', id: 'u', name: 'Alex' }, user: { id: 'u', name: 'Alex', email: 'a@example.com', role: 'owner', createdAt: new Date().toISOString() }, scopes: ['boards:read', 'boards:write'] };
async function setup(scopes = ['boards:read', 'boards:write']) { const store = await new LocalStore().init(); const board = await store.transaction(s => createBoard(s, auth, 'Work')); const agent: any = { id: 'agt_test', name: 'Planner', harness: 'custom', scopes, capabilities: ['add', 'draw', 'edit', 'knowledge'], instructions: 'Help', mcpServers: [], runner: { kind: 'builtin' }, boardIds: null, status: 'active', keyHash: 'hashed-only', keyPrefix: 'ab_live', lastSeenAt: null, createdAt: new Date().toISOString() }; await store.transaction(s => s.agents.push(agent)); return { store, board, agent }; }
it('stage 4: runs model tools in order as the agent and releases claims', async () => {
    const { store, board, agent } = await setup();
    let n = 0;
    const calls = [['read_board', { boardId: board.id }], ['search_knowledge', { query: 'project' }], ['claim', { boardId: board.id, target: { rect: { x: 0, y: 0, w: 1000, h: 1000 } } }], ['write_board', { boardId: board.id, ops: [{ op: 'create', id: 'idea', data: { type: 'note', x: 20, y: 30, w: 200, h: 160, text: 'An idea', color: 'green' } }] }], ['release_claim', {}]] as const;
    const model: Model = async () => {
        if (n === 4) {
            const s = await store.read();
            return { tool_calls: [{ id: String(n++), function: { name: 'release_claim', arguments: JSON.stringify({ boardId: board.id, claimId: s.boards[board.id].claims[0].id }) } }] };
        }
        if (n < calls.length) {
            const [name, args] = calls[n];
            return { tool_calls: [{ id: String(n++), function: { name, arguments: JSON.stringify(args) } }] };
        }
        return { content: 'Added an idea.' };
    };
    const worker = new Worker(store, async () => { }, model);
    await worker.start();
    await store.transaction(s => createRun(s, auth, board.id, agent.id, 'Help us explore'));
    await worker.tick();
    await worker.stop();
    const s = await store.read(), run = s.runs[0];
    expect(run.status).toBe('done');
    expect(run.steps.filter(s => s.kind !== 'prompt').map(s => s.name)).toEqual(calls.map(c => c[0]));
    expect(s.boards[board.id].claims).toHaveLength(0);
    expect(s.activity[0].actor.kind).toBe('agent');
    expect(s.boards[board.id].elements.idea.createdBy.id).toBe(agent.id);
});
it('read-only agents can reply, unavailable tools return forbidden, without board changes', async () => {
    const { store, board, agent } = await setup(['boards:read']);
    let n = 0;
    let forbidden = false;
    const model: Model = async (messages) => {
        if (n++ === 0)
            return { tool_calls: [{ id: 'a', function: { name: 'write_board', arguments: JSON.stringify({ boardId: board.id, ops: [] }) } }] };
        forbidden = messages.some(m => m.role === 'tool' && m.content.includes('forbidden'));
        return { content: 'I would add a note.' };
    };
    const worker = new Worker(store, async () => { }, model);
    await worker.start();
    await store.transaction(s => createRun(s, auth, board.id, agent.id, 'Add ideas'));
    await worker.tick();
    await worker.stop();
    const s = await store.read();
    expect(s.runs[0].status).toBe('done');
    expect(s.runs[0].steps.at(-1)?.status).toBe('skipped');
    expect(s.runs[0].reply).toContain('permission');
    expect(s.boards[board.id].board.elementCount).toBe(0);
});
it('marks interrupted work on restart and picks up a queued run', async () => { const { store, board, agent } = await setup(); await store.transaction(s => { const r = createRun(s, auth, board.id, agent.id, 'Help'); r.status = 'running'; }); const worker = new Worker(store, async () => { }, async () => ({ content: 'Finished' })); await worker.start(); expect((await store.read()).runs[0].error?.code).toBe('interrupted'); await store.transaction(s => createRun(s, auth, board.id, agent.id, 'Help again')); await worker.tick(); await worker.stop(); expect((await store.read()).runs[0].status).toBe('done'); });
it('reverts multiple batches touching the same element atomically', async () => { const { store, board, agent } = await setup(); await store.transaction(s => { const aa: Auth = { actor: { kind: 'agent', id: agent.id, name: agent.name }, agent, scopes: agent.scopes }; const run = createRun(s, auth, board.id, agent.id, 'Help'); run.status = 'done'; run.batches.push(applyOps(s, aa, board.id, { ops: [{ op: 'create', id: 'idea', data: { type: 'note', x: 0, y: 0, w: 200, h: 160, text: 'one', color: 'yellow' } }] }).seq); run.batches.push(applyOps(s, aa, board.id, { ops: [{ op: 'update', id: 'idea', ifVersion: 1, data: { text: 'two' } }] }).seq); revertRun(s, auth, run); }); expect((await store.read()).boards[board.id].board.elementCount).toBe(0); });
it('recovers the reported missing-boardId and flattened-op failures through validated provider responses', async () => {
    const { store, board, agent } = await setup(); let turn = 0;
    const { openAIModel } = await import('../apps/api/src/services/runner');
    const { vi } = await import('vitest');
    vi.stubEnv('OPENAI_API_KEY', 'test-only');
    const html = '<style>button{background:#b42318;color:white;border-radius:12px}</style><button>Submit</button>';
    const modelCall = (name: string, args: unknown) => ({ content: null, tool_calls: [{ id: 'call' + turn, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body); expect(body.tools.every((t: any) => t.function.strict)).toBe(true);
        expect(body.tools.find((t: any) => t.function.name === 'write_board').function.parameters.properties.boardId).toBeUndefined();
        expect(body.response_format.json_schema.strict).toBe(true);
        let message: any;
        if (turn++ === 0) message = modelCall('read_board', {});
        else if (turn === 2) message = modelCall('write_board', { ops: [{ op: 'create', type: 'embed', x: 100, y: 100, w: 240, h: 120, html, text: 'Submit button' }] });
        else if (turn === 3) {
            const error = JSON.parse(body.messages.filter((m: any) => m.role === 'tool').at(-1).content).error;
            expect(error.code).toBe('validation_failed'); expect(error.details.hint).toContain('inside data');
            message = modelCall('write_board', { ops: [{ op: 'create', data: { type: 'embed', x: 100, y: 100, w: 240, h: 120, html, text: 'Submit button' } }] });
        } else message = { content: JSON.stringify({ outcome: 'completed', reply: 'Added your red rounded Submit button.' }) };
        return { ok: true, json: async () => ({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { total_tokens: 15000 } }) };
    }));
    try {
        await store.transaction(s => createRun(s, auth, board.id, agent.id, 'red round corner button with submit text', { place: { x: 100, y: 100 } }));
        const worker = new Worker(store, async () => {}, openAIModel); await worker.tick(); await worker.stop();
        const s = await store.read(); expect(s.runs[0]).toMatchObject({ status: 'done', reply: 'Added your red rounded Submit button.' });
        expect(Object.values(s.boards[board.id].elements)).toHaveLength(1);
        expect(Object.values(s.boards[board.id].elements)[0]).toMatchObject({ type: 'embed', html });
        expect(s.runs[0].steps.find(step => step.status === 'failed')?.note).toContain('validation_failed');
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});
it('refuses a completed reply when every write failed validation', async () => {
    const { store, board, agent } = await setup(); let turn = 0;
    const worker = new Worker(store, async () => {}, async () => turn++ === 0 ? { tool_calls: [{ id: 'bad', function: { name: 'write_board', arguments: JSON.stringify({ ops: [{ op: 'create', type: 'embed' }] }) } }] } : { content: 'Done, I created it.' });
    await store.transaction(s => createRun(s, auth, board.id, agent.id, 'Build it', { place: { x: 0, y: 0 } }));
    await worker.tick(); await worker.stop(); const s = await store.read();
    expect(s.runs[0]).toMatchObject({ status: 'failed', error: { code: 'validation_failed' } }); expect(s.runs[0].reply).toBeNull(); expect(s.boards[board.id].board.elementCount).toBe(0);
});
it('stops repeated invalid writes before spending the whole run budget', async () => {
    const { store, board, agent } = await setup(); let requests = 0;
    const worker = new Worker(store, async () => {}, async () => {
        requests++;
        return { tokens: 1000, tool_calls: [{ id: 'bad_' + requests, function: { name: 'write_board', arguments: JSON.stringify({ ops: [{ op: 'create', type: 'embed', text: 'Still incorrectly flattened' }] }) } }] };
    });
    await store.transaction(s => createRun(s, auth, board.id, agent.id, 'Create it', { place: { x: 0, y: 0 } }));
    await worker.tick(); await worker.stop(); const s = await store.read();
    expect(requests).toBe(3); expect(s.runs[0]).toMatchObject({ status: 'failed', error: { code: 'validation_failed' } });
    expect(s.runs[0].error?.message).toContain('three times'); expect(s.boards[board.id].board.elementCount).toBe(0);
});
