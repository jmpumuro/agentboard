import { createHash, randomBytes } from 'node:crypto';
import type { ActivityEvent, Board, Claim, Element, KnowledgeDoc, Run, User } from 'contract';
import { fail } from '../lib/errors';
import { emptyState, migrateState, type Batch, type BoardData, type PrivateAgent, type State } from './store';
import type { PostgresStoreOptions } from './store';

const MIGRATION_LOCK = 724891;
const WRITE_LOCK = 724892;

interface Sql {
    query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

function assertSchema(schema: string) {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema))
        throw new Error('Invalid Postgres schema name');
}

function canonical(value: unknown): string {
    return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(sortValue);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            const item = (value as Record<string, unknown>)[key];
            if (item !== undefined)
                out[key] = sortValue(item);
        }
        return out;
    }
    return value;
}

function jsonb(value: unknown): string | null {
    return value === undefined || value === null ? null : JSON.stringify(value);
}

function runLockKey(id: string): string {
    const buf = createHash('sha256').update('agentboard-run:' + id).digest();
    return buf.readBigInt64BE(0).toString();
}

const DDL = [
    `CREATE TABLE IF NOT EXISTS workspace_state (
      id int PRIMARY KEY,
      data jsonb NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      pos int NOT NULL,
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      role text NOT NULL,
      password_hash text NOT NULL,
      created_at text NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id text PRIMARY KEY,
      pos int NOT NULL,
      user_id text NOT NULL,
      expires double precision NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS invites (
      id text PRIMARY KEY,
      pos int NOT NULL,
      email text NOT NULL,
      role text NOT NULL,
      expires double precision NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS agents (
      id text PRIMARY KEY,
      pos int NOT NULL,
      name text NOT NULL,
      harness text NOT NULL,
      scopes jsonb NOT NULL,
      capabilities jsonb NOT NULL,
      instructions text NOT NULL,
      board_ids jsonb,
      mcp_servers jsonb NOT NULL,
      runner jsonb NOT NULL,
      key_prefix text NOT NULL,
      key_hash text NOT NULL,
      status text NOT NULL,
      last_seen_at text,
      created_at text NOT NULL,
      secrets jsonb,
      webhook_secret text
    )`,
    `CREATE TABLE IF NOT EXISTS boards (
      id text PRIMARY KEY,
      pos int NOT NULL,
      title text NOT NULL,
      seq int NOT NULL,
      element_order jsonb NOT NULL,
      element_count int NOT NULL,
      created_by jsonb NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text,
      part_versions jsonb
    )`,
    `CREATE TABLE IF NOT EXISTS elements (
      board_id text NOT NULL,
      id text NOT NULL,
      pos int NOT NULL,
      body jsonb NOT NULL,
      PRIMARY KEY (board_id, id)
    )`,
    `CREATE TABLE IF NOT EXISTS batches (
      board_id text NOT NULL,
      seq int NOT NULL,
      actor jsonb NOT NULL,
      before jsonb NOT NULL,
      after jsonb NOT NULL,
      order_before jsonb NOT NULL,
      order_after jsonb NOT NULL,
      reverted_by int,
      restacked jsonb,
      part_only jsonb,
      PRIMARY KEY (board_id, seq)
    )`,
    `CREATE TABLE IF NOT EXISTS claims (
      id text PRIMARY KEY,
      board_id text NOT NULL,
      pos int NOT NULL,
      actor jsonb NOT NULL,
      target jsonb NOT NULL,
      note text,
      expires_at text NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS activity (
      id text PRIMARY KEY,
      pos int NOT NULL,
      board_id text NOT NULL,
      board_title text NOT NULL,
      actor jsonb NOT NULL,
      seq int NOT NULL,
      summary text NOT NULL,
      counts jsonb NOT NULL,
      at text NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS knowledge (
      id text PRIMARY KEY,
      pos int NOT NULL,
      title text NOT NULL,
      "text" text NOT NULL,
      created_at text NOT NULL,
      search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || "text")) STORED
    )`,
    `CREATE INDEX IF NOT EXISTS knowledge_search_idx ON knowledge USING gin (search_vector)`,
    `CREATE TABLE IF NOT EXISTS runs (
      id text PRIMARY KEY,
      pos int NOT NULL,
      board_id text NOT NULL,
      agent_id text NOT NULL,
      requested_by jsonb NOT NULL,
      design jsonb,
      message text NOT NULL,
      status text NOT NULL,
      steps jsonb NOT NULL,
      reply text,
      error jsonb,
      created_at text NOT NULL,
      finished_at text,
      batches jsonb NOT NULL,
      touched jsonb NOT NULL,
      reverted boolean NOT NULL,
      owner text
    )`,
    `CREATE INDEX IF NOT EXISTS runs_queued_idx ON runs (pos) WHERE status = 'queued'`,
    `CREATE TABLE IF NOT EXISTS idempotency (
      key text PRIMARY KEY,
      pos int NOT NULL,
      hash text NOT NULL,
      response jsonb NOT NULL,
      at double precision NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id int PRIMARY KEY,
      schema_version int NOT NULL,
      name text NOT NULL,
      agents_can_delete_others_elements boolean NOT NULL,
      require_claim_before_agent_write boolean NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS rate_limits (
      key text PRIMARY KEY,
      count int NOT NULL,
      window_end double precision NOT NULL
    )`
];

