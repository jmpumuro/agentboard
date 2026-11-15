import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Run } from 'contract';
import { emptyState, postgresStore, type PrivateAgent } from '../apps/api/src/db/store';
import { listenBoardOps } from '../apps/api/src/db/postgres';
import { createApp } from '../apps/api/src/server';
import { applyOps, createBoard, type Auth } from '../apps/api/src/services/core';
import { createRun, Worker, type Model } from '../apps/api/src/services/runner';

const databaseUrl = await probe();
const origin = 'http://localhost:4173';
const auth: Auth = { actor: { kind: 'user', id: 'usr_1', name: 'Alex' }, user: { id: 'usr_1', name: 'Alex', email: 'alex@example.com', role: 'owner', createdAt: '2026-01-02T03:04:05.000Z' }, scopes: ['boards:read', 'boards:write'] };
const stamp = '2026-01-02T03:04:05.000Z';
const actor = { kind: 'user' as const, id: 'usr_1', name: 'Alex' };

async function probe() {
    const url = process.env.DATABASE_URL;
    if (!url)
        return;
    const { Client } = await import('pg');
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 1000 });
    try {
        await client.connect();
        await client.query('select 1');
        await client.end();
        return url;
    }
    catch {
        try { await client.end(); } catch { /* not open */ }
    }
}

