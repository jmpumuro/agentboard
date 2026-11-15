import { expect, it } from 'vitest';
import { toolSchemas, STARTER_EMBED } from 'contract';
import { modelParameters, parseModelArguments, parseProviderResponse, strictSchema } from '../apps/api/src/services/model-schema';
function check(schema: any) {
    if (!schema || typeof schema !== 'object') return;
    expect(schema).not.toHaveProperty('oneOf'); expect(schema).not.toHaveProperty('exclusiveMinimum'); expect(schema).not.toHaveProperty('prefixItems'); expect(schema).not.toHaveProperty('const');
    if (schema.type === 'object') { expect(schema.additionalProperties).toBe(false); expect(schema.required).toEqual(Object.keys(schema.properties)); }
    for (const child of Object.values(schema)) if (Array.isArray(child)) child.forEach(check); else check(child);
}
it('generates strict schemas for every existing tool, with current-board arguments bound by the server', () => {
    for (const name of Object.keys(toolSchemas) as (keyof typeof toolSchemas)[]) { const schema = modelParameters(name, true); check(schema); if ('boardId' in toolSchemas[name].shape) expect(schema.properties).not.toHaveProperty('boardId'); }
});
it('supplies the current boardId, accepts nullable optional fields, and prevents cross-board injection', () => {
    expect(parseModelArguments('read_board', '{"format":"json","includeHtml":null}', 'board')).toEqual({ boardId: 'board', format: 'json' });
    expect(parseModelArguments('write_board', JSON.stringify({ ops: [{ op: 'create', id: null, data: { ...STARTER_EMBED, prompt: null } }], idempotencyKey: null }), 'board')).toMatchObject({ boardId: 'board', ops: [{ op: 'create', data: STARTER_EMBED }] });
    expect(() => parseModelArguments('read_board', '{"boardId":"another"}', 'board')).toThrow('current board');
});
it('accepts the pen, arrow and version shapes a vague prompt produces, and still rejects a flattened create', () => {
    const drawing = parseModelArguments('write_board', JSON.stringify({ ops: [{ op: 'create', data: { type: 'drawing', x: '40', y: 80, w: 180, h: 180, text: 'Bell', strokes: [[[20, 150], [90, 30], [160, 150], [20, 150]], [{ x: 70, y: 150 }, { x: 110, y: 150 }]] } }] }), 'board') as { ops: any[] };
    expect(drawing.ops[0]).toMatchObject({ op: 'create', data: { type: 'drawing', x: 40, vw: 180, vh: 180, strokes: [[20, 150, 90, 30, 160, 150, 20, 150], [70, 150, 110, 150]] } });
    const arrows = parseModelArguments('write_board', JSON.stringify({ ops: [{ op: 'create', data: { type: 'arrow', from: 'bell', to: 'inbox', label: 'push' } }, { op: 'update', id: 'inbox', ifVersion: 0, data: { text: 'Whoever is listening' } }] }), 'board', { inbox: 2 }) as { ops: any[] };
    expect(arrows.ops[0]).toMatchObject({ data: { type: 'arrow', x: 0, y: 0, from: 'bell', to: 'inbox' } });
    expect(arrows.ops[1]).toMatchObject({ op: 'update', ifVersion: 2 });
    expect(() => parseModelArguments('write_board', JSON.stringify({ ops: [{ op: 'update', id: 'inbox', ifVersion: 1, data: { text: 'stale' } }] }), 'board', { inbox: 4 })).not.toThrow();
    expect((parseModelArguments('write_board', JSON.stringify({ ops: [{ op: 'update', id: 'inbox', ifVersion: 1, data: { text: 'stale' } }] }), 'board', { inbox: 4 }) as { ops: { ifVersion: number }[] }).ops[0].ifVersion).toBe(1);
});
it('drops copied part versions from model writes and keeps a positive element version', () => {
    const earth = { id: 'earth', v: 1, kind: 'sphere', pos: [0, 0, 0], size: [4, 4, 4], color: 'blue', name: 'Earth', info: 'Mass attracts mass.' };
    const apple = { id: 'apple', v: 1, kind: 'sphere', pos: [0, 6, 0], size: [1, 1, 1], color: 'red', name: 'Apple', info: 'The apple accelerates toward Earth.' };
    const parsed = parseModelArguments('write_board', JSON.stringify({ ops: [
        { op: 'update', id: 'model', ifVersion: 1, data: { parts: [earth, apple] } },
        { op: 'part.add', id: 'model', part: { v: 1, kind: 'cone', pos: [0, 3, 0], size: [.4, 2, .4], axis: 'y', color: 'yellow', name: 'Pull', info: 'The pull is stronger when objects are closer.' } },
        { op: 'part.update', id: 'model', partId: 'earth', ifPartVersion: 1, data: { v: 1, info: 'Mass attracts mass.' } }
    ] }), 'board', { model: 4 }) as { ops: any[] };
    expect(parsed.ops[0].ifVersion).toBe(1);
    expect(parsed.ops[0].data.parts.every((part: any) => !('v' in part))).toBe(true);
    expect(parsed.ops[1].part).not.toHaveProperty('v');
    expect(parsed.ops[2].data).toEqual({ info: 'Mass attracts mass.' });
});
it('rejects the reported flattened create with actionable validation details rather than internal errors', () => {
    try { parseModelArguments('write_board', JSON.stringify({ ops: [{ op: 'create', ...STARTER_EMBED }] }), 'board'); throw Error('Accepted invalid op'); }
    catch (error: any) { expect(error.code).toBe('validation_failed'); expect(error.details.hint).toContain('inside data'); expect(error.details.issues.some((i: any) => i.path.includes('ops.0'))).toBe(true); }
    expect(() => parseModelArguments('write_board', '{bad-json', 'board')).toThrow('valid JSON');
});
it('keeps numeric tuples exactly three entries in the provider schema', () => { expect(strictSchema({ type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }, { type: 'number' }], items: false })).toEqual({ type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }); });
it('validates provider envelopes, final responses and truncation before accepting a completion', () => {
    const envelope = (content: string, finish_reason = 'stop') => ({ choices: [{ message: { content }, finish_reason }], usage: { total_tokens: 15 } });
    expect(parseProviderResponse(envelope(JSON.stringify({ outcome: 'completed', reply: 'Added your button.' })))).toEqual({ content: 'Added your button.', outcome: 'completed', tokens: 15 });
    expect(() => parseProviderResponse(envelope('I guess it worked'))).toThrow('structured response');
    expect(() => parseProviderResponse({ choices: [] })).toThrow('invalid response');
    expect(() => parseProviderResponse(envelope('{', 'length'))).toThrow('truncated');
});
it('exposes only writable part definitions, never read-only v metadata, to the model', () => {
    let definitions = 0;
    function inspect(schema: any) {
        if (!schema || typeof schema !== 'object') return;
        if (schema.properties?.kind && schema.properties.pos && schema.properties.size) {
            definitions++; expect(schema.properties).not.toHaveProperty('v'); expect(schema.required ?? []).not.toContain('v');
        }
        for (const value of Object.values(schema)) if (Array.isArray(value)) value.forEach(inspect); else inspect(value);
    }
    inspect(modelParameters('write_board', true)); expect(definitions).toBeGreaterThanOrEqual(3);
});