function asState(value: unknown): State {
    const raw = (value && typeof value === 'object' ? value : {}) as Partial<State>;
    const base = emptyState();
    const boards: State['boards'] = {};
    for (const [id, board] of Object.entries(raw.boards ?? {})) {
        boards[id] = {
            board: board.board,
            elements: board.elements ?? {},
            claims: board.claims ?? [],
            batches: board.batches ?? [],
            ...(board.partVersions ? { partVersions: board.partVersions } : {})
        };
    }
    return {
        schemaVersion: raw.schemaVersion ?? base.schemaVersion,
        users: raw.users ?? [],
        sessions: raw.sessions ?? {},
        invites: raw.invites ?? {},
        agents: raw.agents ?? [],
        boards,
        activity: raw.activity ?? [],
        knowledge: raw.knowledge ?? [],
        runs: raw.runs ?? [],
        idempotency: raw.idempotency ?? {},
        settings: { ...base.settings, ...raw.settings }
    };
}

function mapUser(row: any): User & { passwordHash: string } {
    return { id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at, passwordHash: row.password_hash };
}

function mapAgent(row: any): PrivateAgent {
    const agent: PrivateAgent = {
        id: row.id,
        name: row.name,
        harness: row.harness,
        scopes: row.scopes,
        capabilities: row.capabilities,
        instructions: row.instructions,
        boardIds: row.board_ids,
        mcpServers: row.mcp_servers,
        runner: row.runner,
        keyPrefix: row.key_prefix,
        keyHash: row.key_hash,
        status: row.status,
        lastSeenAt: row.last_seen_at,
        createdAt: row.created_at
    };
    if (row.secrets != null)
        agent.secrets = row.secrets;
    if (row.webhook_secret != null)
        agent.webhookSecret = row.webhook_secret;
    return agent;
}

