import { describe, it, expect } from 'vitest';
import { ElementInputSchema, OpsRequestSchema, ServerMsgSchema, AgentCreateSchema, SignupSchema } from '../packages/contract/src/index';
describe('stage 1: boundary contract', () => {
    it('accepts every element kind', () => {
        for (const data of [{ type: 'note', x: 0, y: 0, w: 200, h: 160, text: 'hello', color: 'yellow' }, { type: 'shape', x: 0, y: 0, w: 200, h: 160, text: 'hello', color: 'blue', kind: 'rect' }, { type: 'text', x: 0, y: 0, text: 'title', size: 'title' }, { type: 'arrow', x: 0, y: 0, from: 'a', to: 'b' }])
            expect(ElementInputSchema.safeParse(data).success).toBe(true);
    });
    it('refuses grouping, extreme geometry, full order and empty batches', () => { expect(ElementInputSchema.safeParse({ type: 'section' }).success).toBe(false); expect(OpsRequestSchema.safeParse({ ops: [], order: [] }).success).toBe(false); expect(ElementInputSchema.safeParse({ type: 'note', x: 1e9, y: 0, w: 200, h: 100, text: '', color: 'yellow' }).success).toBe(false); });
    it('defaults safe agent capabilities and requires eight-character passwords', () => { expect(AgentCreateSchema.parse({ name: 'Planner', harness: 'custom', scopes: ['boards:read'] }).boardIds).toBe(null); expect(SignupSchema.safeParse({ name: 'A', email: 'a@b.com', password: 'short' }).success).toBe(false); });
    it('validates live resync', () => expect(ServerMsgSchema.parse({ t: 'resync' })).toEqual({ t: 'resync' }));
});
