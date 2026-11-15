import type { State } from '../db/store';
import { board, type Auth } from './core';

export type LiveIdentity = { sessionHash?: string; keyHash?: string };
/** Reauthorize long-lived connections against current state, retaining no raw credential. */
export function liveAccess(state: State, identity: LiveIdentity, boardId: string): Auth | undefined {
    let auth: Auth | undefined;
    if (identity.keyHash) {
        const agent = state.agents.find(a => a.keyHash === identity.keyHash && a.status === 'active');
        if (agent) auth = { agent, actor: { kind: 'agent', id: agent.id, name: agent.name }, scopes: agent.scopes };
    } else if (identity.sessionHash) {
        const session = state.sessions[identity.sessionHash];
        const user = session && session.expires > Date.now() && state.users.find(u => u.id === session.userId);
        if (user) auth = { user, actor: { kind: 'user', id: user.id, name: user.name }, scopes: ['boards:read', 'boards:write'] };
    }
    if (!auth) return;
    try { board(state, auth, boardId); return auth; } catch { return; }
}
