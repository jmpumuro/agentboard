import { EXAMPLE_BOARDS } from 'contract';
import { LocalStore, postgresStore } from '../apps/api/src/db/store';
import { uid, now, passwordHash, hash, createBoard, applyOps, type Auth } from '../apps/api/src/services/core';
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 8)
    throw Error('Set SEED_PASSWORD to a password of at least 8 characters.');
const store = process.env.DATABASE_URL ? await postgresStore(process.env.DATABASE_URL) : await new LocalStore(process.env.DATA_FILE || '.data/workspace.json').init();
try {
    const key = 'ab_live_' + uid('').slice(1) + uid('').slice(1);
    const result = await store.transaction(async (s) => {
        if (s.users.length)
            throw Error('Seed is only available for a new workspace.');
        const u = { id: uid('usr'), name: 'Alex', email: process.env.SEED_EMAIL || 'alex@example.com', role: 'owner' as const, createdAt: now(), passwordHash: await passwordHash(password) };
        s.users.push(u);
        const auth: Auth = { actor: { kind: 'user', id: u.id, name: u.name }, user: u, scopes: ['boards:read', 'boards:write'] };
        const ag = { id: uid('agt'), name: 'Planner', harness: 'custom', scopes: ['boards:read' as const, 'boards:write' as const], capabilities: ['add' as const, 'draw' as const, 'edit' as const, 'knowledge' as const], instructions: 'Help the team explore new perspectives. Read the board first and place notes in open space.', boardIds: null, mcpServers: [], runner: { kind: 'builtin' as const }, keyHash: hash(key), keyPrefix: key.slice(0, 10), status: 'active' as const, lastSeenAt: null, createdAt: now() };
        s.agents.push(ag);
        const b = createBoard(s, auth, 'A better way to work together');
        applyOps(s, auth, b.id, { ops: [{ op: 'create', data: { type: 'text', x: 80, y: 60, text: 'A better way to work together', size: 'title' } }, { op: 'create', data: { type: 'text', x: 80, y: 120, text: 'People bring perspective. Agents help us explore what’s possible.', size: 'body' } }, ...['yellow', 'blue', 'green', 'pink'].map((color, i) => ({ op: 'create', id: 'starter_' + i, data: { type: 'note', x: 80 + (i % 3) * 250, y: 210 + Math.floor(i / 3) * 230, w: 210, h: 190, text: ['Start with a question\n\nWhat would make our work feel simpler?', 'Explore possibilities\n\nMake space for unexpected ideas.', 'Find the next step\n\nChoose one small thing to try.', 'A little reminder\n\nYou can always change your mind.'][i], color } })), { op: 'create', data: { type: 'arrow', x: 0, y: 0, from: 'starter_1', to: 'starter_2', label: 'try it' } }] });
        const exampleBoards = EXAMPLE_BOARDS.map(example => { const board = createBoard(s, auth, example.title); applyOps(s, auth, board.id, { ops: example.ops }); return board.id; });
        return { email: u.email, boardId: b.id, exampleBoards };
    });
    console.log('Seeded:', result);
    console.log('Agent key (shown once):', key);
}
finally {
    await store.close();
}
