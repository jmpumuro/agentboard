import { DEFAULT_ABILITIES, DRAWING_EXAMPLE, DrawingInput, type Ability } from 'contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore, emptyState, migrateState } from '../apps/api/src/db/store';
import { createApp } from '../apps/api/src/server';
import { Worker, type Model } from '../apps/api/src/services/runner';
const origin = 'http://localhost:4173';
let app: ReturnType<typeof createApp>, store: LocalStore, cookie: string, boardId: string, key: string, agentId: string;
async function request(path: string, method = 'GET', body?: unknown, agent = false) { return app.handle({ url: '/api/v1' + path, method, headers: { origin, ...(agent ? { authorization: 'Bearer ' + key } : { cookie }) }, body }); }
async function mcp(name: string, args: any) { const r = await app.handle({ url: '/mcp', method: 'POST', headers: { authorization: 'Bearer ' + key }, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } }); return r.body.result; }
beforeEach(async () => { store = await new LocalStore().init(); app = createApp(store); const r = await request('/auth/signup', 'POST', { email: 'drawing@example.com', name: 'Alex', password: 'password123' }); cookie = r.headers!['Set-Cookie'].split(';')[0]; boardId = (await request('/boards', 'POST', { title: 'Sketches' })).body.id; const agent = (await request('/agents', 'POST', { name: 'Artist', harness: 'custom', scopes: ['boards:read', 'boards:write'] })).body; key = agent.key; agentId = agent.agent.id; });
afterEach(() => app.close());
const draw = (data: unknown = DRAWING_EXAMPLE, id?: string) => ({ ops: [{ op: 'create', id, data }] });
describe('drawing validation', () => {
    it.each([['non-numbers', [[0, 'a', 10, 10]]], ['odd coordinates', [[0, 0, 10]]], ['one point', [[0, 0]]], ['out of range', [[0, 0, 8001, 10]]], ['non-finite', [[0, 0, Infinity, 10]]]])('rejects %s', async (_label, strokes) => { const r = await request(`/boards/${boardId}/ops`, 'POST', draw({ ...DRAWING_EXAMPLE, strokes })); expect(r.body.error.code).toBe('validation_failed'); });
    it.each([['strokes', Array.from({ length: 301 }, () => [0, 0, 10, 10])], ['points', [Array.from({ length: 20002 }, (_, i) => i % 100)]]])('enforces the %s limit', async (_label, strokes) => { const r = await request(`/boards/${boardId}/ops`, 'POST', draw({ ...DRAWING_EXAMPLE, strokes })); expect(r.body.error.code).toBe('limit_exceeded'); });
    it('requires a short description, dimensions and strokes; strips unknown fields and rounds once', () => {
        for (const field of ['text', 'w', 'h', 'vw', 'vh', 'strokes']) {
            const bad: any = { ...DRAWING_EXAMPLE };
            delete bad[field];
            expect(DrawingInput.safeParse(bad).success).toBe(false);
        }
        expect(DrawingInput.safeParse({ ...DRAWING_EXAMPLE, text: ' ' }).success).toBe(false);
        const parsed = DrawingInput.parse({ ...DRAWING_EXAMPLE, color: 'red', fill: 'script', strokes: [[0.04, 0.05, 100.16, 20.22]] });
        expect(parsed.strokes).toEqual([[0, .1, 100.2, 20.2]]);
        expect(parsed).not.toHaveProperty('fill');
        expect(parsed).not.toHaveProperty('color');
    });
    it('a person and an allowed agent create exactly the same drawing data', async () => {
        const person = await request(`/boards/${boardId}/ops`, 'POST', draw(DRAWING_EXAMPLE, 'human'));
        const agent = await request(`/boards/${boardId}/ops`, 'POST', draw(DRAWING_EXAMPLE, 'agent'), true);
        expect(person.status).toBe(200);
        expect(agent.status).toBe(200);
        const elements = (await request(`/boards/${boardId}/elements`)).body.elements;
        for (const e of elements)
            expect(DrawingInput.parse(e)).toEqual(DRAWING_EXAMPLE);
    });
    it('restores the prior stroke and box through batch undo', async () => { await request(`/boards/${boardId}/ops`, 'POST', draw(DRAWING_EXAMPLE, 'drawing')); const before = (await request(`/boards/${boardId}/elements`)).body.elements[0]; const next = await request(`/boards/${boardId}/ops`, 'POST', { ops: [{ op: 'update', id: 'drawing', ifVersion: 1, data: { x: 100, w: 200, vw: 200, strokes: [...before.strokes, [10, 10, 50, 50]] } }] }); await request(`/boards/${boardId}/batches/${next.body.seq}/revert`, 'POST'); const after = (await request(`/boards/${boardId}/elements`)).body.elements[0]; expect(DrawingInput.parse(after)).toEqual(DrawingInput.parse(before)); });
    it('enforces 200 drawings per board atomically', async () => {
        await store.transaction(s => {
            const b = s.boards[boardId];
            const actor = { kind: 'user' as const, id: 'u', name: 'Alex' };
            for (let i = 0; i < 200; i++) {
                const id = 'd' + i;
                b.elements[id] = { ...DRAWING_EXAMPLE, id, version: 1, createdBy: actor, updatedBy: actor, updatedAt: new Date().toISOString() };
                b.board.order.push(id);
            }
            b.board.elementCount = 200;
        });
        const r = await request(`/boards/${boardId}/ops`, 'POST', draw());
        expect(r.body.error.code).toBe('limit_exceeded');
        expect((await request(`/boards/${boardId}/elements`)).body.elements).toHaveLength(200);
    });
    it('all readers see descriptions, recent context and images; stroke JSON is opt-in for MCP', async () => { await request(`/boards/${boardId}/ops`, 'POST', draw(DRAWING_EXAMPLE, 'drawing')); await request('/agents/' + agentId, 'PATCH', { capabilities: [] }); const text = (await request(`/boards/${boardId}/digest`, 'GET', undefined, true)).body.text; expect(text).toContain('drawing/ink'); expect(text).toContain('(1 strokes)'); expect(text).toContain('Recent activity (newest first)'); expect(text).not.toContain('20,150'); const compact = (await request(`/boards/${boardId}/elements?omit=strokes`, 'GET', undefined, true)).body.elements[0]; expect(compact).not.toHaveProperty('strokes'); const json = JSON.parse((await mcp('read_board', { boardId, format: 'json' })).content[0].text); expect(json.elements[0]).not.toHaveProperty('strokes'); expect(json.activity).toHaveLength(1); const full = JSON.parse((await mcp('read_board', { boardId, format: 'json', includeStrokes: true })).content[0].text); expect(full.elements[0].strokes).toHaveLength(1); const image = await mcp('view_board', { boardId }); expect(image.content[0].type).toBe('image'); expect(Buffer.from(image.content[0].data, 'base64').subarray(1, 4).toString()).toBe('PNG'); });
});
const cases: Ability[] = ['add', 'draw', 'edit', 'delete', 'knowledge'];
for (const ability of cases)
    it(`checks ${ability} over REST, MCP and in runs`, async () => {
        await request(`/boards/${boardId}/ops`, 'POST', draw(DRAWING_EXAMPLE, 'existing'));
        await request('/settings', 'PATCH', { agentsCanDeleteOthersElements: true });
        const operation = ability === 'add' ? { op: 'create', data: { type: 'text', x: 0, y: 0, text: 'new', size: 'body' } } : ability === 'draw' ? { op: 'create', data: DRAWING_EXAMPLE } : ability === 'edit' ? { op: 'update', id: 'existing', ifVersion: 1, data: { x: 200 } } : { op: 'delete', id: 'existing', ifVersion: 1 };
        const args = ability === 'knowledge' ? { query: 'project' } : { boardId, ops: [operation] };
        const caps = [...DEFAULT_ABILITIES, 'delete' as const].filter(c => c !== ability);
        await request('/agents/' + agentId, 'PATCH', { capabilities: caps });
        const rest = ability === 'knowledge' ? await request('/knowledge/search?q=project', 'GET', undefined, true) : await request(`/boards/${boardId}/ops`, 'POST', { ops: [operation] }, true);
        expect(rest.status).toBe(403);
        expect(rest.body.error.details.ability).toBe(ability);
        const result = await mcp(ability === 'knowledge' ? 'search_knowledge' : 'write_board', args);
        expect(JSON.parse(result.content[0].text).error.details.ability).toBe(ability);
        let turn = 0;
        const model: Model = async () => turn++ ? { content: 'done' } : { tool_calls: [{ id: 'call', function: { name: ability === 'knowledge' ? 'search_knowledge' : 'write_board', arguments: JSON.stringify(args) } }] };
        const worker = new Worker(store, async () => { }, model);
        const run = (await request(`/boards/${boardId}/runs`, 'POST', { agentId, message: 'Please ' + ability })).body;
        await worker.tick();
        await worker.stop();
        const finished = (await request('/runs/' + run.id)).body;
        expect(finished.steps.at(-1).status).toBe('skipped');
        expect(finished.reply).toContain(ability);
        await request('/agents/' + agentId, 'PATCH', { capabilities: [...caps, ability] });
        const allowed = await mcp(ability === 'knowledge' ? 'search_knowledge' : 'write_board', args);
        expect(allowed.isError).not.toBe(true);
        async function refreshVersion() {
            if (ability === 'edit' || ability === 'delete') {
                const list = (await request(`/boards/${boardId}/elements`)).body.elements;
                let current = list.find((e: any) => e.id === 'existing');
                if (!current) {
                    await request(`/boards/${boardId}/ops`, 'POST', draw(DRAWING_EXAMPLE, 'existing'));
                    current = (await request(`/boards/${boardId}/elements`)).body.elements.find((e: any) => e.id === 'existing');
                }
                (operation as any).ifVersion = current.version;
            }
        }
        await refreshVersion();
        const restAllowed = ability === 'knowledge' ? await request('/knowledge/search?q=project', 'GET', undefined, true) : await request(`/boards/${boardId}/ops`, 'POST', { ops: [operation] }, true);
        expect(restAllowed.status).toBe(200);
        await refreshVersion();
        turn = 0;
        const allowedWorker = new Worker(store, async () => { }, model);
        const nextRun = (await request(`/boards/${boardId}/runs`, 'POST', { agentId, message: 'Now ' + ability })).body;
        await allowedWorker.tick();
        await allowedWorker.stop();
        const completed = (await request('/runs/' + nextRun.id)).body;
        expect(completed.status).toBe('done');
        expect(completed.steps.at(-1).status).toBe('done');
    });
