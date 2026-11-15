// Success status and JSON envelope for each restEndpoints operation.
// Kept beside the tuple so callers that read [method, path, request, response]
// keep the same positions. Names inside $ref match the tuple's response schema
// when that tuple entry exists. Fields are only those the server sends.

type Json = Record<string, unknown>;
export type OperationSuccess = {
    status: 200 | 201 | 202 | 204;
    body?: { media: 'application/json' | 'text/html' | 'image/png'; schema: Json };
};

const ref = (name: string) => ({ $ref: '#/components/schemas/' + name });
const json = (schema: Json): NonNullable<OperationSuccess['body']> => ({ media: 'application/json', schema });
const html: NonNullable<OperationSuccess['body']> = { media: 'text/html', schema: { type: 'string' } };
const png: NonNullable<OperationSuccess['body']> = { media: 'image/png', schema: { type: 'string', format: 'binary' } };

/** `{ items: T[] }` — claims, agents, knowledge, and passage search. */
function itemsOf(name: string): Json {
    return { type: 'object', properties: { items: { type: 'array', items: ref(name) } }, required: ['items'] };
}
/** `page()` result: `{ items, nextCursor }` with nextCursor null on the last page. */
function pageOf(name: string): Json {
    return { type: 'object', properties: { items: { type: 'array', items: ref(name) }, nextCursor: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['items', 'nextCursor'] };
}

const object = (name: string) => json(ref(name));

export const operationResponses: Record<string, OperationSuccess> = {
    'post /auth/signup': { status: 201, body: object('User') },
    'post /auth/login': { status: 200, body: object('User') },
    'post /auth/logout': { status: 204 },
    'get /me': { status: 200, body: json({ type: 'object', properties: { actor: ref('Actor'), scopes: { type: 'array', items: ref('Scope') }, user: ref('User') }, required: ['actor', 'scopes'] }) },
    'post /auth/invites': { status: 201, body: json({ type: 'object', properties: { inviteUrl: { type: 'string' } }, required: ['inviteUrl'] }) },
    'get /members': { status: 200, body: json({ type: 'array', items: ref('User') }) },
    'patch /members/{id}': { status: 200, body: object('User') },
    'delete /members/{id}': { status: 204 },
    'get /boards': { status: 200, body: json(pageOf('Board')) },
    'post /boards': { status: 201, body: object('Board') },
    'get /boards/{id}': { status: 200, body: object('Board') },
    'patch /boards/{id}': { status: 200, body: object('Board') },
    'delete /boards/{id}': { status: 204 },
    'post /boards/{id}/restore': { status: 200, body: object('Board') },
    'get /boards/{id}/elements': { status: 200, body: json({ type: 'object', properties: { seq: { type: 'integer' }, order: { type: 'array', items: { type: 'string' } }, elements: { type: 'array', items: ref('Element') } }, required: ['seq', 'order', 'elements'] }) },
    'post /boards/{id}/ops': { status: 200, body: object('OpsResponse') },
    'get /boards/{id}/digest': { status: 200, body: json({ type: 'object', properties: { seq: { type: 'integer' }, text: { type: 'string' } }, required: ['seq', 'text'] }) },
    'get /boards/{id}/view': { status: 200, body: png },
    'get /boards/{id}/embeds/{elementId}/frame': { status: 200, body: html },
    'get /boards/{id}/scenes/{elementId}/frame': { status: 200, body: png },
    'get /boards/{id}/claims': { status: 200, body: json(itemsOf('Claim')) },
    'post /boards/{id}/claims': { status: 201, body: object('Claim') },
    'post /boards/{id}/claims/{claimId}/renew': { status: 201, body: object('Claim') },
    'delete /boards/{id}/claims/{claimId}': { status: 204 },
    'post /boards/{id}/batches/{seq}/revert': { status: 200, body: object('OpsResponse') },
    'get /activity': { status: 200, body: json(pageOf('Activity')) },
    'get /agents': { status: 200, body: json(itemsOf('Agent')) },
    'post /agents': { status: 201, body: json({ type: 'object', properties: { agent: ref('Agent'), key: { type: 'string' }, webhookSecret: { type: 'string' } }, required: ['agent', 'key'] }) },
    'patch /agents/{id}': { status: 200, body: json({ oneOf: [ref('Agent'), { type: 'object', properties: { agent: ref('Agent'), webhookSecret: { type: 'string' } }, required: ['agent', 'webhookSecret'] }] }) },
    'delete /agents/{id}': { status: 204 },
    'post /agents/{id}/rotate-key': { status: 200, body: json({ type: 'object', properties: { agent: ref('Agent'), key: { type: 'string' } }, required: ['agent', 'key'] }) },
    'get /knowledge': { status: 200, body: json(itemsOf('Knowledge')) },
    'post /knowledge': { status: 201, body: object('Knowledge') },
    'delete /knowledge/{id}': { status: 204 },
    'get /knowledge/search': { status: 200, body: json(itemsOf('Passage')) },
    'post /boards/{id}/runs': { status: 202, body: object('Run') },
    'get /boards/{id}/runs': { status: 200, body: json(pageOf('Run')) },
    'get /runs/{runId}': { status: 200, body: object('Run') },
    'post /runs/{runId}/cancel': { status: 200, body: object('Run') },
    'post /runs/{runId}/revert': { status: 200, body: object('Run') },
    'post /runs/{runId}/steps': { status: 200, body: object('RunStep') },
    'post /runs/{runId}/finish': { status: 200, body: object('Run') },
    'get /settings': { status: 200, body: object('Settings') },
    'patch /settings': { status: 200, body: object('Settings') }
};
