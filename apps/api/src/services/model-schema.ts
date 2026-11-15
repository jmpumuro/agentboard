import { z } from 'zod';
import { toolSchemas } from 'contract';
import { fail } from '../lib/errors';
export const AgentReplySchema = z.object({ outcome: z.enum(['completed', 'answer', 'blocked']), reply: z.string().min(1).max(20000) }).strict();
export const ModelTurnSchema = z.object({ content: z.string().nullable().optional(), outcome: z.enum(['completed', 'answer', 'blocked']).optional(), tool_calls: z.array(z.object({ id: z.string().min(1), type: z.literal('function').optional(), function: z.object({ name: z.string().min(1), arguments: z.string() }) } )).min(1).max(20).optional(), tokens: z.number().int().nonnegative().optional() }).refine(turn => !!turn.tool_calls?.length || !!turn.content?.trim(), 'The model must return tool calls or a nonempty reply.');
const EnvelopeSchema = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable().optional(), message: ModelTurnSchema })).min(1), usage: z.object({ total_tokens: z.number().int().nonnegative() }).optional() });
/** Convert the contract's input JSON Schema to OpenAI's strict supported subset.
 * Optional properties are required-but-nullable; homogeneous numeric tuples keep
 * their exact length while using items rather than unsupported prefixItems.
 */
export function strictSchema(schema: any): any {
    if (Array.isArray(schema)) return schema.map(strictSchema);
    if (!schema || typeof schema !== 'object') return schema;
    const result: any = {};
    for (const [key, value] of Object.entries(schema)) {
        if (['$schema', 'default', 'discriminator'].includes(key)) continue;
        if (key === 'const') { result.enum = [value]; continue; }
        if (key === 'oneOf') { result.anyOf = strictSchema(value); continue; }
        if (key === 'exclusiveMinimum') { result.minimum = value; continue; }
        if (key === 'exclusiveMaximum') { result.maximum = value; continue; }
        if (key === 'prefixItems') continue;
        result[key] = strictSchema(value);
    }
    if (schema.prefixItems) {
        result.items = strictSchema(schema.prefixItems[0]);
        result.minItems = schema.prefixItems.length; result.maxItems = schema.prefixItems.length;
    }
    if (result.type === 'object' || result.properties) {
        const required = new Set(schema.required ?? []);
        result.properties ??= {};
        for (const key of Object.keys(result.properties)) if (!required.has(key)) result.properties[key] = { anyOf: [result.properties[key], { type: 'null' }] };
        result.required = Object.keys(result.properties); result.additionalProperties = false;
    }
    return result;
}
/** Read-only part versions belong in read results, never in model mutations.
 * Whole-model replacements already carry the parent ifVersion token. The public
 * API still accepts observed part versions for compatibility with direct clients.
 */
