import { describe, it, expect } from 'vitest';
import { LocalStore, emptyState } from '../apps/api/src/db/store';
import { applyOps, createBoard, revertBatch, digest, type Auth } from '../apps/api/src/services/core';
const actor = { kind: 'user', id: 'usr_test', name: 'Alex' } as const;
const auth: Auth = { actor, user: { id: actor.id, name: actor.name, email: 'a@b.com', role: 'owner', createdAt: new Date().toISOString() }, scopes: ['boards:read', 'boards:write'] };
const note = { type: 'note', x: 0, y: 0, w: 200, h: 160, text: 'hello', color: 'yellow' };
function setup() { const s = emptyState(); const b = createBoard(s, auth, 'Test'); return { s, id: b.id }; }
describe('stage 2: atomic service and safety', () => {
    it('rolls back an entire bad batch in the store', async () => { const store = await new LocalStore().init(); const id = await store.transaction(s => createBoard(s, auth, 'Atomic').id); await expect(store.transaction(s => applyOps(s, auth, id, { ops: [{ op: 'create', id: 'one', data: note }, { op: 'delete', id: 'missing', ifVersion: 1 }] }))).rejects.toMatchObject({ code: 'not_found' }); expect(Object.keys((await store.read()).boards[id].elements)).toHaveLength(0); });
    it('serializes simultaneous writes and rejects the stale version', async () => { const store = await new LocalStore().init(); const id = await store.transaction(s => createBoard(s, auth, 'Concurrency').id); await store.transaction(s => applyOps(s, auth, id, { ops: [{ op: 'create', id: 'one', data: note }] })); const results = await Promise.allSettled([1, 2].map(x => store.transaction(s => applyOps(s, auth, id, { ops: [{ op: 'update', id: 'one', ifVersion: 1, data: { x } }] })))); expect(results.map(x => x.status).sort()).toEqual(['fulfilled', 'rejected']); expect((results.find(x => x.status === 'rejected') as PromiseRejectedResult).reason.details.current.version).toBe(2); });
    it('deduplicates retries and rejects mismatching bodies', () => { const { s, id } = setup(); const req = { ops: [{ op: 'create', id: 'one', data: note }] }; const key = '1234567890123456'; expect(applyOps(s, auth, id, req, key)).toEqual(applyOps(s, auth, id, req, key)); expect(s.boards[id].board.seq).toBe(1); expect(() => applyOps(s, auth, id, { ops: [{ op: 'create', id: 'two', data: note }] }, key)).toThrow('different request'); });
    it('cascades arrow deletion and refuses broken arrows', () => { const { s, id } = setup(); applyOps(s, auth, id, { ops: [{ op: 'create', id: 'a', data: note }, { op: 'create', id: 'b', data: note }, { op: 'create', id: 'c', data: { type: 'arrow', x: 0, y: 0, from: 'a', to: 'b' } }] }); applyOps(s, auth, id, { ops: [{ op: 'delete', id: 'a', ifVersion: 1 }] }); expect(s.boards[id].elements.c).toBeUndefined(); expect(() => applyOps(s, auth, id, { ops: [{ op: 'create', data: { type: 'arrow', x: 0, y: 0, from: 'b', to: 'b' } }] })).toThrow('two different'); });
    it('restacks without losing new elements', () => { const { s, id } = setup(); applyOps(s, auth, id, { ops: ['a', 'b', 'c'].map(id => ({ op: 'create', id, data: note })) }); applyOps(s, auth, id, { ops: [{ op: 'restack', ids: ['a'], to: 'front' }] }); expect(s.boards[id].board.order).toEqual(['b', 'c', 'a']); });
    it('reverts a batch and refuses to overwrite later work', () => { const { s, id } = setup(); applyOps(s, auth, id, { ops: [{ op: 'create', id: 'a', data: note }] }); revertBatch(s, auth, id, 1); expect(s.boards[id].board.elementCount).toBe(0); applyOps(s, auth, id, { ops: [{ op: 'create', id: 'b', data: note }] }); applyOps(s, auth, id, { ops: [{ op: 'update', id: 'b', ifVersion: 1, data: { text: 'changed' } }] }); expect(() => revertBatch(s, auth, id, 3)).toThrow('changed after'); });
    it('restricts agent scopes, boards and deleting others', () => { const { s, id } = setup(); applyOps(s, auth, id, { ops: [{ op: 'create', id: 'a', data: note }] }); const agent = { id: 'agt_a', status: 'active', capabilities: ['delete'], scopes: ['boards:read'], boardIds: null } as any; const aa: Auth = { actor: { kind: 'agent', id: agent.id, name: 'Agent' }, agent, scopes: agent.scopes }; expect(() => applyOps(s, aa, id, { ops: [{ op: 'delete', id: 'a', ifVersion: 1 }] })).toThrow('scope'); aa.scopes.push('boards:write'); expect(() => applyOps(s, aa, id, { ops: [{ op: 'delete', id: 'a', ifVersion: 1 }] })).toThrow('only delete'); agent.boardIds = []; expect(() => applyOps(s, aa, id, { ops: [{ op: 'delete', id: 'a', ifVersion: 1 }] })).toThrow('Board not found'); });
    it('bounds and clips the digest', () => { const { s, id } = setup(); applyOps(s, auth, id, { ops: [{ op: 'create', id: 'a', data: { ...note, text: 'x'.repeat(4000) } }] }); expect(digest(s.boards[id])).toContain('… [clipped, 4000 chars]'); });
});
it('matches the exact compact digest format and stays within the total budget', () => {
    const { s, id } = setup();
    applyOps(s, auth, id, { ops: [{ op: 'create', id: 'a', data: note }] });
    expect(digest(s.boards[id])).toBe('# Test  (seq 1, 1 elements)\n\n## Elements\n- [a v1] note/yellow @0,0 200x160: hello  (by Alex)');
    const example = s.boards[id].elements.a;
    for (let i = 0; i < 799; i++)
        s.boards[id].elements['long_' + i] = { ...example, id: 'long_' + i, text: 'x'.repeat(4000) } as any;
    s.boards[id].board.elementCount = 800;
    const text = digest(s.boards[id], s.activity);
    expect(text).toContain('Recent activity (newest first)');
    expect(text.length).toBeLessThanOrEqual(20000);
    expect(text).toContain('more elements not shown. Read the board as JSON for the rest.');
});
