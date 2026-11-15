import { expect, it } from 'vitest';
import { STARTER_SCENE, STARTER_EMBED } from 'contract';
import { LocalStore, type State } from '../apps/api/src/db/store';
import { createBoard, applyOps, revertRun, type Auth } from '../apps/api/src/services/core';
import { createRun, Worker, type Model } from '../apps/api/src/services/runner';
const actor = { kind: 'user', id: 'u', name: 'Alex' } as const;
const auth: Auth = { actor, user: { id: 'u', name: 'Alex', email: 'a@example.com', role: 'owner', createdAt: new Date().toISOString() }, scopes: ['boards:read', 'boards:write'] };
async function setup() { const store = await new LocalStore().init(); const id = await store.transaction(s => { s.users.push({ ...auth.user!, passwordHash: '' }); s.agents.push({ id: 'agent', name: 'Builder', harness: 'test', keyHash: '', keyPrefix: '', status: 'active', scopes: auth.scopes as any, capabilities: ['add', 'edit'], boardIds: null, instructions: '', mcpServers: [], runner: { kind: 'builtin' }, createdAt: new Date().toISOString(), lastSeenAt: null }); const b = createBoard(s, auth, 'Models'); applyOps(s, auth, b.id, { ops: [{ op: 'create', id: 'target', data: { ...STARTER_SCENE, parts: [{ ...STARTER_SCENE.parts[0], id: 'block' }] } }] }); return b.id; }); return { store, id }; }
const call = (name: string, args: unknown) => ({ tool_calls: [{ id: name, function: { name, arguments: JSON.stringify(args) } }] });
it('the real runner targets a human model, reads versions, edits its part, and can undo without losing unrelated work', async () => {
    const { store, id } = await setup(); let step = 0;
    const model: Model = async messages => {
        expect(messages.some(m => String(m.content).includes('EXISTING scene3d element target'))).toBe(true);
        if (step++ === 0) return call('read_board', { boardId: id, format: 'json' });
        if (step === 2) { const snapshot = JSON.parse([...messages].reverse().find(m => m.role === 'tool').content); const part = snapshot.elements[0].parts[0]; return call('write_board', { boardId: id, ops: [{ op: 'part.update', id: 'target', partId: part.id, ifPartVersion: part.v, data: { size: [4, 2, 2], info: 'The main support.' } }] }); }
        return { content: 'Updated the same model.' };
    };
    await store.transaction(s => createRun(s, auth, id, 'agent', 'Widen the block', { elementId: 'target' }));
    const worker = new Worker(store, async () => {}, model); await worker.tick();
    let s = await store.read(); expect(s.runs[0].status).toBe('done'); expect(Object.keys(s.boards[id].elements)).toEqual(['target']);
    expect((s.boards[id].elements.target as any).parts[0]).toMatchObject({ size: [4, 2, 2], v: 2 });
    await store.transaction(s => applyOps(s, auth, id, { ops: [{ op: 'part.add', id: 'target', part: { ...STARTER_SCENE.parts[0], id: 'unrelated' } }] }));
    await store.transaction(s => revertRun(s, auth, s.runs[0])); s = await store.read();
    expect((s.boards[id].elements.target as any).parts).toHaveLength(2); expect((s.boards[id].elements.target as any).parts[0].size).toEqual([2, 2, 2]);
    await worker.stop();
});
it('refuses a duplicate or a write outside the target, and validates cross-board or wrong-type targets', async () => {
    const { store, id } = await setup(); let step = 0;
    const model: Model = async () => step++ === 0 ? call('read_board', { boardId: id }) : step === 2 ? call('write_board', { boardId: id, ops: [{ op: 'create', id: 'duplicate', data: STARTER_SCENE }] }) : { content: 'Could not duplicate.' };
    await store.transaction(s => createRun(s, auth, id, 'agent', 'Build a model', { elementId: 'target' }));
    const worker = new Worker(store, async () => {}, model); await worker.tick();
    const s = await store.read(); expect(s.runs[0].steps.some(x => x.name === 'write_board' && x.status === 'failed')).toBe(true); expect(Object.keys(s.boards[id].elements)).toEqual(['target']);
    await expect(store.transaction(s => createRun(s, auth, id, 'agent', 'Change it', { elementId: 'missing' }))).rejects.toMatchObject({ code: 'validation_failed' });
    await worker.stop();
});
it('a placement run creates one embed then stores its element target for follow-up requests', async () => {
    const { store, id } = await setup(); let step = 0;
    const model: Model = async () => step++ === 0 ? call('read_board', { boardId: id }) : step === 2 ? call('write_board', { boardId: id, ops: [{ op: 'create', id: 'design', data: STARTER_EMBED }] }) : { content: 'Created.' };
    await store.transaction(s => createRun(s, auth, id, 'agent', 'A calm pricing page', { place: { x: 500, y: 0 } }));
    const worker = new Worker(store, async () => {}, model); await worker.tick();
    expect((await store.read()).runs[0].design).toEqual({ elementId: 'design' }); await worker.stop();
});
it('a targeted model run can connect its card to a mockup without rewriting either design', async () => {
    const { store, id } = await setup(); await store.transaction(s => applyOps(s, auth, id, { ops: [{ op: 'create', id: 'button', data: STARTER_EMBED }] })); let step = 0;
    const model: Model = async () => step++ === 0 ? call('read_board', { format: 'json' }) : step === 2 ? call('write_board', { ops: [{ op: 'create', id: 'link', data: { type: 'arrow', x: 0, y: 0, from: 'button', to: 'target', label: 'connected' } }] }) : { content: 'Connected the two cards.' };
    await store.transaction(s => createRun(s, auth, id, 'agent', 'Connect the button and 3D model', { elementId: 'target' })); const worker = new Worker(store, async () => {}, model); await worker.tick(); await worker.stop();
    const s = await store.read(); expect(s.runs[0].status).toBe('done'); expect(s.boards[id].elements.link).toMatchObject({ type: 'arrow', from: 'button', to: 'target' }); expect(s.boards[id].elements.target.version).toBe(1); expect(s.boards[id].elements.button.version).toBe(1);
});
it('builds a human starter with part.update and version-free part.add in one shared batch', async () => {
    const { store, id } = await setup(); let step = 0;
    const model: Model = async (_messages, tools) => {
        const schema = tools.find(t => t.function.name === 'write_board')!.function.parameters;
        const text = JSON.stringify(schema); expect(text).not.toContain('"v":');
        if (step++ === 0) return call('read_board', { format: 'json' });
        if (step === 2) return call('write_board', { ops: [
            { op: 'update', id: 'target', ifVersion: 1, data: { text: 'Bicycle drive system', prompt: 'Explain the chain drive' } },
            { op: 'part.update', id: 'target', partId: 'block', ifPartVersion: 1, data: { kind: 'cylinder', axis: 'x', name: 'Rear wheel', info: 'The chain drives this wheel.', size: [4, .4, 4], out: [0, 0, 8] } },
            { op: 'part.add', id: 'target', part: { kind: 'box', pos: [0, 0, 0], size: [3, .2, .2], color: 'gray', name: 'Chain', info: 'Transfers rotation from the pedals to the rear wheel.', out: [0, 4, 0] } }
        ] });
        return { content: 'Built the drive system.' };
    };
    await store.transaction(s => createRun(s, auth, id, 'agent', 'Build a bicycle drive system', { elementId: 'target' }));
    const worker = new Worker(store, async () => {}, model); await worker.tick(); await worker.stop();
    const state = await store.read(); expect(state.runs[0].status).toBe('done'); expect(state.boards[id].elements.target).toMatchObject({ version: 4, text: 'Bicycle drive system' });
    expect((state.boards[id].elements.target as any).parts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'block', name: 'Rear wheel', v: 2 }), expect.objectContaining({ name: 'Chain', v: 1 })]));
});
