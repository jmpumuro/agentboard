import { guardDesignWrite } from './design-target';
import { BoardSchema, DRAWING_GUIDE, EMBED_GUIDE, SCENE3D_GUIDE, ElementInputSchema, ElementSchema, GUIDE, OpsRequestSchema, type Actor, type Agent, type Claim, type Element, type OpsResponse, type Run, type User } from 'contract';
import { Algorithm, hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Batch, BoardData, PrivateAgent, State } from '../db/store';
import { fail } from '../lib/errors';
import { renderBoard } from '../render/board-png';
import { authorizeOperation, requireAbility } from './permissions';
export const now = () => new Date().toISOString();
export const uid = (prefix: string) => prefix + '_' + randomBytes(10).toString('hex');
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const scrypt = promisify(scryptCb);
const argon2Options = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export async function passwordHash(password: string) { return argon2Hash(password, argon2Options); }
export async function passwordCheck(password: string, stored: string) {
    if (stored.startsWith('$argon2'))
        return argon2Verify(stored, password);
    const [salt, key] = stored.split(':');
    const derived = await scrypt(password, salt, 64) as Buffer;
    return timingSafeEqual(derived, Buffer.from(key, 'hex'));
}
export type Auth = {
    actor: Actor;
    user?: User;
    agent?: PrivateAgent;
    scopes: string[];
};
export function owner(a: Auth) {
    if (a.user?.role !== 'owner')
        fail('forbidden', 'Only the workspace owner can do this.');
}
export function person(a: Auth) {
    if (!a.user)
        fail('forbidden', 'A signed-in person is required.');
}
export function scope(a: Auth, write = false) {
    if (a.agent?.status === 'revoked')
        fail('forbidden', 'This agent has been revoked.');
    if (!a.scopes.includes(write ? 'boards:write' : 'boards:read'))
        fail('forbidden', 'This agent does not have the required board scope.');
}
export function board(s: State, a: Auth, id: string, write = false, trashed = false): BoardData {
    scope(a, write);
    const b = s.boards[id];
    if (!b || (!trashed && b.board.deletedAt) || (a.agent?.boardIds && !a.agent.boardIds.includes(id)))
        fail('not_found', 'Board not found.');
    return b;
}
export function resolve(s: State, token?: string, sid?: string): Auth {
    if (token) {
        const ag = s.agents.find(x => x.keyHash === hash(token));
        if (!ag)
            fail('unauthorized', 'Invalid API key.');
        if (ag.status === 'revoked')
            fail('forbidden', 'This agent has been revoked.');
        return { actor: { kind: 'agent', id: ag.id, name: ag.name }, agent: ag, scopes: ag.scopes };
    }
    const sess = sid && s.sessions[hash(sid)];
    const user = sess && sess.expires > Date.now() && s.users.find(u => u.id === sess.userId);
    if (!user)
        fail('unauthorized', 'Please sign in.');
    return { actor: { kind: 'user', id: user.id, name: user.name }, user, scopes: ['boards:read', 'boards:write'] };
}
export function publicAgent(a: PrivateAgent): Agent { const { keyHash, secrets, webhookSecret, ...v } = a; return v; }
export function publicUser(u: User & {
    passwordHash?: string;
}): User { const { passwordHash, ...v } = u; return v; }
export function createBoard(s: State, a: Auth, title: string) {
    ability(a, 'add');
    scope(a, true);
    if (a.agent?.boardIds)
        fail('forbidden', 'An agent with limited board access cannot create boards.');
    const b = BoardSchema.parse({ id: uid('brd'), title, seq: 0, order: [], elementCount: 0, createdBy: a.actor, createdAt: now(), updatedAt: now() });
    s.boards[b.id] = { board: b, elements: {}, claims: [], batches: [] };
    return b;
}
export function page<T extends {
    id: string;
}>(items: T[], limit = 50, cursor?: string) { limit = Math.max(1, Math.min(200, limit)); const i = cursor ? items.findIndex(x => x.id === cursor) + 1 : 0; const result = items.slice(i, i + limit); return { items: result, nextCursor: i + limit < items.length ? result.at(-1)?.id : null }; }
export function covers(c: Claim, el: Element) {
    if ('elementIds' in c.target)
        return c.target.elementIds.includes(el.id);
    const r = c.target.rect;
    return el.x >= r.x && el.y >= r.y && el.x + ('w' in el ? el.w : 20) <= r.x + r.w && el.y + ('h' in el ? el.h : 20) <= r.y + r.h;
}
export const ability = requireAbility;
export function readableElements(b: BoardData, omitStrokes = false, omitHtml = false) {
    return Object.values(b.elements).map(e => {
        if (omitHtml && e.type === 'embed') {
            const { html, ...rest } = e;
            return rest;
        }
        if (omitStrokes && e.type === 'drawing') {
            const { strokes, ...rest } = e;
            return rest;
        }
        return e;
    });
}
export function applyOps(s: State, a: Auth, id: string, input: unknown, key?: string): OpsResponse {
    const req = OpsRequestSchema.parse(input);
    const b = board(s, a, id, true);
    const cacheKey = key && a.actor.id + ':' + id + ':' + key;
    const requestHash = hash(JSON.stringify(req));
    if (key && (key.length < 16 || key.length > 128))
        fail('validation_failed', 'Idempotency-Key must contain 16–128 characters.');
    if (cacheKey && s.idempotency[cacheKey]) {
        const cached = s.idempotency[cacheKey];
        if (cached.hash !== requestHash)
            fail('validation_failed', 'Idempotency key was already used for a different request.');
        return cached.response as OpsResponse;
    }
    const activeRun = a.agent && s.runs.find(r => r.agentId === a.agent!.id && r.boardId === id && r.status === 'running');
    if (activeRun) guardDesignWrite(b, activeRun.design, req.ops);
    const before = structuredClone(b.elements), elements = structuredClone(b.elements);
    let order = [...b.board.order];
    const partVersions = structuredClone(b.partVersions ?? {});
    const nextParts = (modelId: string, inputs: any[], previous: any[] = []) => {
        const ledger = partVersions[modelId] ??= {};
        return inputs.map(input => {
            const id = input.id ?? uid('prt');
            const old = previous.find(p => p.id === id);
            const { v: _v, ...data } = input;
            if (!old && ledger[id]) fail('validation_failed', 'A deleted part ID cannot be reused.');
            const same = old && JSON.stringify({ ...old, v: undefined }) === JSON.stringify({ ...data, id, v: undefined });
            const v = same ? old.v : Math.max(ledger[id] ?? 0, old?.v ?? 0) + 1;
            ledger[id] = v;
            return { ...data, id, v };
        });
    };
    const partOnly: Record<string, string[]> = {};
    const whole = new Set(req.ops.flatMap(op => 'id' in op && !op.op.startsWith('part.') ? [op.id!] : []));
    const results: OpsResponse['results'] = [];
    const checkClaim = (el: Element) => {
        if (a.agent && s.settings.requireClaimBeforeAgentWrite && !b.claims.some(c => c.actor.id === a.actor.id && Date.parse(c.expiresAt) > Date.now() && covers(c, el)))
            fail('claim_required', 'Claim the region or elements before writing.');
    };
    for (const op of req.ops) {
        authorizeOperation(a, op, 'id' in op ? elements[op.id!] : undefined);
        if (op.op === 'restack') {
            for (const id of op.ids) {
                const el = elements[id];
                if (!el)
                    fail('not_found', 'Element not found.');
                checkClaim(el);
                results.push({ id, version: el.version });
            }
            order = order.filter(x => !op.ids.includes(x));
            order = op.to === 'front' ? [...order, ...new Set(op.ids)] : [...new Set(op.ids), ...order];
            continue;
        }
        if (op.op === 'create') {
            const elId = op.id ?? uid('el');
            if (elements[elId])
                fail('validation_failed', 'Element ID already exists.');
            const data = op.data.type === 'scene3d' ? { ...op.data, parts: nextParts(elId, op.data.parts) } : op.data;
            const el = ElementSchema.parse({ ...data, id: elId, version: 1, createdBy: a.actor, updatedBy: a.actor, updatedAt: now() });
            checkClaim(el);
            elements[elId] = el;
            order.push(elId);
            results.push({ id: elId, version: 1 });
            continue;
        }
        const current = elements[op.id];
        if (!current)
            fail('not_found', 'Element not found.');
        if (op.op === 'part.add' || op.op === 'part.update' || op.op === 'part.delete') {
            if (current.type !== 'scene3d') fail('validation_failed', 'Part operations require a 3D model.');
            checkClaim(current);
            let parts = [...current.parts];
            let partId: string, partVersion: number | null;
            const ledger = partVersions[op.id] ??= {};
            for (const p of parts) ledger[p.id] = Math.max(ledger[p.id] ?? 0, p.v);
            if (op.op === 'part.add') {
                if (op.part.id && parts.some(p => p.id === op.part.id)) fail('validation_failed', 'Part ID already exists.');
                const p = nextParts(op.id, [op.part])[0];
                parts.push(p); partId = p.id; partVersion = p.v;
            } else {
                const p = parts.find(p => p.id === op.partId);
                if (!p || p.v !== op.ifPartVersion) fail('version_conflict', 'This part changed. Read it again before editing.', { id: op.id, partId: op.partId, expected: op.ifPartVersion, actual: p?.v ?? null, current: p ?? null });
                partId = p.id;
                if (op.op === 'part.delete') {
                    if (a.agent && !s.settings.agentsCanDeleteOthersElements && current.createdBy.id !== a.actor.id) fail('forbidden', 'Agents can only delete parts of models they created.');
                    parts = parts.filter(p => p.id !== partId); partVersion = null;
                } else {
                    partVersion = Math.max(ledger[p.id], p.v) + 1;
                    parts = parts.map(part => part.id === p.id ? { ...part, ...op.data, v: partVersion! } : part);
                    ledger[p.id] = partVersion;
                }
            }
            const el = ElementSchema.parse({ ...current, parts, version: current.version + 1, updatedBy: a.actor, updatedAt: now() });
            elements[op.id] = el;
            if (!whole.has(op.id)) partOnly[op.id] = [...new Set([...(partOnly[op.id] ?? []), partId])];
            results.push({ id: op.id, version: el.version, partId, partVersion });
            continue;
        }
        if (current.version !== op.ifVersion)
            fail('version_conflict', 'This element changed. Your work has been kept.', { id: op.id, expected: op.ifVersion, actual: current.version, current });
        checkClaim(current);
        if (op.op === 'update') {
            if (current.type === 'scene3d' && op.data.parts) for (const input of op.data.parts) {
                if (input.v === undefined) continue;
                const part = current.parts.find(p => p.id === input.id);
                if (!part) fail('validation_failed', 'Versions may only be supplied for existing parts. New part versions are server assigned.', { reason: 'new_part_version', id: current.id, partId: input.id ?? null, hint: 'Remove v from every new part. Do not set it to 1. Use part.add with a writable part definition, or replace parts without v. Keep the starter part ID for one existing part and edit it with part.update.' });
                if (input.v !== part.v) fail('version_conflict', 'A replaced part changed. Read it again before editing.', { id: current.id, partId: part.id, expected: input.v, actual: part.v, current: part });
            }
            const raw = { ...current, ...op.data };
            if (raw.type === 'scene3d') raw.parts = raw.parts.map(({ v: _v, ...p }: any) => p);
            const data = ElementInputSchema.parse(raw);
            if (data.type === 'scene3d' && current.type === 'scene3d') {
                if (op.data.parts && a.agent && !s.settings.agentsCanDeleteOthersElements && current.createdBy.id !== a.actor.id && current.parts.some(p => !data.parts.some(next => next.id === p.id)))
                    fail('forbidden', 'Agents can only delete parts of models they created.');
                data.parts = nextParts(op.id, data.parts, current.parts);
            }
            const el = ElementSchema.parse({ ...data, id: current.id, createdBy: current.createdBy, updatedBy: a.actor, version: current.version + 1, updatedAt: now() });
            checkClaim(el);
            elements[op.id] = el;
            results.push({ id: op.id, version: el.version });
        }
        else {
            if (a.agent && !s.settings.agentsCanDeleteOthersElements && current.createdBy.id !== a.actor.id)
                fail('forbidden', 'Agents can only delete elements they created.');
            delete elements[op.id];
            results.push({ id: op.id, version: null });
            for (const el of Object.values(elements)) {
                if (el.type === 'arrow' && (el.from === op.id || el.to === op.id)) {
                    if (a.agent && !s.settings.agentsCanDeleteOthersElements && el.createdBy.id !== a.actor.id)
                        fail('forbidden', 'Deleting this element would remove another actor’s arrow.');
                    checkClaim(el);
                    delete elements[el.id];
                    results.push({ id: el.id, version: null });
                }
            }
        }
    }
    if (Object.values(elements).filter(e => e.type === 'scene3d').length > 20)
        fail('limit_exceeded', 'Boards support up to 20 3D models.', { limit: 'modelsPerBoard' });
    if (Object.keys(elements).length > 800)
        fail('limit_exceeded', 'Boards support up to 800 elements.', { limit: 'elements' });
    if (Object.values(elements).filter(e => e.type === 'drawing').length > 200)
        fail('limit_exceeded', 'Boards support up to 200 drawings.', { limit: 'drawingsPerBoard' });
    if (Object.values(elements).filter(e => e.type === 'embed').length > 30)
        fail('limit_exceeded', 'Boards support up to 30 embeds.', { limit: 'embedsPerBoard' });
    for (const el of Object.values(elements)) {
        if (el.type === 'arrow' && (el.from === el.to || !elements[el.from] || !elements[el.to] || elements[el.from].type === 'arrow' || elements[el.to].type === 'arrow'))
            fail('validation_failed', 'Arrows must connect two different existing elements.');
    }
    order = order.filter(x => elements[x]);
    const seq = b.board.seq + 1;
    const batch: Batch = { seq, actor: a.actor, before, after: structuredClone(elements), orderBefore: [...b.board.order], orderAfter: order, partOnly, restacked: req.ops.flatMap(op => op.op === 'restack' ? op.ids : []) };
    if (activeRun?.design && 'place' in activeRun.design) activeRun.design = { elementId: results[0].id };
    b.partVersions = partVersions;
    b.elements = elements;
    b.board = { ...b.board, seq, order, elementCount: order.length, updatedAt: now() };
    b.batches.push(batch);
    b.batches = b.batches.slice(-1000);
    const counts = { created: 0, updated: 0, deleted: 0 };
    for (const r of results) {
        if (r.version === null)
            counts.deleted++;
        else if (!before[r.id])
            counts.created++;
        else
            counts.updated++;
    }
    const summary = Object.entries(counts).filter(([, n]) => n).map(([kind, n]) => `${kind === 'created' ? 'added' : kind === 'updated' ? 'updated' : 'deleted'} ${n} element${n === 1 ? '' : 's'}`).join(', ');
    s.activity.unshift({ id: uid('evt'), boardId: id, boardTitle: b.board.title, actor: a.actor, seq, summary: summary || 'restacked elements', counts, at: now() });
    if (activeRun) { if (!activeRun.batches.includes(seq)) activeRun.batches.push(seq); activeRun.touched = [...new Set([...activeRun.touched, ...results.map(r => r.id)])]; }
    const response = { seq, results };
    if (cacheKey)
        s.idempotency[cacheKey] = { hash: requestHash, response, at: Date.now() };
    return response;
}
export function touched(batch: Batch) { return [...new Set([...Object.keys(batch.before), ...Object.keys(batch.after)])].filter(id => JSON.stringify(batch.before[id]) !== JSON.stringify(batch.after[id])); }
// Compare content rather than metadata: undo increments versions, so sequential undo must
// recognise content restored by the previous undo without resetting concurrency tokens.
function content(e: any) {
    if (!e) return e;
    const { version, updatedAt, updatedBy, v, ...rest } = e;
    if (rest.parts) rest.parts = rest.parts.map(content);
    return rest;
}
const equalContent = (a: any, b: any) => JSON.stringify(content(a)) === JSON.stringify(content(b));
function restoreSnapshot(b: BoardData, a: Auth, batch: Batch) {
    const ids = touched(batch);
    const conflicts = ids.filter(id => {
        const partIds = batch.partOnly?.[id], current = b.elements[id], expected = batch.after[id];
        if (partIds && current?.type === 'scene3d' && expected?.type === 'scene3d')
            return partIds.some(pid => !equalContent(current.parts.find(p => p.id === pid), expected.parts.find(p => p.id === pid)));
        return !equalContent(current, expected);
    });
    if (conflicts.length) fail('version_conflict', 'Some elements or parts changed after this work. Nothing was undone.', { ids: conflicts });
    for (const id of ids) {
        const old = batch.before[id], current = b.elements[id], partIds = batch.partOnly?.[id];
        if (!old) { delete b.elements[id]; continue; }
        let prior = structuredClone(old);
        if (partIds && old.type === 'scene3d' && current?.type === 'scene3d') {
            prior = { ...current, parts: [...current.parts.filter(p => !partIds.includes(p.id)), ...old.parts.filter(p => partIds.includes(p.id))] };
            // Preserve the original order where possible, including unrelated newly added parts.
            const order = [...old.parts.map(p => p.id), ...current.parts.map(p => p.id)];
            prior.parts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        }
        if (prior.type === 'scene3d') {
            const ledger = (b.partVersions ??= {})[id] ??= {};
            prior.parts = prior.parts.map(p => {
                const existing = current?.type === 'scene3d' ? current.parts.find(q => q.id === p.id) : undefined;
                const change = !partIds || partIds.includes(p.id);
                const v = change ? Math.max(ledger[p.id] ?? 0, p.v, existing?.v ?? 0) + 1 : p.v;
                ledger[p.id] = Math.max(ledger[p.id] ?? 0, v);
                return { ...p, v };
            });
        }
        prior.version = Math.max(current?.version ?? 0, batch.after[id]?.version ?? 0, old.version) + 1;
        prior.updatedBy = a.actor; prior.updatedAt = now();
        b.elements[id] = ElementSchema.parse(prior);
    }
    return ids;
}
export function revertBatch(s: State, a: Auth, id: string, seq: number) {
    person(a);
    const b = board(s, a, id, true);
    const batch = b.batches.find(x => x.seq === seq);
    if (!batch || seq < b.board.seq - 99)
        fail('not_found', 'Undo record has expired.');
    if (batch.revertedBy)
        fail('validation_failed', 'This change was already reverted.');
    if (batch.restacked?.length) {
        const known = new Set(batch.orderAfter);
        const currentOrder = b.board.order.filter(id => known.has(id));
        const expectedOrder = batch.orderAfter.filter(id => b.elements[id]);
        if (JSON.stringify(currentOrder) !== JSON.stringify(expectedOrder))
            fail('version_conflict', 'Element stacking changed after this batch. Nothing was undone.', { ids: batch.restacked });
    }
    const before = structuredClone(b.elements);
    const ids = restoreSnapshot(b, a, batch);
    const restoredOrder = (Object.keys(batch.partOnly ?? {}).length === ids.length ? b.board.order : batch.orderBefore).filter(x => b.elements[x]);
    for (const id of b.board.order)
        if (b.elements[id] && !restoredOrder.includes(id))
            restoredOrder.push(id);
    const next = b.board.seq + 1;
    batch.revertedBy = next;
    b.batches.push({ seq: next, actor: a.actor, before, after: structuredClone(b.elements), orderBefore: b.board.order, orderAfter: restoredOrder, partOnly: batch.partOnly });
    b.board = { ...b.board, seq: next, order: restoredOrder, elementCount: restoredOrder.length, updatedAt: now() };
    s.activity.unshift({ id: uid('evt'), boardId: id, boardTitle: b.board.title, actor: a.actor, seq: next, summary: `reverted change ${seq}`, counts: { created: 0, updated: ids.length, deleted: 0 }, at: now() });
    return { seq: next, results: ids.map(id => ({ id, version: b.elements[id]?.version ?? null })) };
}
export function digest(b: BoardData, activity: import('contract').ActivityEvent[] = []) {
    const elements = Object.values(b.elements).sort((a, b) => a.y - b.y || a.x - b.x);
    let out = `# ${b.board.title}  (seq ${b.board.seq}, ${elements.length} elements)\n`;
    const non = elements.filter(e => e.type !== 'arrow'), arrows = elements.filter(e => e.type === 'arrow');
    const clip = (s: string) => s.replace(/\s+/g, ' ').slice(0, 200) + (s.length > 200 ? `… [clipped, ${s.length} chars]` : '');
    let shown = 0;
    elementLists: for (const [heading, list] of [['Elements', non], ['Arrows', arrows]] as const) {
        if (!list.length)
            continue;
        out += `\n## ${heading}\n`;
        for (const e of list) {
            let line = e.type === 'arrow' ? `- [${e.id} v${e.version}] ${e.from} -> ${e.to}: ${e.label || ''}` : `- [${e.id} v${e.version}] ${e.type}/${e.type === 'text' ? e.size : e.type === 'scene3d' ? '3d' : e.type === 'embed' ? 'html' : e.type === 'drawing' ? 'ink' : e.type === 'shape' ? e.kind + '/' + e.color : e.color} @${e.x},${e.y}${'w' in e ? ' ' + e.w + 'x' + e.h : ''}: ${clip(e.text)}${e.type === 'scene3d' ? ` (${e.parts.length} parts, pulled apart ${Math.round(e.explode * 100)}%)` : e.type === 'drawing' ? ` (${e.strokes.length} strokes)` : e.type === 'embed' ? ` (${e.html.length} characters of HTML and CSS)` : ''}  (by ${e.updatedBy.name})`;
            if (out.length + line.length > 17500) {
                out += `- … ${elements.length - shown} more elements not shown. Read the board as JSON for the rest.\n`;
                break elementLists;
            }
            out += line + '\n';
            shown++;
            if (e.type === 'scene3d') for (const p of e.parts) {
                const line = `    · part [${p.id} v${p.v}] ${p.kind}/${p.color} “${p.name.replace(/\s+/g, ' ')}” at ${p.pos.join(',')} size ${p.size.join(',')}: ${p.info.replace(/\s+/g, ' ')}\n`;
                if (out.length + line.length > 17500) { out += '    … remaining parts omitted; read full JSON before editing.\n'; break; }
                out += line;
            }
        }
    }
    const recent = activity.filter(e => e.boardId === b.board.id).slice(0, 6);
    if (recent.length)
        out += ('\n## Recent activity (newest first)\n' + recent.map(e => `- ${e.actor.name} ${e.summary}  (${e.at})`).join('\n') + '\n').slice(0, Math.max(0, 19800 - out.length));
    const claims = b.claims.filter(c => Date.parse(c.expiresAt) > Date.now());
    if (claims.length)
        out += ('\n## Active claims\n' + claims.map(c => `- ${c.actor.name}: ${c.note || 'working'}  (expires ${c.expiresAt})`).join('\n') + '\n').slice(0, 20000 - out.length);
    return out.trimEnd();
}
export function claim(s: State, a: Auth, id: string, input: {
    target: Claim['target'];
    note?: string;
}) {
    const b = board(s, a, id, true);
    if (b.claims.filter(c => c.actor.id === a.actor.id && Date.parse(c.expiresAt) > Date.now()).length >= 3)
        fail('limit_exceeded', 'An actor can hold three active claims per board.');
    const c: Claim = { id: uid('clm'), boardId: id, actor: a.actor, ...input, expiresAt: new Date(Date.now() + 60000).toISOString() };
    b.claims.push(c);
    return c;
}
export function search(s: State, a: Auth, q: string, limit = 3) {
    ability(a, 'knowledge');
    const words = q.toLowerCase().split(/\W+/).filter(Boolean);
    return { items: s.knowledge.flatMap(doc => doc.text.match(/.{1,800}(?:\s|$)/gs)?.map(passage => ({ docId: doc.id, title: doc.title, passage, score: words.reduce((n, w) => n + (passage.toLowerCase().includes(w) ? 1 : 0), 0) })) ?? []).filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.min(10, limit)) };
}
export function tool(s: State, a: Auth, name: string, p: any): any {
    switch (name) {
        case 'list_boards':
            scope(a);
            return page(Object.values(s.boards).filter(b => !b.board.deletedAt && (!a.agent?.boardIds || a.agent.boardIds.includes(b.board.id))).map(b => b.board), p.limit, p.cursor);
        case 'view_board': return renderBoard(board(s, a, p.boardId), p.region);
        case 'read_board': {
            const b = board(s, a, p.boardId);
            return p.format === 'json' ? { seq: b.board.seq, order: b.board.order, elements: readableElements(b, !p.includeStrokes, !p.includeHtml), claims: b.claims.filter(c => Date.parse(c.expiresAt) > Date.now()), activity: s.activity.filter(e => e.boardId === p.boardId).slice(0, 6) } : { seq: b.board.seq, text: digest(b, s.activity) };
        }
        case 'create_board':
            ability(a, 'add');
            return createBoard(s, a, p.title);
        case 'write_board': return applyOps(s, a, p.boardId, { ops: p.ops }, p.idempotencyKey);
        case 'claim': return claim(s, a, p.boardId, p);
        case 'release_claim': {
            const b = board(s, a, p.boardId, true);
            const c = b.claims.find(c => c.id === p.claimId);
            if (!c)
                fail('not_found', 'Claim not found.');
            if (c.actor.id !== a.actor.id)
                fail('forbidden', 'This claim belongs to another actor.');
            b.claims = b.claims.filter(c => c.id !== p.claimId);
            return { ok: true };
        }
        case 'search_knowledge': return search(s, a, p.query, p.limit);
        case 'get_guide': return GUIDE + '\n' + DRAWING_GUIDE + '\n' + EMBED_GUIDE + '\n' + SCENE3D_GUIDE;
        default: fail('not_found', 'Unknown tool.');
    }
}
export function revertRun(s: State, a: Auth, run: Run) {
    person(a);
    const b = board(s, a, run.boardId, true);
    if (run.reverted || ['queued', 'running'].includes(run.status))
        fail('validation_failed', 'This run cannot be reverted.');
    const batches = run.batches.map(seq => b.batches.find(x => x.seq === seq));
    if (batches.some(x => !x || x.revertedBy || x.seq < b.board.seq - 99))
        fail('not_found', 'Some undo records have expired or were already reverted.');
    const latest = new Map<string, Element | undefined>(), original = new Map<string, Element | undefined>();
    for (const batch of batches as Batch[]) {
        for (const id of touched(batch)) {
            if (!original.has(id))
                original.set(id, batch.before[id]);
            latest.set(id, batch.after[id]);
        }
    }
    if (!batches.length) { run.reverted = true; return run; }
    const before = structuredClone(b.elements), orderBefore = [...b.board.order];
    const partOnly: Record<string, string[]> = {};
    for (const id of original.keys()) {
        const edits = (batches as Batch[]).filter(batch => touched(batch).includes(id));
        if (edits.every(batch => batch.partOnly?.[id])) partOnly[id] = [...new Set(edits.flatMap(batch => batch.partOnly![id]))];
    }
    restoreSnapshot(b, a, { seq: 0, actor: a.actor, before: Object.fromEntries([...original].filter(([, e]) => e)) as Record<string, Element>, after: Object.fromEntries([...latest].filter(([, e]) => e)) as Record<string, Element>, orderBefore: [], orderAfter: [], partOnly });
    const first = batches[0]!;
    const order = first.orderBefore.filter(id => b.elements[id]);
    for (const id of b.board.order)
        if (b.elements[id] && !order.includes(id))
            order.push(id);
    b.board = { ...b.board, seq: b.board.seq + 1, order, elementCount: order.length, updatedAt: now() };
    for (const batch of batches as Batch[])
        batch.revertedBy = b.board.seq;
    b.batches.push({ seq: b.board.seq, actor: a.actor, before, after: structuredClone(b.elements), orderBefore, orderAfter: order, partOnly });
    s.activity.unshift({ id: uid('evt'), boardId: b.board.id, boardTitle: b.board.title, seq: b.board.seq, actor: a.actor, summary: 'reverted an agent run', counts: { created: 0, updated: original.size, deleted: 0 }, at: now() });
    run.reverted = true;
    return run;
}
