import { DRAWING_EXAMPLE } from 'contract';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LocalStore } from '../apps/api/src/db/store';
import { createApp } from '../apps/api/src/server';
import { Worker, type Model } from '../apps/api/src/services/runner';

const origin = 'http://localhost:4173';
let app: ReturnType<typeof createApp>, store: LocalStore, cookie: string, boardId: string, key: string, agentId: string;

async function request(path: string, method = 'GET', body?: unknown, agent = false) {
    return app.handle({ url: '/api/v1' + path, method, headers: { origin, ...(agent ? { authorization: 'Bearer ' + key } : { cookie }) }, body });
}
async function mcp(method: string, params?: unknown) {
    const response = await app.handle({ url: '/mcp', method: 'POST', headers: { authorization: 'Bearer ' + key }, body: { jsonrpc: '2.0', id: 1, method, params } });
    return response.body.result;
}
function elements() { return request(`/boards/${boardId}/elements`).then(response => response.body.elements as any[]); }
async function allow(capabilities: string[]) {
    expect((await request('/agents/' + agentId, 'PATCH', { capabilities })).status).toBe(200);
}
function act(payload: unknown, name = 'write_board'): Model {
    return async messages => {
        if (messages.some(message => message.role === 'tool' && !String(message.content).includes('"error"')))
            return { content: 'Done.' };
        return { tool_calls: [{ id: 'call', function: { name, arguments: JSON.stringify(payload) } }] };
    };
}
async function run(message: string, model: Model) {
    const created = await request(`/boards/${boardId}/runs`, 'POST', { agentId, message });
    const worker = new Worker(store, async () => { }, model);
    await worker.tick();
    await worker.stop();
    return (await request('/runs/' + created.body.id)).body;
}

beforeEach(async () => {
    store = await new LocalStore().init();
    app = createApp(store);
    const session = await request('/auth/signup', 'POST', { email: 'capabilities@example.com', name: 'Alex', password: 'password123' });
    cookie = session.headers!['Set-Cookie'].split(';')[0];
    boardId = (await request('/boards', 'POST', { title: 'Capability checks' })).body.id;
    const agent = (await request('/agents', 'POST', { name: 'Capability agent', harness: 'custom', scopes: ['boards:read', 'boards:write'], capabilities: ['add', 'draw', 'edit', 'delete', 'knowledge'] })).body;
    key = agent.key;
    agentId = agent.agent.id;
    await request('/knowledge', 'POST', { title: 'Launch note', text: 'The Saturday launch needs a bell notification.' });
    await request(`/boards/${boardId}/ops`, 'POST', { ops: [{ op: 'create', id: 'human', data: { type: 'note', x: 700, y: 40, w: 180, h: 120, text: 'A person wrote this', color: 'white' } }] });
});
afterEach(() => app.close());

it('exercises add, draw, edit, delete and knowledge as separate agent runs', async () => {
    await allow(['add']);
    const added = await run('Add a note', act({ ops: [{ op: 'create', id: 'idea', data: { type: 'note', x: 40, y: 40, w: 200, h: 140, text: 'Notify the team', color: 'yellow' } }] }));
    expect(added, JSON.stringify({ error: added.error, steps: added.steps })).toMatchObject({ status: 'done' });
    expect((await elements()).find(element => element.id === 'idea')).toMatchObject({ text: 'Notify the team', createdBy: { id: agentId } });
    const refusedDraw = await run('Draw instead', act({ ops: [{ op: 'create', data: DRAWING_EXAMPLE }] }));
    expect(refusedDraw.steps.at(-1)).toMatchObject({ status: 'skipped' });
    expect(refusedDraw.reply).toContain('draw');
    expect((await elements()).some(element => element.type === 'drawing')).toBe(false);

    await allow(['draw']);
    const drawn = await run('Draw a bell', act({ ops: [{ op: 'create', id: 'bell', data: DRAWING_EXAMPLE }] }));
    expect(drawn.steps.at(-1).status).toBe('done');
    expect((await elements()).find(element => element.id === 'bell').type).toBe('drawing');
    const sneakyMove = await run('Move the drawing while adding a stroke', act({ ops: [{ op: 'update', id: 'bell', ifVersion: 1, data: { x: 900, strokes: [...DRAWING_EXAMPLE.strokes, [4, 4, 20, 20]] } }] }));
    expect(sneakyMove.reply).toContain('edit');
    expect((await elements()).find(element => element.id === 'bell').x).toBe(DRAWING_EXAMPLE.x);
    const stroke = await run('Add a stroke', act({ ops: [{ op: 'update', id: 'bell', ifVersion: 1, data: { strokes: [...DRAWING_EXAMPLE.strokes, [4, 4, 20, 20]] } }] }));
    expect(stroke.steps.at(-1).status).toBe('done');
    expect((await elements()).find(element => element.id === 'bell').strokes).toHaveLength(2);

    await allow(['edit']);
    const edited = await run('Move the note and bring it forward', act({ ops: [{ op: 'update', id: 'idea', ifVersion: 1, data: { x: 240, text: 'Notify the whole team' } }, { op: 'restack', ids: ['idea'], to: 'front' }] }));
    expect(edited.steps.at(-1).status).toBe('done');
    const idea = (await elements()).find(element => element.id === 'idea');
    expect(idea).toMatchObject({ x: 240, text: 'Notify the whole team', version: 2 });
    const refusedAdd = await run('Add another note', act({ ops: [{ op: 'create', data: { type: 'text', x: 0, y: 0, text: 'extra', size: 'body' } }] }));
    expect(refusedAdd.reply).toContain('add');
    expect((await elements()).some(element => element.text === 'extra')).toBe(false);

    await allow(['delete']);
    const refusedHuman = await run('Delete the human note', act({ ops: [{ op: 'delete', id: 'human', ifVersion: 1 }] }));
    expect(refusedHuman.reply).toContain('only delete elements they created');
    expect((await elements()).some(element => element.id === 'human')).toBe(true);
    const deleted = await run('Delete the note I added', act({ ops: [{ op: 'delete', id: 'idea', ifVersion: 2 }] }));
    expect(deleted.steps.at(-1).status).toBe('done');
    expect((await elements()).some(element => element.id === 'idea')).toBe(false);

    await allow(['knowledge']);
    let found = '';
    const searched = await run('What do we know about the launch?', async messages => {
        const tool = messages.find(message => message.role === 'tool');
        if (!tool)
            return { tool_calls: [{ id: 'search', function: { name: 'search_knowledge', arguments: JSON.stringify({ query: 'launch' }) } }] };
        found = tool.content;
        return { content: 'The library mentions a Saturday launch.' };
    });
    expect(searched).toMatchObject({ status: 'done', reply: 'The library mentions a Saturday launch.' });
    expect(found).toContain('Launch note');
    const names = (await mcp('tools/list')).tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('search_knowledge');
    expect(names).not.toContain('write_board');
    await allow(['add']);
    const writing = (await mcp('tools/list')).tools.map((tool: { name: string }) => tool.name);
    expect(writing).toContain('write_board');
    expect(writing).not.toContain('search_knowledge');
});
