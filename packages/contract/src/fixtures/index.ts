import * as c from '../index';
const at = '2026-11-14T15:00:00.000Z', actor = { kind: 'user', id: 'usr_example', name: 'Alex' } as const;
const user = { id: actor.id, name: actor.name, email: 'alex@example.com', role: 'owner', createdAt: at };
const note = { type: 'note', x: 40, y: 80, w: 210, h: 170, text: 'A thought', color: 'yellow' };
const element = { ...note, id: 'el_note', version: 1, createdBy: actor, updatedBy: actor, updatedAt: at };
const board = { id: 'brd_example', title: 'Thinking together', seq: 1, order: [element.id], elementCount: 1, createdBy: actor, createdAt: at, updatedAt: at };
const agentInput = { name: 'Planner', harness: 'custom', scopes: ['boards:read', 'boards:write'], instructions: 'Help the team explore.', capabilities: ['knowledge'], mcpServers: [], runner: { kind: 'builtin' }, boardIds: null };
const agent = { ...agentInput, id: 'agt_example', status: 'active', keyPrefix: 'ab_live_12', lastSeenAt: null, createdAt: at };
const claim = { id: 'clm_example', boardId: board.id, actor, target: { rect: { x: 0, y: 0, w: 800, h: 600 } }, note: 'Exploring', expiresAt: at };
const step = { id: 'step_example', kind: 'mcp', name: 'read_board', note: 'Read the board.', status: 'done' };
const run = { id: 'run_example', boardId: board.id, agentId: agent.id, requestedBy: actor, message: 'Explore ideas', status: 'done', steps: [step], reply: 'Done.', error: null, createdAt: at, finishedAt: at, batches: [1], touched: [element.id], reverted: false };
export const fixtures: [
    string,
    {
        parse: (value: unknown) => unknown;
    },
    unknown
][] = [
    ['drawing', c.DrawingInput, c.DRAWING_EXAMPLE], ['actor', c.ActorSchema, actor], ['user', c.UserSchema, user], ['color', c.ColorSchema, 'yellow'], ['scope', c.ScopeSchema, 'boards:read'], ['element input', c.ElementInputSchema, note], ['element', c.ElementSchema, element], ['op', c.OpSchema, { op: 'create', id: element.id, data: note }], ['ops request', c.OpsRequestSchema, { ops: [{ op: 'create', data: note }] }], ['ops response', c.OpsResponseSchema, { seq: 1, results: [{ id: element.id, version: 1 }] }], ['board', c.BoardSchema, board], ['target', c.TargetSchema, claim.target], ['claim', c.ClaimSchema, claim], ['settings', c.SettingsSchema, { name: 'Workspace', agentsCanDeleteOthersElements: false, requireClaimBeforeAgentWrite: false }], ['server input', c.ServerInput, { name: 'Library', url: 'https://example.com/mcp' }], ['agent create', c.AgentCreateSchema, agentInput], ['agent', c.AgentSchema, agent], ['activity', c.ActivitySchema, { id: 'evt_example', boardId: board.id, boardTitle: board.title, actor, seq: 1, summary: 'added 1 element', counts: { created: 1, updated: 0, deleted: 0 }, at }], ['knowledge', c.KnowledgeSchema, { id: 'doc_example', title: 'Brief', text: 'Useful context', createdAt: at }], ['passage', c.PassageSchema, { docId: 'doc_example', title: 'Brief', passage: 'Useful context', score: 1 }], ['run step', c.RunStepSchema, step], ['run', c.RunSchema, run], ['error', c.ErrorSchema, { error: { code: 'version_conflict', message: 'Changed.', details: { current: element } } }], ['signup', c.SignupSchema, { name: actor.name, email: user.email, password: 'example-only' }], ['login', c.LoginSchema, { email: user.email, password: 'example-only' }], ['presence', c.PresenceSchema, { actor, cursor: null }], ['applied op', c.AppliedOpSchema, { op: 'create', element }], ['server message', c.ServerMsgSchema, { t: 'hello', seq: 1, presence: [], claims: [claim] }], ['client message', c.ClientMsgSchema, { t: 'cursor', x: 20, y: 40 }]
];