function mutationInput(schema: any): any {
    if (Array.isArray(schema)) return schema.map(mutationInput);
    if (!schema || typeof schema !== 'object') return schema;
    const result = Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, mutationInput(value)])) as any;
    if (result.properties?.v && result.properties.kind && result.properties.pos && result.properties.size) {
        delete result.properties.v;
        if (result.required) result.required = result.required.filter((key: string) => key !== 'v');
        result.description = 'Writable part definition. Keep the ID of an existing part when editing it. New parts may omit ID for server assignment. Never include v: the server owns part versions. Whole-model replacements use the parent ifVersion.';
    }
    return result;
}
export function modelParameters(name: keyof typeof toolSchemas, scoped: boolean) {
    let schema: z.ZodType = toolSchemas[name];
    if (scoped && 'boardId' in toolSchemas[name].shape) schema = (toolSchemas[name] as any).omit({ boardId: true });
    const input = z.toJSONSchema(schema, { io: 'input' });
    return strictSchema(name === 'write_board' ? mutationInput(input) : input);
}
function omitNulls(value: any): any {
    if (Array.isArray(value)) return value.map(omitNulls);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, omitNulls(v)]));
    return value;
}
function finite(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
    return undefined;
}
/** Models copy read-only part versions into writes. The public API still honors v; the model path does not. */
function stripPartVersion(part: any) {
    if (part && typeof part === 'object' && !Array.isArray(part)) delete part.v;
}
/** Models answering a vague request often emit pen points as pairs or objects, one bare polyline, and arrows or edits without the bookkeeping fields. */
function normalizeAmbiguousWrite(input: any, versions?: Record<string, number>) {
    if (!Array.isArray(input?.ops)) return;
    for (const op of input.ops) {
        const version = versions?.[op?.id];
        if ((op?.op === 'update' || op?.op === 'delete') && !(finite(op.ifVersion)! > 0) && version) op.ifVersion = version;
        else if (typeof op?.ifVersion === 'string' && finite(op.ifVersion)! > 0) op.ifVersion = finite(op.ifVersion);
        if (op?.op === 'part.add') stripPartVersion(op.part);
        if (op?.op === 'part.update') stripPartVersion(op.data);
        if (op?.op === 'update' && Array.isArray(op.data?.parts)) op.data.parts.forEach(stripPartVersion);
        const data = op?.data;
        if (!data || typeof data !== 'object') continue;
        for (const key of ['x', 'y', 'w', 'h', 'vw', 'vh']) {
            const number = finite(data[key]);
            if (typeof data[key] === 'string' && number !== undefined) data[key] = number;
        }
        if (data.type === 'drawing' && Array.isArray(data.strokes)) {
            const bare = data.strokes.length > 0 && data.strokes.every((point: unknown) => finite(point) !== undefined);
            data.strokes = (bare ? [data.strokes] : data.strokes).map((stroke: unknown) => {
                if (!Array.isArray(stroke)) return stroke;
                if (stroke.every(point => Array.isArray(point) && finite(point[0]) !== undefined && finite(point[1]) !== undefined))
                    return stroke.flatMap(point => [finite(point[0]), finite(point[1])]);
                if (stroke.every(point => point && typeof point === 'object' && !Array.isArray(point) && finite((point as any).x) !== undefined && finite((point as any).y) !== undefined))
                    return stroke.flatMap(point => [finite((point as any).x), finite((point as any).y)]);
                return stroke.map(point => finite(point) ?? point);
            });
            if (data.vw == null && finite(data.w) !== undefined) data.vw = finite(data.w);
            if (data.vh == null && finite(data.h) !== undefined) data.vh = finite(data.h);
        }
        if (data.type === 'arrow') {
            if (finite(data.x) === undefined) data.x = 0;
            if (finite(data.y) === undefined) data.y = 0;
        }
        if (data.type === 'scene3d' && Array.isArray(data.parts)) data.parts.forEach(stripPartVersion);
    }
}
export function parseModelArguments(name: keyof typeof toolSchemas, json: string, boardId: string, versions?: Record<string, number>) {
    let input: any;
    try { input = JSON.parse(json); } catch { fail('validation_failed', 'Tool arguments must be valid JSON.', { tool: name }); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('validation_failed', 'Tool arguments must be a JSON object.', { tool: name });
    input = omitNulls(input);
    if ('boardId' in toolSchemas[name].shape) {
        if (input.boardId !== undefined && input.boardId !== boardId) fail('forbidden', 'A run can only access its current board.');
        input.boardId = boardId;
    }
    if (name === 'write_board') normalizeAmbiguousWrite(input, versions);
    const parsed = toolSchemas[name].safeParse(input);
    if (!parsed.success) fail('validation_failed', 'Tool arguments do not match the shared board contract.', {
        tool: name, issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), code: i.code, message: i.message })),
        ...(name === 'write_board' ? { hint: 'Each create operation is {op:"create",data:{type,...element fields}}. Put element fields inside data. Updates require id, ifVersion and data; part updates require id, partId, ifPartVersion and data. Do not flatten element fields onto an operation.' } : {})
    });
    return parsed.data;
}
export function parseProviderResponse(input: unknown) {
    const envelope = EnvelopeSchema.safeParse(input);
    if (!envelope.success) fail('validation_failed', 'The model provider returned an invalid response.', { issues: envelope.error.issues.map(i => ({ path: i.path.join('.'), code: i.code })) });
    const choice = envelope.data.choices[0], message = choice.message;
    if (choice.finish_reason === 'length') fail('limit_exceeded', 'The model response was truncated. Increase RUN_MAX_COMPLETION_TOKENS or simplify the request.');
    if (message.tool_calls?.length) return { ...message, tokens: envelope.data.usage?.total_tokens ?? 0 };
    let final: unknown;
    try { final = JSON.parse(message.content || ''); } catch { fail('validation_failed', 'The model reply did not match the structured response schema.'); }
    const reply = AgentReplySchema.safeParse(final);
    if (!reply.success) fail('validation_failed', 'The model reply did not match the structured response schema.');
    return { content: reply.data.reply, outcome: reply.data.outcome, tokens: envelope.data.usage?.total_tokens ?? 0 };
}
