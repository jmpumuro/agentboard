import type { Ability, Element, Op } from 'contract';
import type { Auth } from './core';
import { fail } from '../lib/errors';
export function requireAbility(auth: Auth, ability: Ability) {
    if (auth.agent && !(auth.agent.capabilities ?? []).includes(ability))
        fail('forbidden', `This agent may not ${ability}. The owner can enable this ability.`, { ability });
}
export function authorizeOperation(auth: Auth, op: Op, current?: Element) {
    if (op.op === 'create')
        return requireAbility(auth, op.data.type === 'drawing' ? 'draw' : 'add');
    if (op.op === 'delete')
        return requireAbility(auth, 'delete');
    if (op.op !== 'update')
        return requireAbility(auth, 'edit');
    const keys = Object.keys(op.data);
    const strokes = current?.type === 'drawing' && keys.includes('strokes');
    if (strokes)
        requireAbility(auth, 'draw');
    if (!strokes || keys.some(key => key !== 'strokes'))
        requireAbility(auth, 'edit');
}
