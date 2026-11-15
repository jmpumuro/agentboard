import { staticWeb } from './lib/static-web';
import { renderBoard } from './render/board-png';
import * as c from 'contract';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { z, ZodError } from 'zod';
import { listenBoardOps } from './db/postgres';
import { type State, type Store } from './db/store';
import { AppError, fail } from './lib/errors';
import { prepareAgent } from './services/agents';
import * as core from './services/core';
import { boardModelTools } from './services/model-context';
import { createRun, Worker, type Model } from './services/runner';
export type Request = {
    method: string;
    url: string;
    headers: Record<string, string | undefined>;
    body?: any;
    ip?: string;
};
export type Result = {
    status: number;
    body?: any;
    headers?: Record<string, string>;
};
export function createApp(store: Store, options: {
    origin?: string;
    model?: Model;
} = {}) {
    const origin = options.origin ?? process.env.WEB_ORIGIN ?? 'http://localhost:4173';
    const wss = new WebSocketServer({ noServer: true });
    const clients = new Map<WebSocket, {
        boardId: string;
        auth: core.Auth;
        cursor: {
            x: number;
            y: number;
        } | null;
        lastSeq: number;
        lastRun: string;
        claims: string[];
    }>();
    const limits = new Map<string, {
        count: number;
        end: number;
    }>();
    async function throttle(key: string, max: number, ms: number) {
        if (store.throttle) {
            await store.throttle(key, max, ms);
            return;
        }
        const v = limits.get(key);
        if (v && v.end > Date.now()) {
            if (++v.count > max)
                fail('rate_limited', 'Too many requests. Try again shortly.');
        }
        else
            limits.set(key, { count: 1, end: Date.now() + ms });
    }
    const send = (ws: WebSocket, msg: unknown) => {
        if (ws.bufferedAmount > 1048576)
            ws.close(1013, 'Please reconnect');
        else if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify(msg));
    };
    const resyncBoard = (boardId?: string) => {
        for (const [ws, client] of clients)
            if (!boardId || client.boardId === boardId)
                send(ws, { t: 'resync' });
    };
    const boardListen = process.env.DATABASE_URL
        ? listenBoardOps(process.env.DATABASE_URL, {
            onNotify: boardId => resyncBoard(boardId),
            onReconnect: () => resyncBoard()
        })
        : undefined;
    async function broadcast(id: string) {
        const s = await store.read();
        const b = s.boards[id];
        if (!b)
            return;
        for (const [ws, client] of clients) {
            if (client.boardId !== id)
                continue;
            const ag = client.auth.agent && s.agents.find(a => a.id === client.auth.agent!.id);
            if (b.board.deletedAt || ag && (ag.status === 'revoked' || ag.boardIds && !ag.boardIds.includes(id))) {
                ws.close(1008, 'Access ended');
                continue;
            }
            for (const batch of b.batches.filter(x => x.seq > client.lastSeq)) {
                send(ws, batchMessage(batch));
                client.lastSeq = batch.seq;
            }
            send(ws, { t: 'board', board: b.board });
            const runs = s.runs.filter(r => r.boardId === id);
            const signature = JSON.stringify(runs);
            if (signature !== client.lastRun) {
                for (const run of runs)
                    send(ws, { t: 'run', run });
                client.lastRun = signature;
            }
            const active = b.claims.filter(c => Date.parse(c.expiresAt) > Date.now());
            for (const claim of active)
                if (!client.claims.includes(claim.id))
                    send(ws, { t: 'claim', claim });
            for (const claimId of client.claims)
                if (!active.some(c => c.id === claimId))
                    send(ws, { t: 'claimEnd', claimId });
            client.claims = active.map(c => c.id);
        }
    }
    function batchMessage(batch: import('./db/store').Batch) { return { t: 'ops', seq: batch.seq, actor: batch.actor, order: batch.orderAfter, ops: core.touched(batch).map(id => batch.after[id] ? { op: batch.before[id] ? 'update' : 'create', element: batch.after[id] } : { op: 'delete', id }) }; }
    const worker = new Worker(store, broadcast, options.model);
    async function handle(req: Request): Promise<Result> {
        try {
            const url = new URL(req.url, 'http://localhost'), path = url.pathname.replace(/^\/api\/v1/, '');
            const method = req.method.toUpperCase();
            const p = path.split('/').filter(Boolean), data = req.body ?? {};
            const headers = req.headers;
            const token = headers.authorization?.replace(/^Bearer /, '');
            const sid = headers.cookie?.match(/(?:^|;\s*)ab_session=([^;]+)/)?.[1];
            if (headers.origin && headers.origin !== origin)
                fail('forbidden', 'Request origin is not allowed.');
            if (sid && !token && !['GET', 'HEAD', 'OPTIONS'].includes(method) && headers.origin !== origin)
                fail('forbidden', 'A matching Origin header is required.');
            if (method === 'OPTIONS')
                return { status: 204 };
            if (path === '/healthz')
                return { status: 200, body: { ok: true } };
            if (path === '/readyz') {
                await store.read();
                return { status: 200, body: { ok: true } };
            }
            if (p[0] === 'auth' && ['signup', 'login'].includes(p[1]) && method === 'POST') {
                await throttle('login-ip:' + (req.ip || 'local'), 10, 900000);
                await throttle('login-email:' + String(data.email).toLowerCase(), 10, 900000);
                const parsed = p[1] === 'signup' ? c.SignupSchema.parse(data) : c.LoginSchema.parse(data);
                const session = core.uid('sess');
                const user = await store.transaction(async (s) => {
                    let user = s.users.find(u => u.email === parsed.email.toLowerCase());
                    if (p[1] === 'signup') {
                        if (user)
                            fail('validation_failed', 'That email is already registered.');
                        let role: 'owner' | 'member' = 'owner';
                        if (s.users.length) {
                            const inviteToken = (parsed as {
                                invite?: string;
                            }).invite;
                            const invite = inviteToken ? s.invites[core.hash(inviteToken)] : undefined;
                            if (!invite || invite.expires < Date.now() || invite.email !== parsed.email.toLowerCase())
                                fail('forbidden', 'Ask the owner for a valid invitation.');
                            role = invite.role;
                            delete s.invites[core.hash(String((parsed as any).invite))];
                        }
                        user = { id: core.uid('usr'), email: parsed.email.toLowerCase(), name: (parsed as any).name, role, createdAt: core.now(), passwordHash: await core.passwordHash(parsed.password) };
                        s.users.push(user);
                    }
                    else {
                        const fallback = 'dummysalt:' + ('00'.repeat(64));
                        const valid = await core.passwordCheck(parsed.password, user?.passwordHash ?? fallback);
                        if (!user || !valid)
                            fail('unauthorized', 'Email or password is incorrect.');
                    }
                    s.sessions[core.hash(session)] = { userId: user.id, expires: Date.now() + 2592000000 };
                    return core.publicUser(user);
                });
                return { status: p[1] === 'signup' ? 201 : 200, body: user, headers: { 'Set-Cookie': `ab_session=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${origin.startsWith('https:') ? '; Secure' : ''}` } };
            }
            const s = await store.read(), auth = core.resolve(s, token, sid);
            if (auth.agent)
                await throttle('agent:' + auth.actor.id + ':' + (method === 'GET' ? 'read' : 'write'), method === 'GET' ? 120 : 60, 60000);
            const write = async <T>(fn: (s: State, a: core.Auth) => T | Promise<T>) => store.transaction(s => fn(s, core.resolve(s, token, sid)));
            if (p[0] === 'auth' && p[1] === 'logout' && method === 'POST') {
                core.person(auth);
                await write(s => {
                    if (sid)
                        delete s.sessions[core.hash(sid)];
                });
                return { status: 204, headers: { 'Set-Cookie': 'ab_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax' } };
            }
            if (path === '/me')
                return { status: 200, body: { actor: auth.actor, scopes: auth.scopes, user: auth.user && core.publicUser(auth.user) } };
            if (p[0] === 'auth' && p[1] === 'invites' && method === 'POST') {
                core.owner(auth);
                const input = z.object({ email: z.email(), role: z.enum(['owner', 'member']) }).parse(data);
                const invite = core.uid('invite');
                await write(s => { s.invites[core.hash(invite)] = { ...input, email: input.email.toLowerCase(), expires: Date.now() + 604800000 }; });
                return { status: 201, body: { inviteUrl: origin + '/signup?invite=' + invite } };
            }
            if (p[0] === 'members') {
                core.owner(auth);
                if (method === 'GET')
                    return { status: 200, body: s.users.map(core.publicUser) };
                await write(s => {
                    const user = s.users.find(u => u.id === p[1]);
                    if (!user)
                        fail('not_found', 'Member not found.');
                    if (user.id === auth.actor.id)
                        fail('forbidden', 'You cannot remove or demote yourself.');
                    if (method === 'DELETE') {
                        s.users = s.users.filter(u => u.id !== p[1]);
                        for (const [key, session] of Object.entries(s.sessions))
                            if (session.userId === p[1])
                                delete s.sessions[key];
                    }
                    else
                        user.role = z.enum(['owner', 'member']).parse(data.role);
                });
                return { status: method === 'DELETE' ? 204 : 200, body: method === 'DELETE' ? undefined : core.publicUser((await store.read()).users.find(u => u.id === p[1])!) };
            }
            if (path === '/boards') {
                if (method === 'GET') {
                    core.scope(auth);
                    if (url.searchParams.get('trashed') === 'true')
                        core.owner(auth);
                    return { status: 200, body: core.page(Object.values(s.boards).filter(b => Boolean(b.board.deletedAt) === (url.searchParams.get('trashed') === 'true') && (!auth.agent?.boardIds || auth.agent.boardIds.includes(b.board.id))).map(b => b.board).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), Number(url.searchParams.get('limit') || 50), url.searchParams.get('cursor') || undefined) };
                }
                if (method === 'POST') {
                    const input = z.object({ title: z.string().min(1).max(120) }).parse(data);
                    return { status: 201, body: await write((s, a) => core.createBoard(s, a, input.title)) };
                }
            }
            if (p[0] === 'boards' && p[1]) {
                const id = p[1];
                if (p[2] === 'restore' && method === 'POST') {
                    core.owner(auth);
                    return { status: 200, body: await write((s, a) => { const b = core.board(s, a, id, true, true); delete b.board.deletedAt; return b.board; }) };
                }
                const b = core.board(s, auth, id);
                if (!p[2]) {
                    if (method === 'GET')
                        return { status: 200, body: b.board };
                    if (method === 'PATCH') {
                        const title = z.string().min(1).max(120).parse(data.title);
                        const result = await write((s, a) => { const b = core.board(s, a, id, true); b.board.title = title; b.board.updatedAt = core.now(); return b.board; });
                        await broadcast(id);
                        return { status: 200, body: result };
                    }
                    if (method === 'DELETE') {
                        core.owner(auth);
                        await write((s, a) => {
                            const b = core.board(s, a, id, true);
                            b.board.deletedAt = core.now();
                            for (const r of s.runs.filter(r => r.boardId === id && ['queued', 'running'].includes(r.status))) {
                                r.status = 'cancelled';
                                r.finishedAt = core.now();
                                worker.cancel(r.id);
                            }
                            b.claims = [];
                        });
                        await broadcast(id);
                        return { status: 204 };
                    }
                }
                if (p[2] === 'scenes' && p[4] === 'frame' && method === 'GET') {
                    const element = b.elements[p[3]];
                    if (!element || element.type !== 'scene3d') fail('not_found', '3D model not found.');
                    const image = renderBoard({ ...b, board: { ...b.board, id: b.board.id + ':' + element.id, order: [element.id] }, elements: { [element.id]: element } }, { x: element.x, y: element.y, w: element.w, h: element.h });
                    return { status: 200, body: Buffer.from(image.data, 'base64'), headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-cache' } };
                }
                if (p[2] === 'embeds' && p[4] === 'frame' && method === 'GET') {
                    const element = b.elements[p[3]];
                    if (!element || element.type !== 'embed')
                        fail('not_found', 'Embed not found.');
                    return { status: 200, body: Buffer.from(c.embedDocument(element.html), 'utf8'), headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': c.EMBED_CSP, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'no-referrer' } };
                }
                if (p[2] === 'elements' && method === 'GET') {
                    let elements = Object.values(b.elements);
                    const ids = url.searchParams.get('ids');
                    if (ids)
                        elements = elements.filter(e => ids.split(',').includes(e.id));
                    const near = url.searchParams.get('near');
                    if (near) {
                        const [x, y, w, h] = near.split(',').map(Number);
                        if (![x, y, w, h].every(Number.isFinite))
                            fail('validation_failed', 'Invalid region.');
                        elements = elements.filter(e => e.x >= x && e.x <= x + w && e.y >= y && e.y <= y + h);
                    }
                    return { status: 200, body: { seq: b.board.seq, order: b.board.order, elements: elements.map(e => {
                                if (e.type === 'embed' && url.searchParams.get('omit')?.split(',').includes('html')) {
                                    const { html, ...rest } = e;
                                    return rest;
                                }
                                if (e.type === 'drawing' && url.searchParams.get('omit')?.split(',').includes('strokes')) {
                                    const { strokes, ...rest } = e;
                                    return rest;
                                }
                                return e;
                            }) } };
                }
                if (p[2] === 'view' && method === 'GET') {
                    const region = url.searchParams.get('region');
                    return { status: 200, body: Buffer.from(core.tool(s, auth, 'view_board', { boardId: id, region: region ? JSON.parse(region) : undefined }).data, 'base64'), headers: { 'Content-Type': 'image/png' } };
                }
                if (p[2] === 'digest' && method === 'GET')
                    return { status: 200, body: { seq: b.board.seq, text: core.digest(b, s.activity) } };
                if (p[2] === 'ops' && method === 'POST') {
                    const result = await write((s, a) => {
                        const value = core.applyOps(s, a, id, data, headers['idempotency-key']);
                        if (a.agent?.runner.kind === 'webhook') {
                            const run = s.runs.find(r => r.boardId === id && r.agentId === a.agent!.id && r.status === 'running');
                            if (run && !run.batches.includes(value.seq)) {
                                run.batches.push(value.seq);
                                run.touched = [...new Set([...run.touched, ...value.results.map(r => r.id)])];
                            }
                        }
                        return value;
                    });
                    await broadcast(id);
                    return { status: 200, body: result };
                }
                if (p[2] === 'batches' && p[4] === 'revert' && method === 'POST') {
                    const result = await write((s, a) => core.revertBatch(s, a, id, Number(p[3])));
                    await broadcast(id);
                    return { status: 200, body: result };
                }
                if (p[2] === 'claims') {
                    if (method === 'GET')
                        return { status: 200, body: { items: b.claims.filter(c => Date.parse(c.expiresAt) > Date.now()) } };
                    const result = await write((s, a) => {
                        if (!p[3])
                            return core.claim(s, a, id, z.object({ target: c.TargetSchema, note: z.string().max(80).optional() }).parse(data));
                        const b = core.board(s, a, id, true), claim = b.claims.find(c => c.id === p[3] && Date.parse(c.expiresAt) > Date.now());
                        if (!claim)
                            fail('not_found', 'Claim not found.');
                        if (claim.actor.id !== a.actor.id)
                            fail('forbidden', 'Claim belongs to another actor.');
                        if (method === 'DELETE') {
                            b.claims = b.claims.filter(c => c.id !== p[3]);
                            return;
                        }
                        claim.expiresAt = new Date(Date.now() + 60000).toISOString();
                        return claim;
                    });
                    await broadcast(id);
                    return { status: method === 'DELETE' ? 204 : 201, body: result };
                }
                if (p[2] === 'runs') {
                    core.person(auth);
                    if (method === 'GET')
                        return { status: 200, body: core.page(s.runs.filter(r => r.boardId === id), Number(url.searchParams.get('limit') || 50), url.searchParams.get('cursor') || undefined) };
                    if (method === 'POST') {
                        const input = z.object({ agentId: z.string(), message: z.string().min(1).max(2000), design: c.DesignTargetSchema.optional() }).parse(data);
                        const r = await write((s, a) => createRun(s, a, id, input.agentId, input.message, input.design));
                        await broadcast(id);
                        return { status: 202, body: r };
                    }
                }
            }
            if (p[0] === 'runs' && p[1]) {
                const run = s.runs.find(r => r.id === p[1]);
                if (!run)
                    fail('not_found', 'Run not found.');
                core.board(s, auth, run.boardId);
                if (['steps', 'finish'].includes(p[2]) && method === 'POST') {
                    if (!auth.agent || auth.agent.id !== run.agentId || auth.agent.runner.kind !== 'webhook')
                        fail('forbidden', 'Only the run’s webhook agent can report progress.');
                    const result = await write((s, a) => {
                        const r = s.runs.find(x => x.id === p[1])!;
                        if (r.status !== 'running')
                            fail('validation_failed', 'This run is no longer running.');
                        if (p[2] === 'steps') {
                            const step = c.RunStepSchema.parse({ ...data, id: data.id ?? core.uid('step') });
                            const old = r.steps.find(x => x.id === step.id);
                            if (old) {
                                if (old.kind !== step.kind || old.name !== step.name)
                                    fail('validation_failed', 'Step kind and name cannot change.');
                                old.status = step.status;
                                old.note = step.note;
                                return old;
                            }
                            if (r.steps.length >= 20)
                                fail('limit_exceeded', 'The run reached its step limit.');
                            r.steps.push(step);
                            return step;
                        }
                        const value = z.union([z.object({ reply: z.string().max(20000) }), z.object({ error: z.object({ code: z.string(), message: z.string() }) })]).parse(data);
                        r.status = 'reply' in value ? 'done' : 'failed';
                        r.reply = 'reply' in value ? value.reply : null;
                        r.error = 'error' in value ? value.error : null;
                        r.finishedAt = core.now();
                        return r;
                    });
                    await broadcast(run.boardId);
                    return { status: 200, body: result };
                }
                core.person(auth);
                if (method === 'GET')
                    return { status: 200, body: run };
                const result = await write((s, a) => {
                    const r = s.runs.find(r => r.id === p[1])!;
                    if (p[2] === 'cancel') {
                        if (['queued', 'running'].includes(r.status)) {
                            r.status = 'cancelled';
                            r.finishedAt = core.now();
                            worker.cancel(r.id);
                        }
                    }
                    else if (p[2] === 'revert') {
                        core.revertRun(s, a, r);
                    }
                    else
                        fail('not_found', 'Run action not found.');
                    return r;
                });
                await broadcast(run.boardId);
                return { status: 200, body: result };
            }
            if (p[0] === 'agents') {
                core.person(auth);
                if (method === 'GET')
                    return { status: 200, body: { items: s.agents.map(core.publicAgent) } };
                core.owner(auth);
                if (method === 'POST' && !p[1]) {
                    const prepared = await prepareAgent(data);
                    const key = 'ab_live_' + core.uid('').slice(1) + core.uid('').slice(1);
                    const agent = await write(s => { const ag = { ...prepared.fields, id: core.uid('agt'), keyHash: core.hash(key), keyPrefix: key.slice(0, 10), status: 'active' as const, lastSeenAt: null, createdAt: core.now() }; s.agents.push(ag); return core.publicAgent(ag); });
                    return { status: 201, body: { agent, key, ...(prepared.once ? { webhookSecret: prepared.once } : {}) } };
                }
                let preparedPatch: Awaited<ReturnType<typeof prepareAgent>> | undefined;
                if (method === 'PATCH') {
                    const previous = s.agents.find(a => a.id === p[1]);
                    if (!previous)
                        fail('not_found', 'Agent not found.');
                    preparedPatch = await prepareAgent({ ...previous, ...data, mcpServers: data.mcpServers ?? previous.mcpServers }, previous);
                }
                const result = await write(s => {
                    const ag = s.agents.find(a => a.id === p[1]);
                    if (!ag)
                        fail('not_found', 'Agent not found.');
                    if (method === 'DELETE') {
                        ag.status = 'revoked';
                        for (const r of s.runs.filter(r => r.agentId === ag.id && ['queued', 'running'].includes(r.status))) {
                            r.status = 'cancelled';
                            r.finishedAt = core.now();
                            worker.cancel(r.id);
                        }
                        for (const b of Object.values(s.boards))
                            b.claims = b.claims.filter(c => c.actor.id !== ag.id);
                        return;
                    }
                    if (p[2] === 'rotate-key') {
                        const key = 'ab_live_' + core.uid('').slice(1) + core.uid('').slice(1);
                        ag.keyHash = core.hash(key);
                        ag.keyPrefix = key.slice(0, 10);
                        return { agent: core.publicAgent(ag), key };
                    }
                    if (method === 'PATCH') {
                        Object.assign(ag, preparedPatch!.fields);
                        return preparedPatch!.once ? { agent: core.publicAgent(ag), webhookSecret: preparedPatch!.once } : core.publicAgent(ag);
                    }
                    fail('not_found', 'Agent action not found.');
                });
                for (const id of Object.keys(s.boards))
                    await broadcast(id);
                return { status: method === 'DELETE' ? 204 : 200, body: result };
            }
            if (path === '/activity') {
                core.person(auth);
                return { status: 200, body: core.page(s.activity.filter(e => (!url.searchParams.get('boardId') || e.boardId === url.searchParams.get('boardId')) && (!url.searchParams.get('actorKind') || e.actor.kind === url.searchParams.get('actorKind'))), Number(url.searchParams.get('limit') || 50), url.searchParams.get('cursor') || undefined) };
            }
            if (p[0] === 'settings') {
                core.person(auth);
                if (method === 'GET')
                    return { status: 200, body: s.settings };
                core.owner(auth);
                const patch = c.SettingsSchema.partial().parse(data);
                return { status: 200, body: await write(s => Object.assign(s.settings, patch)) };
            }
            if (p[0] === 'knowledge') {
                if (p[1] === 'search')
                    return { status: 200, body: core.search(s, auth, url.searchParams.get('q') || '', Number(url.searchParams.get('limit') || 3)) };
                core.person(auth);
                if (method === 'GET')
                    return { status: 200, body: { items: s.knowledge } };
                core.owner(auth);
                if (method === 'POST') {
                    const doc = c.KnowledgeSchema.parse({ ...data, id: core.uid('doc'), createdAt: core.now() });
                    await write(s => s.knowledge.push(doc));
                    return { status: 201, body: doc };
                }
                if (method === 'DELETE') {
                    await write(s => { s.knowledge = s.knowledge.filter(d => d.id !== p[1]); });
                    return { status: 204 };
                }
            }
            if (path === '/mcp' && method === 'POST') {
                if (!token)
                    fail('unauthorized', 'MCP requires an agent API key.');
                const rpc = data;
                let result: any;
                if (rpc.method === 'initialize')
                    result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'AgentBoard', version: '1.0.0' } };
                else if (rpc.method === 'notifications/initialized')
                    return { status: 202 };
                else if (rpc.method === 'ping')
                    result = {};
                else if (rpc.method === 'tools/list') {
                    const allowed = new Set(boardModelTools(auth.agent!).map(tool => tool.function.name));
                    result = { tools: Object.entries(c.toolSchemas).filter(([name]) => allowed.has(name)).map(([name, schema]) => ({ name, description: c.TOOL_DESCRIPTIONS[name as keyof typeof c.toolSchemas], inputSchema: z.toJSONSchema(schema, { io: 'input' }) })) };
                }
                else if (rpc.method === 'tools/call') {
                    try {
                        const name = rpc.params?.name as keyof typeof c.toolSchemas;
                        const schema = c.toolSchemas[name];
                        if (!schema)
                            fail('not_found', 'Tool not found.');
                        const args = schema.parse(rpc.params?.arguments ?? {});
                        const value = await write((s, a) => core.tool(s, a, name, args));
                        result = name === 'view_board' ? { content: [{ type: 'image', data: value.data, mimeType: 'image/png' }] } : { content: [{ type: 'text', text: JSON.stringify(value) }] };
                        for (const id of Object.keys(s.boards))
                            await broadcast(id);
                    }
                    catch (e) {
                        result = { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: (e as AppError).code || (e instanceof ZodError && e.issues.some(i => i.code === 'custom' && (i as any).params?.errorCode === 'limit_exceeded') ? 'limit_exceeded' : 'validation_failed'), message: (e as Error).message, details: (e as AppError).details } }) }] };
                    }
                }
                else
                    return { status: 200, body: { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } } };
                return { status: 200, body: { jsonrpc: '2.0', id: rpc.id, result } };
            }
            fail('not_found', 'Endpoint not found.');
        }
        catch (error) {
            if (error instanceof ZodError) {
                const limit = error.issues.find(i => i.code === 'custom' && (i as any).params?.errorCode === 'limit_exceeded');
                return { status: 422, body: { error: { code: limit ? 'limit_exceeded' : 'validation_failed', message: limit?.message || 'Please check the submitted fields.', details: error.issues } } };
            }
            ;
            if (error instanceof AppError)
                return { status: c.statusCodes[error.code], body: { error: { code: error.code, message: error.message, details: error.details } }, headers: error.code === 'rate_limited' ? { 'Retry-After': '60' } : undefined };
            console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
            return { status: 500, body: { error: { code: 'internal', message: 'The request could not be completed.' } } };
        }
    }
    const server = createServer(async (req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'same-origin');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self' data:; frame-src 'self'; frame-ancestors 'none'");
        res.setHeader('Cache-Control', 'no-store');
        if (req.headers.origin === origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, MCP-Protocol-Version');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
        }
        const url = req.url || '/';
        if (!url.startsWith('/api/') && !url.startsWith('/mcp') && !url.endsWith('healthz') && !url.endsWith('readyz')) {
            const result = await staticWeb(url);
            res.statusCode = result.status;
            for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
            res.end(req.method === 'HEAD' ? undefined : result.body);
            return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        try {
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 262144) {
                    res.statusCode = 413;
                    res.end(JSON.stringify({ error: { code: 'limit_exceeded', message: 'Request body exceeds 256 KB.' } }));
                    return;
                }
                chunks.push(chunk);
            }
            let body;
            try {
                body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
            }
            catch {
                res.statusCode = 422;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: { code: 'validation_failed', message: 'Invalid JSON.' } }));
                return;
            }
            const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]));
            const r = await handle({ method: req.method || 'GET', url, headers, body, ip: req.socket.remoteAddress });
            res.statusCode = r.status;
            res.setHeader('Content-Type', 'application/json');
            for (const [k, v] of Object.entries(r.headers ?? {}))
                res.setHeader(k, v);
            res.end(Buffer.isBuffer(r.body) ? r.body : r.body === undefined ? undefined : JSON.stringify(r.body));
        }
        catch {
            if (!res.headersSent)
                res.statusCode = 500;
            res.end();
        }
    });
    server.on('upgrade', async (req, socket, head) => {
        try {
            const url = new URL(req.url || '', 'http://localhost');
            const id = url.pathname.match(/^\/api\/v1\/boards\/([^/]+)\/live$/)?.[1];
            if (!id || url.searchParams.has('key'))
                throw Error();
            const token = req.headers.authorization?.replace(/^Bearer /, '');
            if (!token && req.headers.origin !== origin)
                throw Error();
            const sid = req.headers.cookie?.match(/(?:^|;\s*)ab_session=([^;]+)/)?.[1];
            const s = await store.read(), auth = core.resolve(s, token, sid), b = core.board(s, auth, id);
            wss.handleUpgrade(req, socket, head, ws => {
                const since = Number(url.searchParams.get('sinceSeq') || 0), gap = b.board.seq - since;
                clients.set(ws, { boardId: id, auth, cursor: null, lastSeq: b.board.seq, lastRun: '', claims: b.claims.map(c => c.id) });
                if (gap > 500 || since > b.board.seq || gap > b.batches.length)
                    send(ws, { t: 'resync' });
                else
                    for (const batch of b.batches.filter(x => x.seq > since))
                        send(ws, batchMessage(batch));
                send(ws, { t: 'hello', seq: b.board.seq, presence: [...clients.values()].filter(c => c.boardId === id).map(c => ({ actor: c.auth.actor, cursor: c.cursor })), claims: b.claims });
                ws.on('message', buffer => {
                    try {
                        const msg = c.ClientMsgSchema.parse(JSON.parse(buffer.toString()));
                        if (msg.t === 'cursor') {
                            clients.get(ws)!.cursor = { x: msg.x, y: msg.y };
                            for (const [other, client] of clients)
                                if (client.boardId === id)
                                    send(other, { t: 'presence', presence: [...clients.values()].filter(x => x.boardId === id).map(x => ({ actor: x.auth.actor, cursor: x.cursor })) });
                        }
                    }
                    catch { }
                });
                ws.on('close', () => clients.delete(ws));
            });
        }
        catch {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            socket.destroy();
        }
    });
    const sweeper = setInterval(async () => {
        await store.transaction(s => {
            for (const b of Object.values(s.boards))
                b.claims = b.claims.filter(c => Date.parse(c.expiresAt) > Date.now());
            for (const [id, b] of Object.entries(s.boards))
                if (b.board.deletedAt && Date.parse(b.board.deletedAt) < Date.now() - 2592000000)
                    delete s.boards[id];
            for (const [k, v] of Object.entries(s.idempotency))
                if (v.at < Date.now() - 86400000)
                    delete s.idempotency[k];
        });
        for (const id of new Set([...clients.values()].map(x => x.boardId)))
            await broadcast(id);
    }, 5000);
    sweeper.unref();
    return { handle, server, worker, broadcast, async close() {
            clearInterval(sweeper);
            await boardListen?.close();
            await worker.stop();
            for (const ws of clients.keys())
                ws.terminate();
            wss.close();
            if (server.listening)
                await new Promise<void>(r => server.close(() => r()));
            await store.close();
        } };
}
