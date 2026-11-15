import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Board, Element, Claim, Agent, User, ActivityEvent, Run, WorkspaceSettings, KnowledgeDoc, Actor } from 'contract';
export type Batch = {
    seq: number;
    actor: Actor;
    before: Record<string, Element>;
    after: Record<string, Element>;
    orderBefore: string[];
    orderAfter: string[];
    revertedBy?: number;
    restacked?: string[];
    partOnly?: Record<string, string[]>;
};
export type BoardData = {
    board: Board;
    elements: Record<string, Element>;
    claims: Claim[];
    batches: Batch[];
    partVersions?: Record<string, Record<string, number>>;
};
export type PrivateAgent = Agent & {
    keyHash: string;
    secrets?: Record<string, string>;
    webhookSecret?: string;
};
export type State = {
    schemaVersion?: number;
    users: (User & {
        passwordHash: string;
    })[];
    sessions: Record<string, {
        userId: string;
        expires: number;
    }>;
    invites: Record<string, {
        email: string;
        role: 'owner' | 'member';
        expires: number;
    }>;
    agents: PrivateAgent[];
    boards: Record<string, BoardData>;
    activity: ActivityEvent[];
    knowledge: KnowledgeDoc[];
    runs: Run[];
    idempotency: Record<string, {
        hash: string;
        response: unknown;
        at: number;
    }>;
    settings: WorkspaceSettings;
};
export const emptyState = (): State => ({ schemaVersion: 2, users: [], sessions: {}, invites: {}, agents: [], boards: {}, activity: [], knowledge: [], runs: [], idempotency: {}, settings: { name: 'My workspace', agentsCanDeleteOthersElements: false, requireClaimBeforeAgentWrite: false } });
export interface Store {
    read(): Promise<State>;
    transaction<T>(fn: (s: State) => T | Promise<T>): Promise<T>;
    close(): Promise<void>;
    /** Postgres only. Claim one queued run with FOR UPDATE SKIP LOCKED. */
    claimQueuedRun?(): Promise<Run | undefined>;
    /** Postgres only. Drop the session lock held for a claimed run. */
    releaseRun?(id: string): Promise<void>;
    /** Postgres only. Fail running runs whose worker session is gone. */
    recoverInterruptedRuns?(): Promise<void>;
    /** Postgres only. Shared throttle window. Throws the existing rate_limited error. */
    throttle?(key: string, max: number, ms: number): Promise<void>;
}
export function migrateState(s: State) {
    if ((s.schemaVersion ?? 1) < 2) {
        for (const ag of s.agents) {
            ag.capabilities = [...new Set([...ag.capabilities, ...(ag.scopes.includes('boards:write') ? ['add', 'draw', 'edit'] as const : [])])];
        }
        s.schemaVersion = 2;
    }
    return s;
}
// Local development only: one process, atomic file replacement, serialized mutations.
export class LocalStore implements Store {
    private state = emptyState();
    private queue: Promise<unknown> = Promise.resolve();
    constructor(private path?: string) { }
    async init() {
        if (this.path) {
            try {
                this.state = migrateState(JSON.parse(await readFile(this.path, 'utf8')));
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
            }
        }
        return this;
    }
    async read() { await this.queue; return structuredClone(this.state); }
    transaction<T>(fn: (s: State) => T | Promise<T>): Promise<T> {
        const next = this.queue.then(async () => {
            const draft = structuredClone(this.state);
            const result = await fn(draft);
            if (this.path) {
                await mkdir(dirname(this.path), { recursive: true });
                await writeFile(this.path + '.tmp', JSON.stringify(draft), { mode: 0o600 });
                await rename(this.path + '.tmp', this.path);
            }
            this.state = draft;
            return structuredClone(result);
        });
        this.queue = next.catch(() => { });
        return next;
    }
    async close() { await this.queue; }
}
export type PostgresStoreOptions = {
    schema?: string;
};
// Normalized PostgreSQL adapter. LocalStore above is unchanged.
export async function postgresStore(url: string, options?: PostgresStoreOptions): Promise<Store> {
    const { createPostgresStore } = await import('./postgres');
    return createPostgresStore(url, options);
}