function mapBoard(row: any): Board {
    const board: Board = {
        id: row.id,
        title: row.title,
        seq: row.seq,
        order: row.element_order,
        elementCount: row.element_count,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
    if (row.deleted_at != null)
        board.deletedAt = row.deleted_at;
    return board;
}

function mapBatch(row: any): Batch {
    const batch: Batch = {
        seq: row.seq,
        actor: row.actor,
        before: row.before,
        after: row.after,
        orderBefore: row.order_before,
        orderAfter: row.order_after
    };
    if (row.reverted_by != null)
        batch.revertedBy = row.reverted_by;
    if (row.restacked != null)
        batch.restacked = row.restacked;
    if (row.part_only != null)
        batch.partOnly = row.part_only;
    return batch;
}

function mapClaim(row: any): Claim {
    const claim: Claim = { id: row.id, boardId: row.board_id, actor: row.actor, target: row.target, expiresAt: row.expires_at };
    if (row.note != null)
        claim.note = row.note;
    return claim;
}

function mapActivity(row: any): ActivityEvent {
    return { id: row.id, boardId: row.board_id, boardTitle: row.board_title, actor: row.actor, seq: row.seq, summary: row.summary, counts: row.counts, at: row.at };
}

function mapKnowledge(row: any): KnowledgeDoc {
    return { id: row.id, title: row.title, text: row.text, createdAt: row.created_at };
}

function mapRun(row: any): Run {
    const run: Run = {
        id: row.id,
        boardId: row.board_id,
        agentId: row.agent_id,
        requestedBy: row.requested_by,
        message: row.message,
        status: row.status,
        steps: row.steps ?? [],
        reply: row.reply,
        error: row.error,
        createdAt: row.created_at,
        finishedAt: row.finished_at,
        batches: row.batches ?? [],
        touched: row.touched ?? [],
        reverted: row.reverted
    };
    if (row.design != null)
        run.design = row.design;
    return run;
}

async function loadState(client: Sql): Promise<State> {
    const settings = await client.query('SELECT * FROM settings WHERE id = 1');
    const users = await client.query('SELECT * FROM users ORDER BY pos, id');
    const sessions = await client.query('SELECT * FROM sessions ORDER BY pos, id');
    const invites = await client.query('SELECT * FROM invites ORDER BY pos, id');
    const agents = await client.query('SELECT * FROM agents ORDER BY pos, id');
    const boards = await client.query('SELECT * FROM boards ORDER BY pos, id');
    const elements = await client.query('SELECT * FROM elements ORDER BY board_id, pos, id');
    const batches = await client.query('SELECT * FROM batches ORDER BY board_id, seq');
    const claims = await client.query('SELECT * FROM claims ORDER BY board_id, pos, id');
    const activity = await client.query('SELECT * FROM activity ORDER BY pos, id');
    const knowledge = await client.query('SELECT * FROM knowledge ORDER BY pos, id');
    const runs = await client.query('SELECT * FROM runs ORDER BY pos, id');
    const idempotency = await client.query('SELECT * FROM idempotency ORDER BY pos, key');
    const base = emptyState();
    const setting = settings.rows[0];
    const state: State = {
        schemaVersion: setting ? setting.schema_version : base.schemaVersion,
        users: users.rows.map(mapUser),
        sessions: {},
        invites: {},
        agents: agents.rows.map(mapAgent),
        boards: {},
        activity: activity.rows.map(mapActivity),
        knowledge: knowledge.rows.map(mapKnowledge),
        runs: runs.rows.map(mapRun),
        idempotency: {},
        settings: setting ? {
            name: setting.name,
            agentsCanDeleteOthersElements: setting.agents_can_delete_others_elements,
            requireClaimBeforeAgentWrite: setting.require_claim_before_agent_write
        } : base.settings
    };
    for (const row of sessions.rows)
        state.sessions[row.id] = { userId: row.user_id, expires: row.expires };
    for (const row of invites.rows)
        state.invites[row.id] = { email: row.email, role: row.role, expires: row.expires };
    for (const row of idempotency.rows)
        state.idempotency[row.key] = { hash: row.hash, response: row.response, at: row.at };
    for (const row of boards.rows) {
        const data: BoardData = { board: mapBoard(row), elements: {}, claims: [], batches: [] };
        if (row.part_versions != null)
            data.partVersions = row.part_versions;
        state.boards[row.id] = data;
    }
    for (const row of elements.rows) {
        const board = state.boards[row.board_id];
        if (board)
            board.elements[row.id] = row.body as Element;
    }
    for (const row of claims.rows) {
        const board = state.boards[row.board_id];
        if (board)
            board.claims.push(mapClaim(row));
    }
    for (const row of batches.rows) {
        const board = state.boards[row.board_id];
        if (board)
            board.batches.push(mapBatch(row));
    }
    return state;
}

async function syncKeyed<T>(client: Sql, before: T[], after: T[], idOf: (item: T) => string, save: (item: T, pos: number) => Promise<void>, remove: (id: string) => Promise<void>) {
    const beforePos = new Map(before.map((item, pos) => [idOf(item), canonical(item) + '\n' + pos]));
    const afterIds = new Set(after.map(idOf));
    for (const item of before)
        if (!afterIds.has(idOf(item)))
            await remove(idOf(item));
    for (let pos = 0; pos < after.length; pos++) {
        const item = after[pos]!;
        if (beforePos.get(idOf(item)) !== canonical(item) + '\n' + pos)
            await save(item, pos);
    }
}

async function upsertSettings(client: Sql, state: State) {
    await client.query(`INSERT INTO settings (id, schema_version, name, agents_can_delete_others_elements, require_claim_before_agent_write)
      VALUES (1, $1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
        schema_version = EXCLUDED.schema_version,
        name = EXCLUDED.name,
        agents_can_delete_others_elements = EXCLUDED.agents_can_delete_others_elements,
        require_claim_before_agent_write = EXCLUDED.require_claim_before_agent_write`, [state.schemaVersion ?? 2, state.settings.name, state.settings.agentsCanDeleteOthersElements, state.settings.requireClaimBeforeAgentWrite]);
}

async function deleteBoard(client: Sql, id: string) {
    await client.query('DELETE FROM elements WHERE board_id = $1', [id]);
    await client.query('DELETE FROM batches WHERE board_id = $1', [id]);
    await client.query('DELETE FROM claims WHERE board_id = $1', [id]);
    await client.query('DELETE FROM boards WHERE id = $1', [id]);
}

async function upsertBoard(client: Sql, data: BoardData, pos: number) {
    const board = data.board;
    await client.query(`INSERT INTO boards (id, pos, title, seq, element_order, element_count, created_by, created_at, updated_at, deleted_at, part_versions)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $10, $11::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        pos = EXCLUDED.pos, title = EXCLUDED.title, seq = EXCLUDED.seq, element_order = EXCLUDED.element_order,
        element_count = EXCLUDED.element_count, created_by = EXCLUDED.created_by, created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at, part_versions = EXCLUDED.part_versions`, [board.id, pos, board.title, board.seq, jsonb(board.order), board.elementCount, jsonb(board.createdBy), board.createdAt, board.updatedAt, board.deletedAt ?? null, jsonb(data.partVersions)]);
}

async function syncElements(client: Sql, boardId: string, before: Record<string, Element>, after: Record<string, Element>) {
    const beforeIds = Object.keys(before);
    const afterIds = Object.keys(after);
    for (const id of beforeIds)
        if (!after[id])
            await client.query('DELETE FROM elements WHERE board_id = $1 AND id = $2', [boardId, id]);
    for (let pos = 0; pos < afterIds.length; pos++) {
        const id = afterIds[pos]!;
        if (before[id] && beforeIds.indexOf(id) === pos && canonical(before[id]) === canonical(after[id]))
            continue;
        await client.query(`INSERT INTO elements (board_id, id, pos, body) VALUES ($1, $2, $3, $4::jsonb)
          ON CONFLICT (board_id, id) DO UPDATE SET pos = EXCLUDED.pos, body = EXCLUDED.body`, [boardId, id, pos, jsonb(after[id])]);
    }
}

async function syncClaims(client: Sql, boardId: string, before: Claim[], after: Claim[]) {
    await syncKeyed(client, before, after, claim => claim.id, async (claim, pos) => {
        await client.query(`INSERT INTO claims (id, board_id, pos, actor, target, note, expires_at)
          VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
          ON CONFLICT (id) DO UPDATE SET board_id = EXCLUDED.board_id, pos = EXCLUDED.pos, actor = EXCLUDED.actor, target = EXCLUDED.target, note = EXCLUDED.note, expires_at = EXCLUDED.expires_at`, [claim.id, boardId, pos, jsonb(claim.actor), jsonb(claim.target), claim.note ?? null, claim.expiresAt]);
    }, async id => { await client.query('DELETE FROM claims WHERE id = $1', [id]); });
}

async function syncBatches(client: Sql, boardId: string, before: Batch[], after: Batch[]) {
    await syncKeyed(client, before, after, batch => String(batch.seq), async (batch, _pos) => {
        await client.query(`INSERT INTO batches (board_id, seq, actor, before, after, order_before, order_after, reverted_by, restacked, part_only)
          VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10::jsonb)
          ON CONFLICT (board_id, seq) DO UPDATE SET
            actor = EXCLUDED.actor, before = EXCLUDED.before, after = EXCLUDED.after, order_before = EXCLUDED.order_before,
            order_after = EXCLUDED.order_after, reverted_by = EXCLUDED.reverted_by, restacked = EXCLUDED.restacked, part_only = EXCLUDED.part_only`, [boardId, batch.seq, jsonb(batch.actor), jsonb(batch.before), jsonb(batch.after), jsonb(batch.orderBefore), jsonb(batch.orderAfter), batch.revertedBy ?? null, jsonb(batch.restacked), jsonb(batch.partOnly)]);
    }, async seq => { await client.query('DELETE FROM batches WHERE board_id = $1 AND seq = $2', [boardId, Number(seq)]); });
}

async function persistBoards(client: Sql, before: State, after: State) {
    const beforeIds = Object.keys(before.boards);
    const afterIds = Object.keys(after.boards);
    for (const id of beforeIds)
        if (!after.boards[id])
            await deleteBoard(client, id);
    for (let pos = 0; pos < afterIds.length; pos++) {
        const id = afterIds[pos]!;
        const next = after.boards[id]!;
        const prev = before.boards[id];
        const same = prev && canonical(prev) === canonical(next);
        if (same && beforeIds.indexOf(id) === pos)
            continue;
        if (same) {
            await client.query('UPDATE boards SET pos = $2 WHERE id = $1', [id, pos]);
            continue;
        }
        await upsertBoard(client, next, pos);
        await syncElements(client, id, prev?.elements ?? {}, next.elements);
        await syncClaims(client, id, prev?.claims ?? [], next.claims);
        await syncBatches(client, id, prev?.batches ?? [], next.batches);
    }
}

async function persist(client: Sql, before: State, after: State) {
    await syncKeyed(client, before.users, after.users, user => user.id, async (user, pos) => {
        await client.query(`INSERT INTO users (id, pos, email, name, role, password_hash, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO UPDATE SET pos = EXCLUDED.pos, email = EXCLUDED.email, name = EXCLUDED.name, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, created_at = EXCLUDED.created_at`, [user.id, pos, user.email, user.name, user.role, user.passwordHash, user.createdAt]);
    }, async id => { await client.query('DELETE FROM users WHERE id = $1', [id]); });
    await syncKeyed(client, Object.entries(before.sessions), Object.entries(after.sessions), ([id]) => id, async ([id, session], pos) => {
        await client.query(`INSERT INTO sessions (id, pos, user_id, expires) VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE SET pos = EXCLUDED.pos, user_id = EXCLUDED.user_id, expires = EXCLUDED.expires`, [id, pos, session.userId, session.expires]);
    }, async id => { await client.query('DELETE FROM sessions WHERE id = $1', [id]); });
    await syncKeyed(client, Object.entries(before.invites), Object.entries(after.invites), ([id]) => id, async ([id, invite], pos) => {
        await client.query(`INSERT INTO invites (id, pos, email, role, expires) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO UPDATE SET pos = EXCLUDED.pos, email = EXCLUDED.email, role = EXCLUDED.role, expires = EXCLUDED.expires`, [id, pos, invite.email, invite.role, invite.expires]);
    }, async id => { await client.query('DELETE FROM invites WHERE id = $1', [id]); });
    await syncKeyed(client, before.agents, after.agents, agent => agent.id, async (agent, pos) => {
        await client.query(`INSERT INTO agents (
          id, pos, name, harness, scopes, capabilities, instructions, board_ids, mcp_servers, runner, key_prefix, key_hash, status, last_seen_at, created_at, secrets, webhook_secret
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16::jsonb, $17)
        ON CONFLICT (id) DO UPDATE SET
          pos = EXCLUDED.pos, name = EXCLUDED.name, harness = EXCLUDED.harness, scopes = EXCLUDED.scopes, capabilities = EXCLUDED.capabilities,
          instructions = EXCLUDED.instructions, board_ids = EXCLUDED.board_ids, mcp_servers = EXCLUDED.mcp_servers, runner = EXCLUDED.runner,
          key_prefix = EXCLUDED.key_prefix, key_hash = EXCLUDED.key_hash, status = EXCLUDED.status, last_seen_at = EXCLUDED.last_seen_at,
          created_at = EXCLUDED.created_at, secrets = EXCLUDED.secrets, webhook_secret = EXCLUDED.webhook_secret`, [agent.id, pos, agent.name, agent.harness, jsonb(agent.scopes), jsonb(agent.capabilities), agent.instructions, jsonb(agent.boardIds), jsonb(agent.mcpServers), jsonb(agent.runner), agent.keyPrefix, agent.keyHash, agent.status, agent.lastSeenAt, agent.createdAt, jsonb(agent.secrets), agent.webhookSecret ?? null]);
    }, async id => { await client.query('DELETE FROM agents WHERE id = $1', [id]); });
    await persistBoards(client, before, after);
    await syncKeyed(client, before.activity, after.activity, event => event.id, async (event, pos) => {
        await client.query(`INSERT INTO activity (id, pos, board_id, board_title, actor, seq, summary, counts, at)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9)
          ON CONFLICT (id) DO UPDATE SET pos = EXCLUDED.pos, board_id = EXCLUDED.board_id, board_title = EXCLUDED.board_title, actor = EXCLUDED.actor, seq = EXCLUDED.seq, summary = EXCLUDED.summary, counts = EXCLUDED.counts, at = EXCLUDED.at`, [event.id, pos, event.boardId, event.boardTitle, jsonb(event.actor), event.seq, event.summary, jsonb(event.counts), event.at]);
    }, async id => { await client.query('DELETE FROM activity WHERE id = $1', [id]); });
    await syncKeyed(client, before.knowledge, after.knowledge, doc => doc.id, async (doc, pos) => {
        await client.query(`INSERT INTO knowledge (id, pos, title, "text", created_at) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO UPDATE SET pos = EXCLUDED.pos, title = EXCLUDED.title, "text" = EXCLUDED."text", created_at = EXCLUDED.created_at`, [doc.id, pos, doc.title, doc.text, doc.createdAt]);
    }, async id => { await client.query('DELETE FROM knowledge WHERE id = $1', [id]); });
    await syncKeyed(client, before.runs, after.runs, run => run.id, async (run, pos) => {
        await client.query(`INSERT INTO runs (
          id, pos, board_id, agent_id, requested_by, design, message, status, steps, reply, error, created_at, finished_at, batches, touched, reverted
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9::jsonb, $10, $11::jsonb, $12, $13, $14::jsonb, $15::jsonb, $16)
        ON CONFLICT (id) DO UPDATE SET
          pos = EXCLUDED.pos, board_id = EXCLUDED.board_id, agent_id = EXCLUDED.agent_id, requested_by = EXCLUDED.requested_by,
          design = EXCLUDED.design, message = EXCLUDED.message, status = EXCLUDED.status, steps = EXCLUDED.steps, reply = EXCLUDED.reply,
          error = EXCLUDED.error, created_at = EXCLUDED.created_at, finished_at = EXCLUDED.finished_at, batches = EXCLUDED.batches,
          touched = EXCLUDED.touched, reverted = EXCLUDED.reverted,
          owner = CASE WHEN EXCLUDED.status = 'running' THEN runs.owner ELSE NULL END`, [run.id, pos, run.boardId, run.agentId, jsonb(run.requestedBy), jsonb(run.design), run.message, run.status, jsonb(run.steps), run.reply, jsonb(run.error), run.createdAt, run.finishedAt, jsonb(run.batches), jsonb(run.touched), run.reverted]);
    }, async id => { await client.query('DELETE FROM runs WHERE id = $1', [id]); });
    await syncKeyed(client, Object.entries(before.idempotency), Object.entries(after.idempotency), ([key]) => key, async ([key, entry], pos) => {
        await client.query(`INSERT INTO idempotency (key, pos, hash, response, at) VALUES ($1, $2, $3, $4::jsonb, $5)
          ON CONFLICT (key) DO UPDATE SET pos = EXCLUDED.pos, hash = EXCLUDED.hash, response = EXCLUDED.response, at = EXCLUDED.at`, [key, pos, entry.hash, jsonb(entry.response), entry.at]);
    }, async key => { await client.query('DELETE FROM idempotency WHERE key = $1', [key]); });
    if ((before.schemaVersion ?? 2) !== (after.schemaVersion ?? 2) || canonical(before.settings) !== canonical(after.settings))
        await upsertSettings(client, after);
}

function boardsWithNewBatches(before: State, after: State) {
    const ids: string[] = [];
    for (const [id, board] of Object.entries(after.boards)) {
        const previous = new Set((before.boards[id]?.batches ?? []).map(batch => batch.seq));
        if (board.batches.some(batch => !previous.has(batch.seq)))
            ids.push(id);
    }
    return ids;
}

async function normalizedEmpty(client: Sql) {
    const result = await client.query(`SELECT (
      (SELECT count(*) FROM users) + (SELECT count(*) FROM sessions) + (SELECT count(*) FROM invites) +
      (SELECT count(*) FROM agents) + (SELECT count(*) FROM boards) + (SELECT count(*) FROM elements) +
      (SELECT count(*) FROM batches) + (SELECT count(*) FROM claims) + (SELECT count(*) FROM activity) +
      (SELECT count(*) FROM knowledge) + (SELECT count(*) FROM runs) + (SELECT count(*) FROM idempotency) +
      (SELECT count(*) FROM settings)
    ) AS n`);
    return Number(result.rows[0].n) === 0;
}

export async function createPostgresStore(url: string, options?: PostgresStoreOptions) {
    const schema = options?.schema ?? 'public';
    assertSchema(schema);
    const { Pool, Client } = await import('pg');
    if (schema !== 'public') {
        const bootstrap = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
        await bootstrap.connect();
        try {
            await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
        }
        finally {
            await bootstrap.end();
        }
    }
    const pool = new Pool({ connectionString: url, max: 12, connectionTimeoutMillis: 5000, options: `-c search_path=${schema}` });
    pool.on('error', () => undefined);
    pool.on('connect', client => { client.on('error', () => undefined); });
    const ownerToken = process.pid + ':' + randomBytes(4).toString('hex');
    const leases = new Map<string, import('pg').PoolClient>();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [MIGRATION_LOCK]);
        for (const statement of DDL)
            await client.query(statement);
        const legacy = await client.query('SELECT data FROM workspace_state WHERE id = 1');
        if (legacy.rows[0] && await normalizedEmpty(client)) {
            const raw = legacy.rows[0].data;
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const imported = migrateState(asState(structuredClone(parsed)));
            await persist(client, emptyState(), imported);
            await upsertSettings(client, imported);
        }
        await client.query('COMMIT');
    }
    catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* already closed */ }
        client.release();
        await pool.end();
        throw error;
    }
    client.release();

    async function transaction<T>(fn: (s: State) => T | Promise<T>): Promise<T> {
        const tx = await pool.connect();
        try {
            await tx.query('BEGIN');
            await tx.query('SELECT pg_advisory_xact_lock($1::bigint)', [WRITE_LOCK]);
            const loaded = await loadState(tx);
            const before = structuredClone(loaded);
            const draft = migrateState(structuredClone(loaded));
            const result = await fn(draft);
            if (canonical(before) !== canonical(draft)) {
                await persist(tx, before, draft);
                for (const boardId of boardsWithNewBatches(before, draft))
                    await tx.query(`SELECT pg_notify('board_ops', $1)`, [boardId]);
                await tx.query(`INSERT INTO workspace_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [JSON.stringify(draft)]);
            }
            await tx.query('COMMIT');
            return result;
        }
        catch (error) {
            try { await tx.query('ROLLBACK'); } catch { /* already aborted */ }
            throw error;
        }
        finally {
            tx.release();
        }
    }

    async function releaseRun(id: string) {
        const lease = leases.get(id);
        if (!lease)
            return;
        leases.delete(id);
        try { await lease.query('SELECT pg_advisory_unlock($1::bigint)', [runLockKey(id)]); }
        catch { /* connection already gone */ }
        lease.release();
    }

    return {
        async read() {
            const tx = await pool.connect();
            try {
                await tx.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
                const state = migrateState(await loadState(tx));
                await tx.query('COMMIT');
                return state;
            }
            catch (error) {
                try { await tx.query('ROLLBACK'); } catch { /* already aborted */ }
                throw error;
            }
            finally {
                tx.release();
            }
        },
        transaction,
        async claimQueuedRun() {
            const lease = await pool.connect();
            let id: string | undefined;
            let locked = false;
            try {
                await lease.query('BEGIN');
                await lease.query('SELECT pg_advisory_xact_lock($1::bigint)', [WRITE_LOCK]);
                const picked = await lease.query(`SELECT id FROM runs WHERE status = 'queued' ORDER BY pos ASC FOR UPDATE SKIP LOCKED LIMIT 1`);
                if (!picked.rows[0]) {
                    await lease.query('COMMIT');
                    lease.release();
                    return undefined;
                }
                id = picked.rows[0].id as string;
                await lease.query(`UPDATE runs SET status = 'running', owner = $2 WHERE id = $1`, [id, ownerToken]);
                await lease.query('SELECT pg_advisory_lock($1::bigint)', [runLockKey(id)]);
                locked = true;
                await lease.query('COMMIT');
                const row = await lease.query('SELECT * FROM runs WHERE id = $1', [id]);
                leases.set(id, lease);
                return mapRun(row.rows[0]);
            }
            catch (error) {
                try { await lease.query('ROLLBACK'); } catch { /* already aborted */ }
                if (locked && id) {
                    try { await lease.query('SELECT pg_advisory_unlock($1::bigint)', [runLockKey(id)]); } catch { /* not held */ }
                }
                lease.release();
                throw error;
            }
        },
        releaseRun,
        async recoverInterruptedRuns() {
            const probe = await pool.connect();
            const dead: string[] = [];
            try {
                const running = await probe.query(`SELECT id FROM runs WHERE status = 'running' ORDER BY pos, id`);
                for (const row of running.rows) {
                    const key = runLockKey(row.id);
                    const got = await probe.query(`SELECT pg_try_advisory_lock($1::bigint) AS ok`, [key]);
                    if (!got.rows[0]?.ok)
                        continue;
                    dead.push(row.id);
                    await probe.query('SELECT pg_advisory_unlock($1::bigint)', [key]);
                }
            }
            finally {
                probe.release();
            }
            if (!dead.length)
                return;
            const deadIds = new Set(dead);
            await transaction(state => {
                const finishedAt = new Date().toISOString();
                for (const run of state.runs) {
                    if (!deadIds.has(run.id) || run.status !== 'running')
                        continue;
                    run.status = 'failed';
                    run.error = { code: 'interrupted', message: 'The worker stopped during this run.' };
                    run.finishedAt = finishedAt;
                    const board = state.boards[run.boardId];
                    const stillHere = state.runs.some(other => other.id !== run.id && other.agentId === run.agentId && other.boardId === run.boardId && (other.status === 'queued' || other.status === 'running'));
                    if (board && !stillHere)
                        board.claims = board.claims.filter(claim => !(claim.actor.kind === 'agent' && claim.actor.id === run.agentId));
                }
            });
        },
        async throttle(key: string, max: number, ms: number) {
            const now = Date.now();
            const result = await pool.query(`INSERT INTO rate_limits (key, count, window_end) VALUES ($1, 1, $2)
              ON CONFLICT (key) DO UPDATE SET
                count = CASE WHEN rate_limits.window_end > $3 THEN rate_limits.count + 1 ELSE 1 END,
                window_end = CASE WHEN rate_limits.window_end > $3 THEN rate_limits.window_end ELSE $2 END
              RETURNING count`, [key, now + ms, now]);
            if (result.rows[0].count > max)
                fail('rate_limited', 'Too many requests. Try again shortly.');
        },
        async close() {
            for (const id of [...leases.keys()])
                await releaseRun(id);
            await pool.end();
        }
    };
}

export function listenBoardOps(url: string, handlers: {
    onNotify: (boardId: string) => void;
    onReconnect: () => void;
}) {
    let stopped = false;
    let attempt = 0;
    let connectedBefore = false;
    let current: import('pg').Client | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let opening = false;
    const schedule = (delay: number) => {
        if (stopped)
            return;
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(() => void connect(), delay);
        timer.unref?.();
    };
    const connect = async () => {
        if (stopped || opening)
            return;
        opening = true;
        let client: import('pg').Client | null = null;
        let ready = false;
        try {
            const { Client } = await import('pg');
            client = new Client({ connectionString: url, connectionTimeoutMillis: 5000, application_name: 'agentboard-board-ops' });
            current = client;
            const lost = () => {
                if (!ready || stopped || current !== client)
                    return;
                ready = false;
                current = null;
                client?.removeAllListeners();
                void client?.end().catch(() => undefined);
                opening = false;
                attempt = Math.min(attempt + 1, 5);
                schedule(Math.min(250 * 2 ** attempt, 5000));
            };
            client.on('error', lost);
            client.on('end', lost);
            await client.connect();
            if (stopped || current !== client) {
                opening = false;
                client.removeAllListeners();
                void client.end().catch(() => undefined);
                return;
            }
            await client.query('LISTEN board_ops');
            client.on('notification', message => {
                if (message.channel !== 'board_ops' || !message.payload)
                    return;
                try { handlers.onNotify(message.payload); }
                catch { /* keep the listener connected */ }
            });
            ready = true;
            opening = false;
            attempt = 0;
            if (connectedBefore) {
                try { handlers.onReconnect(); }
                catch { /* keep the listener connected */ }
            }
            connectedBefore = true;
        }
        catch {
            if (client) {
                client.removeAllListeners();
                void client.end().catch(() => undefined);
            }
            if (current === client)
                current = null;
            opening = false;
            if (!stopped) {
                attempt = Math.min(attempt + 1, 5);
                schedule(Math.min(250 * 2 ** attempt, 5000));
            }
        }
    };
    void connect();
    return {
        async close() {
            stopped = true;
            if (timer)
                clearTimeout(timer);
            const client = current;
            current = null;
            if (!client)
                return;
            client.removeAllListeners();
            try { await client.end(); }
            catch { /* already closed */ }
        }
    };
}
