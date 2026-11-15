import { expect, it } from 'vitest';
import { LocalStore } from '../apps/api/src/db/store';
import { applyOps, createBoard, type Auth } from '../apps/api/src/services/core';
import { Worker, createRun, type Model } from '../apps/api/src/services/runner';

const auth: Auth = { actor: { kind: 'user', id: 'u', name: 'Alex' }, user: { id: 'u', name: 'Alex', email: 'a@example.com', role: 'owner', createdAt: new Date().toISOString() }, scopes: ['boards:read', 'boards:write'] };

it.each([false, true])('normalizes observed versions without overwriting a concurrent human edit (%s)', async concurrent => {
    const store = await new LocalStore().init();
    const agent: any = { id: 'agt_test', name: 'test', harness: 'custom', scopes: ['boards:read', 'boards:write'], capabilities: ['add', 'draw', 'edit', 'knowledge'], instructions: '', mcpServers: [], runner: { kind: 'builtin' }, boardIds: null, status: 'active', keyHash: 'hashed-only', keyPrefix: 'ab_live', lastSeenAt: null, createdAt: new Date().toISOString() };
    const board = await store.transaction(s => {
        s.agents.push(agent);
        const created = createBoard(s, auth, 'Notifications');
        applyOps(s, auth, created.id, { ops: [{ op: 'create', id: 'inbox', data: { type: 'note', x: 420, y: 160, w: 220, h: 140, text: 'Inbox', color: 'yellow' } }] });
        return created;
    });
    let turn = 0;
    const seen: string[] = [];
    const model: Model = async messages => {
        seen.push(messages.at(-1)?.content ?? '');
        const step = turn++;
        if (step === 0)
            return { tool_calls: [{ id: 'read', function: { name: 'read_board', arguments: JSON.stringify({ format: 'json' }) } }] };
        if (step === 1 && concurrent) await store.transaction(s => applyOps(s, auth, board.id, { ops: [{ op: 'update', id: 'inbox', ifVersion: 1, data: { text: 'Human revision' } }] }));
        if (step === 1)
            return { tool_calls: [{ id: 'sketch', function: { name: 'write_board', arguments: JSON.stringify({ ops: [
                { op: 'create', id: 'bell', data: { type: 'drawing', x: 80, y: 140, w: 180, h: 180, text: 'Notification bell', strokes: [[[30, 150], [90, 40], [150, 150], [30, 150]], [[70, 155], [110, 155]]] } },
                { op: 'create', id: 'phone', data: { type: 'note', x: 80, y: 380, w: 220, h: 140, text: 'Phone', color: 'blue' } },
                { op: 'create', data: { type: 'arrow', from: 'bell', to: 'inbox', label: 'push' } },
                { op: 'create', data: { type: 'arrow', from: 'bell', to: 'phone', label: 'push' } },
                { op: 'update', id: 'inbox', ifVersion: 0, data: { text: 'Whoever is listening' } },
            ] }) } }] };
        return { content: 'Sketched a bell and pointed it at both listeners.' };
    };
    const worker = new Worker(store, async () => { }, model);
    await store.transaction(s => createRun(s, auth, board.id, agent.id, 'maybe sketch how a notification could reach people, and point at them if that helps'));
    await worker.tick();
    await worker.stop();
    const state = await store.read();
    const elements = Object.values(state.boards[board.id].elements);
    const bell = elements.find(element => element.type === 'drawing');
    const arrows = elements.filter(element => element.type === 'arrow');
    if (concurrent) {
        expect(state.boards[board.id].elements.inbox).toMatchObject({ text: 'Human revision', version: 2 });
        expect(state.runs[0].steps.some(step => step.name === 'write_board' && step.status === 'failed')).toBe(true);
        expect(elements).toHaveLength(1);
        await store.close(); return;
    }
    expect(state.runs[0].status, state.runs[0].error?.message).toBe('done');
    expect(state.runs[0].steps.filter(step => step.name === 'write_board').every(step => step.status === 'done')).toBe(true);
    expect(bell).toMatchObject({ text: 'Notification bell', vw: 180, vh: 180 });
    expect(bell && bell.type === 'drawing' ? bell.strokes : []).toEqual([[30, 150, 90, 40, 150, 150, 30, 150], [70, 155, 110, 155]]);
    expect(arrows.map(arrow => arrow.type === 'arrow' ? [arrow.from, arrow.to, arrow.label] : [])).toEqual([['bell', 'inbox', 'push'], ['bell', 'phone', 'push']]);
    expect(state.boards[board.id].elements.inbox).toMatchObject({ text: 'Whoever is listening', version: 2 });
    expect(seen[0]).toContain('maybe sketch');
    await store.close();
});
