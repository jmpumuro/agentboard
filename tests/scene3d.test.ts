import { beforeEach, afterEach, it, expect } from 'vitest';
import { STARTER_SCENE, ElementInputSchema, OpsRequestSchema } from 'contract';
import { LocalStore } from '../apps/api/src/db/store';
import { createApp } from '../apps/api/src/server';
import { renderBoard } from '../apps/api/src/render/board-png';
let app: ReturnType<typeof createApp>, store: LocalStore, cookie: string, id: string, key: string, agentId: string;
async function req(path: string, method = 'GET', body?: unknown, agent = false) { return app.handle({ url: '/api/v1' + path, method, body, headers: { origin: 'http://localhost:4173', ...(agent ? { authorization: 'Bearer ' + key } : { cookie }) } }); }
const write = (ops: unknown[], agent = false) => req(`/boards/${id}/ops`, 'POST', { ops }, agent);
const read = async () => (await req(`/boards/${id}/elements`)).body.elements[0];
const create = () => write([{ op: 'create', id: 'model', data: { ...STARTER_SCENE, parts: [{ ...STARTER_SCENE.parts[0], id: 'block' }] } }]);
const update = (partId: string, v: number, data: unknown) => ({ op: 'part.update', id: 'model', partId, ifPartVersion: v, data });
beforeEach(async () => { store = await new LocalStore().init(); app = createApp(store); const signup = await req('/auth/signup', 'POST', { email: '3d@example.com', name: 'Alex', password: 'password123' }); cookie = signup.headers!['Set-Cookie'].split(';')[0]; id = (await req('/boards', 'POST', { title: 'Models' })).body.id; const agent = (await req('/agents', 'POST', { name: 'Builder', harness: 'custom', scopes: ['boards:read', 'boards:write'] })).body; key = agent.key; agentId = agent.agent.id; });
afterEach(() => app.close());
it('validates bounds, duplicate IDs, primitive kinds and server-owned versions', () => {
    expect(ElementInputSchema.safeParse({ ...STARTER_SCENE, parts: [{ ...STARTER_SCENE.parts[0], size: [0, 2, 2] }] }).success).toBe(false);
    expect(ElementInputSchema.safeParse({ ...STARTER_SCENE, parts: Array(61).fill(STARTER_SCENE.parts[0]) }).success).toBe(false);
    expect(ElementInputSchema.safeParse({ ...STARTER_SCENE, parts: [{ ...STARTER_SCENE.parts[0], v: 99 }] }).success).toBe(false);
    expect(OpsRequestSchema.safeParse({ ops: [update('block', 1, { id: 'changed' })] }).success).toBe(false);
});
it('shares human and agent parts, versions, digest, JSON, and atomic conflicts', async () => {
    expect((await create()).status).toBe(200);
    expect((await write([{ op: 'part.add', id: 'model', part: { ...STARTER_SCENE.parts[0], id: 'second', name: 'Drive shaft' } }])).status).toBe(200);
    const agentEdit = await write([update('block', 1, { size: [3, 2, 2] })], true);
    expect(agentEdit.body.results[0]).toMatchObject({ id: 'model', partId: 'block', partVersion: 2, version: 3 });
    expect((await write([update('second', 1, { pos: [4, 0, 0] })])).status).toBe(200);
    const stale = await write([update('block', 1, { name: 'stale' })]);
    expect(stale.body.error).toMatchObject({ code: 'version_conflict', details: { partId: 'block', expected: 1, actual: 2, current: { name: 'Starter block' } } });
    const failed = await write([update('second', 2, { name: 'must roll back' }), update('block', 1, { name: 'bad' })]);
    expect(failed.status).toBe(409); expect((await read()).parts[1].name).toBe('Drive shaft');
    const digest = (await req(`/boards/${id}/digest`)).body.text;
    expect(digest).toContain('scene3d/3d'); expect(digest).toContain('part [block v2]'); expect(digest).toContain('Drive shaft');
    const json = await app.handle({ url: '/mcp', method: 'POST', headers: { authorization: 'Bearer ' + key }, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_board', arguments: { boardId: id, format: 'json' } } } });
    expect(JSON.parse(json.body.result.content[0].text).elements[0].parts).toHaveLength(2);
});
it('supports sequential undo/redo with increasing part versions and preserves unrelated edits', async () => {
    await create();
    const a = await write([update('block', 1, { name: 'First edit' })]);
    const b = await write([update('block', 2, { name: 'Second edit' })]);
    await write([{ op: 'part.add', id: 'model', part: { ...STARTER_SCENE.parts[0], id: 'other' } }]);
    const undoB = await req(`/boards/${id}/batches/${b.body.seq}/revert`, 'POST'); expect(undoB.status).toBe(200);
    expect((await read()).parts.find((p: any) => p.id === 'block')).toMatchObject({ name: 'First edit', v: 4 });
    expect((await req(`/boards/${id}/batches/${a.body.seq}/revert`, 'POST')).status).toBe(200);
    expect((await read()).parts).toHaveLength(2); expect((await read()).parts.find((p: any) => p.id === 'block')).toMatchObject({ name: 'Starter block', v: 5 });
    expect((await write([update('block', 2, { name: 'old op' })])).status).toBe(409);
});
it('enforces abilities, claims, parent ownership deletion and model/part caps', async () => {
    await req('/agents/' + agentId, 'PATCH', { capabilities: ['draw'] });
    expect((await write([{ op: 'create', data: STARTER_SCENE }], true)).body.error.details.ability).toBe('add');
    await create(); expect((await write([update('block', 1, { name: 'no' })], true)).body.error.details.ability).toBe('edit');
    await req('/agents/' + agentId, 'PATCH', { capabilities: ['edit'] });
    expect((await write([{ op: 'part.delete', id: 'model', partId: 'block', ifPartVersion: 1 }], true)).status).toBe(403);
    await req('/settings', 'PATCH', { requireClaimBeforeAgentWrite: true });
    expect((await write([update('block', 1, { name: 'claim' })], true)).body.error.code).toBe('claim_required');
    const tooMany = await write(Array.from({ length: 20 }, (_, i) => ({ op: 'create', id: 'model_' + i, data: STARTER_SCENE })));
    expect(tooMany.body.error.code).toBe('limit_exceeded');
    expect((await write([{ op: 'update', id: 'model', ifVersion: 1, data: { parts: Array.from({ length: 60 }, (_, i) => ({ ...STARTER_SCENE.parts[0], id: 'part_' + i })) } }])).status).toBe(200);
    expect((await write([{ op: 'part.add', id: 'model', part: STARTER_SCENE.parts[0] }])).status).toBe(422);
});
it('never resets part versions on replacement, deletion, or restoration', async () => {
    await create(); await write([update('block', 1, { name: 'Changed' })]);
    expect((await write([{ op: 'update', id: 'model', ifVersion: 2, data: { parts: [{ ...STARTER_SCENE.parts[0], id: 'block' }] } }])).status).toBe(200);
    expect((await read()).parts[0].v).toBe(3);
    const del = await write([{ op: 'part.delete', id: 'model', partId: 'block', ifPartVersion: 3 }]);
    expect(del.body.results[0].partVersion).toBeNull();
    expect((await write([{ op: 'part.add', id: 'model', part: { ...STARTER_SCENE.parts[0], id: 'block' } }])).status).toBe(422);
    await req(`/boards/${id}/batches/${del.body.seq}/revert`, 'POST'); expect((await read()).parts[0].v).toBe(4);
});
it('renders the actual saved primitive model in view_board without WebGL', async () => { await create(); const b = (await store.read()).boards[id]; const image = renderBoard(b); expect(image.mimeType).toBe('image/png'); expect(image.width).toBeLessThanOrEqual(2000); const { createCanvas, loadImage } = await import('@napi-rs/canvas'); const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d'); ctx.drawImage(await loadImage(Buffer.from(image.data, 'base64')), 0, 0); const data = ctx.getImageData(0, 0, image.width, image.height).data; let blue = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 2] > data[i] + 20 && data[i + 2] > data[i + 1] + 5) blue++; expect(blue).toBeGreaterThan(500); });
it('prevents full-list replacement from bypassing destructive part restrictions', async () => {
    await create();
    const result = await write([{ op: 'update', id: 'model', ifVersion: 1, data: { parts: [] } }], true);
    expect(result.status).toBe(403); expect((await read()).parts).toHaveLength(1);
});
it('serves a protected still for an existing model and rejects other element types', async () => {
    await create(); const frame = await req(`/boards/${id}/scenes/model/frame`);
    expect(frame.status).toBe(200); expect(frame.headers?.['Content-Type']).toBe('image/png');
    expect(frame.body.subarray(1, 4).toString()).toBe('PNG');
    await req('/agents/' + agentId, 'PATCH', { boardIds: [] }); expect((await req(`/boards/${id}/scenes/model/frame`, 'GET', undefined, true)).status).toBe(404);
});
it('persists part versions and deletion tombstones through a store reload', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os');
    const core = await import('../apps/api/src/services/core');
    const dir = await mkdtemp(tmpdir() + '/agentboard-3d-');
    try {
        const persistent = await new LocalStore(dir + '/workspace.json').init();
        const u = (await store.read()).users[0], a: import('../apps/api/src/services/core').Auth = { user: u, actor: { kind: 'user', id: u.id, name: u.name }, scopes: ['boards:read', 'boards:write'] };
        const bid = await persistent.transaction(s => { const b = core.createBoard(s, a, 'Durable'); core.applyOps(s, a, b.id, { ops: [{ op: 'create', id: 'model', data: { ...STARTER_SCENE, parts: [{ ...STARTER_SCENE.parts[0], id: 'block' }] } }] }); return b.id; });
        await persistent.transaction(s => core.applyOps(s, a, bid, { ops: [update('block', 1, { name: 'Persisted' })] }));
        await persistent.close(); const reopened = await new LocalStore(dir + '/workspace.json').init();
        expect((await reopened.read()).boards[bid].elements.model).toMatchObject({ parts: [{ id: 'block', name: 'Persisted', v: 2 }] });
        await reopened.transaction(s => core.applyOps(s, a, bid, { ops: [{ op: 'part.delete', id: 'model', partId: 'block', ifPartVersion: 2 }] }));
        await reopened.close(); const third = await new LocalStore(dir + '/workspace.json').init();
        await expect(third.transaction(s => core.applyOps(s, a, bid, { ops: [{ op: 'part.add', id: 'model', part: { ...STARTER_SCENE.parts[0], id: 'block' } }] }))).rejects.toMatchObject({ code: 'validation_failed' });
        await third.close();
    } finally { await rm(dir, { recursive: true, force: true }); }
});
it('accepts observed read-only versions in whole-model replacements without allowing version forgery', async () => {
    await create(); const model = await read();
    const changed = await write([{ op: 'update', id: 'model', ifVersion: model.version, data: { parts: model.parts.map((p: any) => ({ ...p, name: 'Updated from JSON' })) } }]);
    expect(changed.status).toBe(200); expect((await read()).parts[0]).toMatchObject({ v: 2, name: 'Updated from JSON' });
    const stale = await write([{ op: 'update', id: 'model', ifVersion: 2, data: { parts: model.parts } }]);
    expect(stale.body.error).toMatchObject({ code: 'version_conflict', details: { partId: 'block', expected: 1, actual: 2 } });
});
it('connects an HTML mockup and a 3D model using an ordinary shared arrow', async () => {
    await create(); const { STARTER_EMBED } = await import('contract');
    await write([{ op: 'create', id: 'button', data: STARTER_EMBED }]);
    const connected = await write([{ op: 'create', id: 'connection', data: { type: 'arrow', x: 0, y: 0, from: 'button', to: 'model', label: 'connected' } }], true);
    expect(connected.status).toBe(200); expect((await store.read()).boards[id].elements.connection).toMatchObject({ type: 'arrow', from: 'button', to: 'model', createdBy: { id: agentId } });
    expect((await read()).parts[0].v).toBe(1);
});
