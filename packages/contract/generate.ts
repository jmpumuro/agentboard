import { z } from 'zod';
import * as c from './src/index';
import { operationResponses } from './operation-responses';
import { writeFileSync } from 'node:fs';
const schemas = Object.fromEntries(Object.entries(c).filter(([k, v]) => k.endsWith('Schema') && v instanceof z.ZodType).map(([k, v]) => [k.replace(/Schema$/, ''), z.toJSONSchema(v as z.ZodType, { unrepresentable: 'any', io: 'input' })]));
// Success statuses and envelopes come from operation-responses.ts, which records
// what the server returns. Error bodies stay on the Error schema; numeric error
// codes stay in statusCodes.
const paths: Record<string, any> = {};
const seen = new Set<string>();
for (const [method, path, request, response] of c.restEndpoints) {
    const key = method + ' ' + path;
    const spec = operationResponses[key];
    if (!spec)
        throw new Error('Missing success response for ' + key);
    if (spec.status === 204 && spec.body)
        throw new Error(key + ' is 204 and must not declare a JSON body');
    if (spec.status !== 204 && !spec.body)
        throw new Error(key + ' must declare a response body');
    if (response && spec.body?.media === 'application/json' && !JSON.stringify(spec.body.schema).includes('#/components/schemas/' + response))
        throw new Error(key + ' envelope does not reference ' + response);
    seen.add(key);
    const entry = paths[path] ??= {};
    const success: Record<string, unknown> = { description: spec.status === 204 ? 'No content' : 'Success' };
    if (spec.body)
        success.content = { [spec.body.media]: { schema: spec.body.schema } };
    entry[method] = { summary: method.toUpperCase() + ' ' + path, security: path.startsWith('/auth/') ? [] : [{ cookieAuth: [] }, { bearerAuth: [] }], parameters: [...path.matchAll(/\{(\w+)\}/g)].map(m => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } })), ...(request ? { requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/' + request } } } } } : {}), responses: { [String(spec.status)]: success, default: { description: 'Contract error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } } };
}
for (const key of Object.keys(operationResponses))
    if (!seen.has(key))
        throw new Error('operationResponses lists an endpoint that is not in restEndpoints: ' + key);
writeFileSync(new URL('./openapi.yaml', import.meta.url), JSON.stringify({ openapi: '3.1.0', info: { title: 'AgentBoard (response envelopes match implemented routes)', version: '0.1.0' }, servers: [{ url: '/api/v1' }], paths, components: { schemas, securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'ab_session' }, bearerAuth: { type: 'http', scheme: 'bearer' } } } }, null, 2) + '\n');
