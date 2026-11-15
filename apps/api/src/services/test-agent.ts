import { AgentCreateSchema } from 'contract';
import type { Store } from '../db/store';
import { uid, hash, now, createBoard, applyOps, type Auth, publicAgent } from './core';
export const TEST_AGENT_NAME = 'OpenAI Integration Test';
/** Idempotent local-owner setup; the test agent is restricted to its own sandbox board. */
export async function ensureIntegrationAgent(store: Store) {
    return store.transaction(s => {
        const existing = s.agents.find(a => a.harness === 'agentboard-integration-test');
        if (existing)
            return { agent: publicAgent(existing), boardId: existing.boardIds?.[0], created: false };
        const owner = s.users.find(u => u.role === 'owner');
        if (!owner)
            throw Error('Create the workspace owner before setting up the integration agent.');
        const actor = { kind: 'user' as const, id: owner.id, name: owner.name };
        const auth: Auth = { actor, user: owner, scopes: ['boards:read', 'boards:write'] };
        const board = createBoard(s, auth, 'OpenAI integration sandbox');
        applyOps(s, auth, board.id, { ops: [{ op: 'create', data: { type: 'text', x: 80, y: 60, text: 'OpenAI integration sandbox', size: 'title' } }, { op: 'create', data: { type: 'note', x: 80, y: 150, w: 240, h: 180, text: 'Use this board to test the OpenAI agent. It cannot access your other boards.', color: 'green' } }] });
        const input = AgentCreateSchema.parse({ name: TEST_AGENT_NAME, harness: 'agentboard-integration-test', scopes: ['boards:read', 'boards:write'], boardIds: [board.id], instructions: 'Read the whole board before acting. Use the available board tools, place new work in open space, and describe drawings clearly. This is an integration sandbox. Do not delete work.' });
        // Built-in runs use the actor directly. No retrievable agent API key is needed.
        const key = 'ab_live_' + uid('').slice(1) + uid('').slice(1);
        const agent = { ...input, mcpServers: [], id: uid('agt'), keyHash: hash(key), keyPrefix: key.slice(0, 10), status: 'active' as const, lastSeenAt: null, createdAt: now() };
        s.agents.push(agent);
        return { agent: publicAgent(agent), boardId: board.id, created: true };
    });
}
