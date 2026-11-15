import { E2E_ORIGIN } from './environment';
import { loadProviderConfig } from '../../apps/api/src/config/provider';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
// Test-only injected model; production main.ts never imports this fixture.
import { LocalStore } from '../../apps/api/src/db/store';
import { createApp } from '../../apps/api/src/server';
import type { Model } from '../../apps/api/src/services/runner';
import { ENGINE_MODEL } from '../../packages/contract/src/scene3d/example';
import { DRAWING_EXAMPLE, STARTER_EMBED } from 'contract';
const model: Model = async (messages) => {
    const boardId = messages[0].content.match(/Current board: (\S+)/)?.[1];
    const request = String([...messages].reverse().find(m => m.role === 'user' && typeof m.content === 'string')?.content);
    const mockup = /mockup|HTML\/CSS|pricing/i.test(request);
    const results = messages.filter(m => m.role === 'tool');
    if (!results.length)
        return { tool_calls: [{ id: 'read', function: { name: 'read_board', arguments: JSON.stringify({ boardId, format: 'json', includeHtml: true }) } }] };
    const targetId = messages.find(m => m.role === 'system' && /Refine the EXISTING/.test(m.content))?.content.match(/element (\S+) in place/)?.[1];
    if (/engine|3D|model/i.test(request) && results.length === 1) {
        const snapshot = JSON.parse(results[0].content), existing = snapshot.elements.find((e: any) => e.id === targetId);
        if (existing?.type === 'scene3d') {
            const parts = ENGINE_MODEL.parts.map((p, i) => ({ ...p, id: i === 0 ? existing.parts[0].id : p.id }));
            return { tool_calls: [{ id: 'model', function: { name: 'write_board', arguments: JSON.stringify({ boardId, ops: [{ op: 'update', id: existing.id, ifVersion: existing.version, data: { text: ENGINE_MODEL.text, parts, prompt: request.slice(0, 1000) } }] }) } }] };
        }
    }
    if (mockup && results.length === 1) {
        const existingId = targetId;
        const snapshot = JSON.parse(results[0].content);
        const existing = existingId && snapshot.elements.find((e: any) => e.id === existingId);
        const placement = messages.find(m => m.role === 'system' && /Create one HTML\/CSS embed near/.test(m.content))?.content.match(/near (-?[\d.]+),(-?[\d.]+)/);
        const data = { ...STARTER_EMBED, x: placement ? Number(placement[1]) : 120, y: placement ? Number(placement[2]) : 100, text: existing ? 'Refined pricing mockup' : 'Pricing mockup', html: '<style>body{margin:0;padding:20px;background:#e5efdf;color:#20331b;font:16px system-ui}</style><h1>' + (existing ? 'Refined pricing' : 'Three simple plans') + '</h1><p>A self-contained mockup.</p>' };
        return { tool_calls: [{ id: 'mockup', function: { name: 'write_board', arguments: JSON.stringify({ boardId, ops: [existing ? { op: 'update', id: existing.id, ifVersion: existing.version, data: { html: data.html, text: data.text } } : { op: 'create', data }] }) } }] };
    }
    if (results.length === 1)
        return { tool_calls: [{ id: 'draw', function: { name: 'write_board', arguments: JSON.stringify({ boardId, ops: [{ op: 'create', data: { ...DRAWING_EXAMPLE, x: 500, y: 250, text: 'A test triangle from the model fixture' } }] }) } }] };
    return { content: mockup ? 'Created a live mockup on the board.' : 'I drew a test triangle in open space.' };
};
if (process.env.E2E_REAL_MODEL) await loadProviderConfig();
const directory = await mkdtemp(tmpdir() + '/agentboard-browser-');
const store = await new LocalStore(directory + '/workspace.json').init();
const app = createApp(store, { origin: E2E_ORIGIN, ...(process.env.E2E_REAL_MODEL ? {} : { model }) });
await app.worker.start();
app.server.listen(Number(new URL(E2E_ORIGIN).port), '127.0.0.1');
process.on('SIGTERM', async () => { await app.close(); process.exit(0); });