describe('normalized postgres store', () => {
    if (!databaseUrl) {
        it.skip('skips cleanly when Postgres is not reachable', () => { });
        return;
    }
    const url = databaseUrl;

    async function schema() {
        const name = 'ab_' + randomBytes(4).toString('hex');
        const { Client } = await import('pg');
        const admin = new Client({ connectionString: url });
        await admin.connect();
        return {
            name,
            admin,
            async drop() {
                await admin.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
                await admin.end();
            }
        };
    }

    function run(id: string, boardId: string, status: Run['status'] = 'queued'): Run {
        return { id, boardId, agentId: 'agt_1', requestedBy: actor, message: 'Help ' + id, status, steps: [], reply: null, error: null, createdAt: stamp, finishedAt: null, batches: [], touched: [], reverted: false };
    }

    it('imports one legacy workspace_state row, then reads and writes normalized tables', async () => {
        const scope = await schema();
        const store = await (async () => {
            const expected = emptyState();
            expected.settings = { name: 'Lab', agentsCanDeleteOthersElements: true, requireClaimBeforeAgentWrite: false };
            expected.users.push({ id: 'usr_1', email: 'alex@example.com', name: 'Alex', role: 'owner', createdAt: stamp, passwordHash: 'salt:hash' });
            expected.sessions.sess = { userId: 'usr_1', expires: 123456789 };
            expected.invites.invite = { email: 'new@example.com', role: 'member', expires: 987654321 };
            expected.agents.push({ id: 'agt_1', name: 'Planner', harness: 'custom', scopes: ['boards:read', 'boards:write'], capabilities: ['add', 'draw', 'edit', 'knowledge'], instructions: 'Help', boardIds: null, mcpServers: [{ name: 'docs', url: 'https://example.com/mcp', hasSecret: true }], runner: { kind: 'builtin' }, keyPrefix: 'ab_live_00', keyHash: 'hashed-only', status: 'active', lastSeenAt: null, createdAt: stamp, secrets: { 'https://example.com/mcp': 'cipher' }, webhookSecret: 'whsec' });
            expected.boards.brd_1 = {
                board: { id: 'brd_1', title: 'Board', seq: 2, order: ['el_1'], elementCount: 1, createdBy: actor, createdAt: stamp, updatedAt: stamp, deletedAt: stamp },
                elements: { el_1: { type: 'note', id: 'el_1', x: 10, y: 20, w: 200, h: 150, text: 'Hello', color: 'yellow', version: 1, createdBy: actor, updatedBy: actor, updatedAt: stamp } },
                claims: [{ id: 'clm_1', boardId: 'brd_1', actor, target: { rect: { x: 0, y: 0, w: 400, h: 300 } }, note: 'working', expiresAt: stamp }],
                batches: [{ seq: 2, actor, before: {}, after: {}, orderBefore: [], orderAfter: ['el_1'], revertedBy: 3, restacked: ['el_1'], partOnly: { el_1: ['p'] } }],
                partVersions: { el_1: { p: 2 } }
            };
            expected.activity.unshift({ id: 'evt_1', boardId: 'brd_1', boardTitle: 'Board', actor, seq: 2, summary: 'added 1 element', counts: { created: 1, updated: 0, deleted: 0 }, at: stamp });
            expected.knowledge.push({ id: 'doc_1', title: 'Guide', text: 'Boards are free-form canvases', createdAt: stamp });
            expected.runs.unshift(run('run_old', 'brd_1', 'done'));
            expected.runs.unshift({ ...run('run_new', 'brd_1'), design: { place: { x: 12, y: 34 } } });
            expected.idempotency.key = { hash: 'abc', response: { seq: 2, results: [] }, at: 42 };
            await scope.admin.query(`CREATE SCHEMA ${scope.name}`);
            await scope.admin.query(`CREATE TABLE ${scope.name}.workspace_state (id int PRIMARY KEY, data jsonb NOT NULL)`);
            await scope.admin.query(`INSERT INTO ${scope.name}.workspace_state (id, data) VALUES (1, $1::jsonb)`, [JSON.stringify(expected)]);
            const opened = await postgresStore(url, { schema: scope.name });
            return { opened, expected };
        })();
        try {
            expect(await store.opened.read()).toEqual(store.expected);
            const again = await postgresStore(url, { schema: scope.name });
            expect(await again.read()).toEqual(store.expected);
            await again.close();
            const tables = await scope.admin.query(`SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY 1`, [scope.name]);
            expect(tables.rows.map((row: { tablename: string }) => row.tablename)).toEqual(['activity', 'agents', 'batches', 'boards', 'claims', 'elements', 'idempotency', 'invites', 'knowledge', 'rate_limits', 'runs', 'sessions', 'settings', 'users', 'workspace_state']);
            const vector = await scope.admin.query(`SELECT a.attgenerated AS generated, k.search_vector::text AS search_vector
              FROM pg_attribute a
              JOIN pg_class c ON c.oid = a.attrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
              JOIN ${scope.name}.knowledge k ON true
              WHERE n.nspname = $1 AND c.relname = 'knowledge' AND a.attname = 'search_vector'`, [scope.name]);
            expect(vector.rows[0].generated).toBe('s');
            expect(String(vector.rows[0].search_vector)).toContain('board');
            await store.opened.transaction(s => { s.knowledge = s.knowledge.filter(doc => doc.id !== 'doc_1'); delete s.sessions.sess; delete s.boards.brd_1; });
            await scope.admin.query(`UPDATE ${scope.name}.workspace_state SET data = '{"schemaVersion":2,"users":[{"id":"ghost"}]}'::jsonb WHERE id = 1`);
            const after = await store.opened.read();
            expect(after.users.map(user => user.id)).toEqual(['usr_1']);
            expect(after.knowledge).toEqual([]);
            expect(after.sessions).toEqual({});
            expect(after.boards).toEqual({});
            const reopened = await postgresStore(url, { schema: scope.name });
            expect((await reopened.read()).users.map(user => user.id)).toEqual(['usr_1']);
            await reopened.close();
        }
        finally {
            await store.opened.close();
            await scope.drop();
        }
    });

    it('rolls back a failed transaction', async () => {
        const scope = await schema();
        const store = await postgresStore(url, { schema: scope.name });
        try {
            await store.transaction(s => { s.users.push({ id: 'usr_1', email: 'alex@example.com', name: 'Alex', role: 'owner', createdAt: stamp, passwordHash: 'hash' }); });
            await expect(store.transaction(s => { s.users.push({ id: 'usr_2', email: 'other@example.com', name: 'Other', role: 'member', createdAt: stamp, passwordHash: 'hash' }); throw new Error('boom'); })).rejects.toThrow('boom');
            expect((await store.read()).users.map(user => user.id)).toEqual(['usr_1']);
        }
        finally {
            await store.close();
            await scope.drop();
        }
    });

    it('claims queued runs with SKIP LOCKED and interrupts only runs with no live owner', async () => {
        const scope = await schema();
        const store = await postgresStore(url, { schema: scope.name });
        const other = await postgresStore(url, { schema: scope.name });
        const { Client } = await import('pg');
        const blocker = new Client({ connectionString: url, options: `-c search_path=${scope.name}` });
        try {
            await store.transaction(s => {
                s.boards.brd_1 = { board: { id: 'brd_1', title: 'Board', seq: 0, order: [], elementCount: 0, createdBy: actor, createdAt: stamp, updatedAt: stamp }, elements: {}, claims: [{ id: 'clm_1', boardId: 'brd_1', actor: { kind: 'agent', id: 'agt_1', name: 'Planner' }, target: { elementIds: ['el_1'] }, expiresAt: stamp }], batches: [] };
                s.runs.unshift({ ...run('run_dead', 'brd_1'), status: 'running' });
            });
            const worker = new Worker(store, async () => { }, async () => ({ content: 'Finished' }));
            await worker.start();
            await worker.stop();
            const recovered = await store.read();
            expect(recovered.runs[0].status).toBe('failed');
            expect(recovered.runs[0].error).toEqual({ code: 'interrupted', message: 'The worker stopped during this run.' });
            expect(recovered.boards.brd_1.claims).toEqual([]);
            await store.transaction(s => { s.runs.unshift(run('run_a', 'brd_1')); s.runs.unshift(run('run_b', 'brd_1')); });
            await blocker.connect();
            await blocker.query('BEGIN');
            await blocker.query('SELECT id FROM runs WHERE id = $1 FOR UPDATE', ['run_b']);
            const claimed = await store.claimQueuedRun!();
            expect(claimed?.id).toBe('run_a');
            expect(claimed?.status).toBe('running');
            await other.recoverInterruptedRuns!();
            expect((await store.read()).runs.find(item => item.id === 'run_a')?.status).toBe('running');
            await blocker.query('ROLLBACK');
            await store.releaseRun!('run_a');
            await other.recoverInterruptedRuns!();
            const after = await store.read();
            expect(after.runs.find(item => item.id === 'run_a')?.error?.code).toBe('interrupted');
            expect(after.runs.find(item => item.id === 'run_b')?.status).toBe('queued');
        }
        finally {
            try { await blocker.query('ROLLBACK'); } catch { /* already finished */ }
            try { await blocker.end(); } catch { /* not open */ }
            await other.close();
            await store.close();
            await scope.drop();
        }
    });

    it('notifies board_ops with the board id and resyncs after the listener reconnects', async () => {
        const scope = await schema();
        const store = await postgresStore(url, { schema: scope.name });
        const seen: string[] = [];
        let reconnects = 0;
        const listener = listenBoardOps(url, { onNotify: boardId => seen.push(boardId), onReconnect: () => { reconnects += 1; } });
        try {
            await waitFor(async () => {
                await scopeQuery(url, scope.name, 'SELECT pg_notify($1, $2)', ['board_ops', 'probe']);
                return seen.includes('probe');
            });
            const boardId = await store.transaction(s => createBoard(s, auth, 'Live').id);
            expect(seen).not.toContain(boardId);
            await store.transaction(s => applyOps(s, auth, boardId, { ops: [{ op: 'create', id: 'note_1', data: { type: 'note', x: 10, y: 20, w: 200, h: 150, text: 'Hi', color: 'yellow' } }] }));
            await waitFor(() => seen.includes(boardId));
            const pid = await scope.admin.query(`SELECT pid FROM pg_stat_activity WHERE application_name = 'agentboard-board-ops' AND datname = current_database()`);
            expect(pid.rows.length).toBeGreaterThan(0);
            await scope.admin.query('SELECT pg_terminate_backend($1::int)', [pid.rows[0].pid]);
            await waitFor(() => reconnects > 0);
            await waitFor(async () => {
                await scopeQuery(url, scope.name, 'SELECT pg_notify($1, $2)', ['board_ops', 'after-reconnect']);
                return seen.includes('after-reconnect');
            });
        }
        finally {
            await listener.close();
            await store.close();
            await scope.drop();
        }
    });

    it('keeps throttle counters in Postgres across stores', async () => {
        const scope = await schema();
        const previous = process.env.DATABASE_URL;
        process.env.DATABASE_URL = url;
        const store = await postgresStore(url, { schema: scope.name });
        const app = createApp(store, { origin });
        try {
            const login = { method: 'POST', url: '/api/v1/auth/login', headers: { origin }, body: { email: 'alex@example.com', password: 'password123' }, ip: '203.0.113.5' };
            expect((await app.handle(login)).status).toBe(401);
            await waitFor(async () => (await scope.admin.query(`SELECT pid FROM pg_stat_activity WHERE application_name = 'agentboard-board-ops'`)).rows.length > 0);
            for (let i = 0; i < 9; i++)
                await store.throttle!('login-ip:203.0.113.5', 10, 900000);
            await expect(store.throttle!('login-ip:203.0.113.5', 10, 900000)).rejects.toMatchObject({ code: 'rate_limited', message: 'Too many requests. Try again shortly.' });
            const limited = await app.handle(login);
            expect(limited.status).toBe(429);
            expect(limited.body.error).toMatchObject({ code: 'rate_limited', message: 'Too many requests. Try again shortly.' });
            expect(limited.headers?.['Retry-After']).toBe('60');
            await app.close();
            const second = await postgresStore(url, { schema: scope.name });
            const app2 = createApp(second, { origin });
            try {
                expect((await app2.handle(login)).status).toBe(429);
            }
            finally {
                await app2.close();
            }
        }
        finally {
            if (previous === undefined)
                delete process.env.DATABASE_URL;
            else
                process.env.DATABASE_URL = previous;
            try { await app.close(); } catch { /* already closed */ }
            await scope.drop();
        }
    });

    it('lets two workers claim different queued runs', async () => {
        const scope = await schema();
        const store = await postgresStore(url, { schema: scope.name });
        const second = await postgresStore(url, { schema: scope.name });
        try {
            const agent: PrivateAgent = { id: 'agt_test', name: 'Planner', harness: 'custom', scopes: ['boards:read', 'boards:write'], capabilities: ['add', 'draw', 'edit', 'knowledge'], instructions: 'Help', mcpServers: [], runner: { kind: 'builtin' }, boardIds: null, status: 'active', keyHash: 'hashed-only', keyPrefix: 'ab_live', lastSeenAt: null, createdAt: stamp };
            await store.transaction(s => {
                s.agents.push(agent);
                const first = createBoard(s, auth, 'One');
                const next = createBoard(s, auth, 'Two');
                createRun(s, auth, first.id, agent.id, 'First');
                createRun(s, auth, next.id, agent.id, 'Second');
            });
            const calls: string[] = [];
            const model: Model = async () => { calls.push('turn'); return { content: 'Finished' }; };
            const workerA = new Worker(store, async () => { }, model);
            const workerB = new Worker(second, async () => { }, model);
            await Promise.all([workerA.tick(), workerB.tick()]);
            await workerA.stop();
            await workerB.stop();
            const runs = (await store.read()).runs;
            expect(runs.map(item => item.status).sort()).toEqual(['done', 'done']);
            expect(new Set(runs.map(item => item.id)).size).toBe(2);
            expect(calls).toHaveLength(2);
        }
        finally {
            await second.close();
            await store.close();
            await scope.drop();
        }
    });

});

async function scopeQuery(connectionString: string, schema: string, sql: string, params: unknown[]) {
    const { Client } = await import('pg');
    const client = new Client({ connectionString, options: `-c search_path=${schema}` });
    await client.connect();
    try { return await client.query(sql, params); }
    finally { await client.end(); }
}

async function waitFor(predicate: () => boolean | Promise<boolean>) {
    const start = Date.now();
    while (Date.now() - start < 4000) {
        if (await predicate())
            return;
        await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('timed out waiting for Postgres');
}