it('migrates old agents once without granting deletion and preserves later empty abilities', () => { const s = emptyState(); delete s.schemaVersion; s.agents = [{ scopes: ['boards:read', 'boards:write'], capabilities: ['knowledge'] } as any]; migrateState(s); expect(s.agents[0].capabilities).toEqual(['knowledge', 'add', 'draw', 'edit']); s.agents[0].capabilities = []; migrateState(s); expect(s.agents[0].capabilities).toEqual([]); });
it('draw does not grant editing, and abilities never grant a missing write scope', async () => { await request(`/boards/${boardId}/ops`, 'POST', draw(DRAWING_EXAMPLE, 'existing')); await request('/agents/' + agentId, 'PATCH', { capabilities: ['draw'] }); const appended = await request(`/boards/${boardId}/ops`, 'POST', { ops: [{ op: 'update', id: 'existing', ifVersion: 1, data: { strokes: [...DRAWING_EXAMPLE.strokes, [10, 10, 20, 20]] } }] }, true); expect(appended.status).toBe(200); const moved = await request(`/boards/${boardId}/ops`, 'POST', { ops: [{ op: 'update', id: 'existing', ifVersion: 2, data: { x: 999 } }] }, true); expect(moved.body.error.details.ability).toBe('edit'); await request('/agents/' + agentId, 'PATCH', { scopes: ['boards:read'] }); expect((await request(`/boards/${boardId}/ops`, 'POST', draw(), true)).status).toBe(403); });
