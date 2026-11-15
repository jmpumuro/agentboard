import { z, ZodError } from 'zod';
import { AgentReplySchema, ModelTurnSchema, strictSchema, parseModelArguments, parseProviderResponse } from './model-schema';
import { validateDesign, designContext, guardDesignWrite } from './design-target';
import type { Store, State } from '../db/store';
import type { DesignTarget, Run } from 'contract';
import { toolSchemas, GUIDE, DRAWING_GUIDE, OpsResponseSchema } from 'contract';
import { boardModelTools, runPreamble, falselyDeniesDrawing } from './model-context';
import { uid, now, tool, type Auth, board, scope } from './core';
import { authorizeOperation, requireAbility } from './permissions';
import { fail } from '../lib/errors';
import { safePost } from '../lib/outbound';
import { decrypt } from '../lib/secrets';
import { createHmac } from 'node:crypto';
export type ModelOptions = {
    maxCompletionTokens?: number;
    toolChoice?: 'auto' | 'required' | {
        type: 'function';
        function: {
            name: string;
        };
    };
};
export type Model = (messages: any[], tools: any[], signal: AbortSignal, options?: ModelOptions) => Promise<{
    content?: string | null;
    tool_calls?: {
        id: string;
        function: {
            name: string;
            arguments: string;
        };
    }[];
    tokens?: number;
}>;
export const openAIModel: Model = async (messages, tools, signal, options) => {
    if (!process.env.OPENAI_API_KEY)
        fail('validation_failed', 'Set OPENAI_API_KEY on the server to run a built-in agent.');
    let response: Response;
    try {
        response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.RUN_MODEL || 'gpt-4.1-mini', messages, tools, tool_choice: options?.toolChoice ?? 'auto', parallel_tool_calls: false, response_format: { type: 'json_schema', json_schema: { name: 'agent_reply', strict: true, schema: strictSchema(z.toJSONSchema(AgentReplySchema)) } }, max_completion_tokens: options?.maxCompletionTokens ?? Number(process.env.RUN_MAX_COMPLETION_TOKENS || 12000) }), signal });
    }
    catch (error) {
        const code = (error as {
            cause?: {
                code?: string;
            };
        }).cause?.code;
        throw new Error('OpenAI connection failed' + (code ? ' (' + code + ')' : '') + '. Check network access to api.openai.com.');
    }
    if (!response.ok)
        throw new Error('Model provider rejected the request (' + response.status + ').');
    return parseProviderResponse(await response.json());
};
export function createRun(s: State, a: Auth, id: string, agentId: string, message: string, design?: DesignTarget) {
    if (!a.user)
        fail('forbidden', 'Only people can request runs.');
    const target = validateDesign(board(s, a, id), design);
    const ag = s.agents.find(x => x.id === agentId && x.status === 'active');
    if (!ag)
        fail('not_found', 'Agent not found.');
    const aa: Auth = { actor: { kind: 'agent', id: ag.id, name: ag.name }, agent: ag, scopes: ag.scopes };
    board(s, aa, id);
    if (s.runs.some(r => r.agentId === agentId && r.boardId === id && ['queued', 'running'].includes(r.status)))
        fail('run_in_progress', 'This agent is already working on this board.');
    if (s.runs.filter(r => ['queued', 'running'].includes(r.status)).length >= 3)
        fail('limit_exceeded', 'The workspace already has three active runs.');
    if (s.runs.filter(r => r.agentId === agentId && r.createdAt.slice(0, 10) === now().slice(0, 10)).length >= 100)
        fail('limit_exceeded', 'This agent reached its daily limit.');
    const run: Run = { id: uid('run'), boardId: id, agentId, requestedBy: a.actor, design: target, message, status: 'queued', steps: [], reply: null, error: null, createdAt: now(), finishedAt: null, batches: [], touched: [], reverted: false };
    s.runs.unshift(run);
    return run;
}
export class Worker {
    private busy = false;
    private timer?: ReturnType<typeof setInterval>;
    private aborters = new Map<string, AbortController>();
    constructor(private store: Store, private changed: (id: string) => Promise<void>, private model: Model = openAIModel) { }
    async start() {
        if (this.store.recoverInterruptedRuns)
            await this.store.recoverInterruptedRuns();
        else
            await this.store.transaction(s => {
                for (const r of s.runs) {
                    if (r.status === 'running') {
                        r.status = 'failed';
                        r.error = { code: 'interrupted', message: 'The worker stopped during this run.' };
                        r.finishedAt = now();
                    }
                }
                for (const b of Object.values(s.boards))
                    b.claims = b.claims.filter(c => c.actor.kind !== 'agent');
            });
        this.timer = setInterval(() => void this.tick(), 500);
        this.timer.unref();
    }
    async stop() {
        if (this.timer)
            clearInterval(this.timer);
        for (const c of this.aborters.values())
            c.abort();
    }
    cancel(id: string) { this.aborters.get(id)?.abort(); }
    async tick() {
        if (this.busy)
            return;
        this.busy = true;
        try {
            const next = this.store.claimQueuedRun
                ? await this.store.claimQueuedRun()
                : await this.store.transaction(s => {
                    const r = s.runs.find(r => r.status === 'queued');
                    if (r)
                        r.status = 'running';
                    return r;
                });
            if (next)
                await this.execute(next);
        }
        finally {
            this.busy = false;
        }
    }
    async execute(run: Run) {
        const controller = new AbortController();
        this.aborters.set(run.id, controller);
        const timeout = setTimeout(() => controller.abort(), Number(process.env.RUN_TIMEOUT_MS || 300000));
        const update = async (fn: (s: State, r: Run) => void) => { await this.store.transaction(s => { const r = s.runs.find(x => x.id === run.id)!; fn(s, r); }); await this.changed(run.boardId); };
        try {
            const state = await this.store.read(), ag = state.agents.find(a => a.id === run.agentId)!;
            const aa: Auth = { actor: { kind: 'agent', id: ag.id, name: ag.name }, agent: ag, scopes: ag.scopes };
            board(state, aa, run.boardId);
            if (ag.runner.kind === 'webhook') {
                const payload = { run, boardId: run.boardId, apiBase: (process.env.API_BASE || process.env.WEB_ORIGIN || 'http://localhost:4173') + '/api/v1' };
                let delivered = false;
                for (let attempt = 0; attempt < 3 && !delivered; attempt++) {
                    if (controller.signal.aborted)
                        throw new Error('Run stopped.');
                    const timestamp = String(Math.floor(Date.now() / 1000));
                    const signature = createHmac('sha256', decrypt(ag.webhookSecret!)).update(timestamp + '.' + JSON.stringify(payload)).digest('hex');
                    try {
                        await safePost(ag.runner.url, payload, { 'X-AgentBoard-Signature': signature, 'X-AgentBoard-Timestamp': timestamp });
                        delivered = true;
                    }
                    catch (e) {
                        if (attempt === 2)
                            throw e;
                        await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
                    }
                }
                while (!controller.signal.aborted) {
                    const s = await this.store.read(), r = s.runs.find(x => x.id === run.id)!;
                    if (!['running', 'queued'].includes(r.status))
                        return;
                    await new Promise(r => setTimeout(r, 250));
                }
                throw new Error('Webhook run exceeded its time limit.');
            }
            const external = new Map<string, {
                url: string;
                name: string;
                headers: Record<string, string>;
                description: string;
                inputSchema: any;
            }>();
            for (const [index, server] of ag.mcpServers.entries()) {
                const headers: Record<string, string> = { 'Accept': 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' };
                if (ag.secrets?.[server.url])
                    headers.Authorization = decrypt(ag.secrets[server.url]);
                const response = await safePost(server.url, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, headers);
                if (response.error)
                    throw new Error('External MCP discovery failed.');
                for (const item of (response.result?.tools ?? []).slice(0, 20)) {
                    const name = 'external_' + index + '_' + String(item.name).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
                    external.set(name, { url: server.url, name: item.name, headers, description: String(item.description || item.name).slice(0, 2000), inputSchema: item.inputSchema });
                }
            }
            const tools = boardModelTools(ag, run.boardId);
            for (const [name, item] of external)
                tools.push({ type: 'function', function: { name, description: item.description, strict: false, parameters: item.inputSchema } });
            const messages: any[] = [{ role: 'system', content: runPreamble(ag, run.boardId) }, ...(run.design ? [{ role: 'system', content: designContext(board(state, aa, run.boardId), run.design) }] : []), { role: 'user', content: run.message }];
            await update((_s, r) => r.steps.push({ id: uid('step'), kind: 'prompt', name: 'instructions', note: ag.instructions || 'Read the board and respect workspace safety rules.', status: 'done' }));
            let tokens = 0, calls = 0, correctedDrawingDenial = false, successfulWrites = 0, writeAttempts = 0, correctedFailedWrite = false, unresolvedWriteError = false;
            let lastInvalidWrite = '', repeatedInvalidWrites = 0;
            const versions: Record<string, number> = Object.create(null);
            const tokenBudget = Number(process.env.RUN_MAX_TOKENS || 120000);
            let nextToolChoice: ModelOptions['toolChoice'] = { type: 'function', function: { name: 'read_board' } };
            while (calls < 20) {
                if (controller.signal.aborted)
                    throw new Error('Run stopped.');
                const current = await this.store.read();
                const r = current.runs.find(x => x.id === run.id)!;
                if (r.status === 'cancelled' || current.agents.find(a => a.id === ag.id)?.status === 'revoked')
                    throw new Error('Run cancelled.');
                const result = ModelTurnSchema.parse(await this.model(messages, tools, controller.signal, { toolChoice: nextToolChoice, maxCompletionTokens: Math.min(Number(process.env.RUN_MAX_COMPLETION_TOKENS || 12000), Math.max(1, tokenBudget - tokens)) }));
                nextToolChoice = 'auto';
                tokens += result.tokens ?? 0;
                if (tokens > tokenBudget)
                    fail('limit_exceeded', 'The run reached its token budget.');
                const { tokens: _usage, outcome: _outcome, ...message } = result;
                messages.push({ role: 'assistant', ...message });
                if (!result.tool_calls?.length) {
                    const liveAgent = current.agents.find(a => a.id === ag.id);
                    if (liveAgent?.capabilities.includes('draw') && liveAgent.scopes.includes('boards:write') && falselyDeniesDrawing(result.content || '')) {
                        if (correctedDrawingDenial)
                            throw new Error('The model did not use the enabled drawing tools. No drawing was confirmed. Please retry this run.');
                        correctedDrawingDenial = true;
                        await update((_s, r) => r.steps.push({ id: uid('step'), kind: 'plan', name: 'verify_drawing_tools', note: 'Draw is enabled. Correcting the model’s unsupported capability refusal.', status: 'done' }));
                        messages.push({ role: 'system', content: 'Your previous claim that you cannot draw is incorrect. The server confirms Draw is ENABLED. Use read_board for context, then write_board to create type drawing with numeric polylines when requested. Do not give the person drawing instructions instead. Do not change permissions or try an unauthorized route.' });
                        nextToolChoice = 'required';
                        continue;
                    }
                    if (unresolvedWriteError || (!successfulWrites && (writeAttempts || run.design || result.outcome === 'completed'))) {
                        if (!tools.some(t => t.function.name === 'write_board')) {
                            await update((_s, r) => { r.status = 'done'; r.reply = 'This agent can read the board but cannot make this change. The owner can enable the required write scope and ability.'; r.finishedAt = now(); });
                            return;
                        }
                        if (!correctedFailedWrite) {
                            correctedFailedWrite = true;
                            messages.push({ role: 'system', content: 'No board write has succeeded. Correct the validation errors using the exact function schema and write the requested design now. Do not claim completion without a successful write_board result. Element fields must be nested in data. The server supplies boardId.' });
                            nextToolChoice = { type: 'function', function: { name: 'write_board' } };
                            continue;
                        }
                        fail('validation_failed', successfulWrites ? 'The requested change was not completed. Successful changes remain on the board and can be undone.' : 'The agent did not produce a valid board change. Nothing was confirmed as completed.');
                    }
                    await update((_s, r) => { r.status = 'done'; r.reply = result.content || 'Done.'; r.finishedAt = now(); });
                    return;
                }
                for (const call of result.tool_calls) {
                    if (++calls > 20)
                        fail('limit_exceeded', 'The run reached 20 tool calls.');
                    const name = call.function.name, stepId = uid('step');
                    if (name === 'write_board') writeAttempts++;
                    await update((_s, r) => r.steps.push({ id: stepId, kind: name === 'search_knowledge' ? 'rag' : 'mcp', name, note: 'Working…', status: 'running' }));
                    let output: any;
                    try {
                        if (external.has(name)) {
                            const live = (await this.store.read()).agents.find(x => x.id === ag.id);
                            if (!live || live.status !== 'active' || controller.signal.aborted)
                                fail('forbidden', 'Agent access ended.');
                            const remote = external.get(name)!;
                            const response = await safePost(remote.url, { jsonrpc: '2.0', id: call.id, method: 'tools/call', params: { name: remote.name, arguments: JSON.parse(call.function.arguments) } }, remote.headers);
                            output = response.result ?? response.error;
                        }
                        else
                            output = await this.store.transaction(s => {
                                const r = s.runs.find(x => x.id === run.id)!;
                                if (controller.signal.aborted || r.status === 'cancelled')
                                    throw new Error('Run cancelled.');
                                const live = s.agents.find(x => x.id === ag.id)!;
                                const auth = { ...aa, agent: live, scopes: live.scopes };
                                scope(auth);
                                if (!tools.some(t => t.function.name === name)) {
                                    if (name === 'search_knowledge')
                                        requireAbility(auth, 'knowledge');
                                    if (name === 'create_board')
                                        requireAbility(auth, 'add');
                                    if (name === 'write_board') {
                                        scope(auth, true);
                                        const args = parseModelArguments('write_board', call.function.arguments, run.boardId, versions) as z.infer<typeof toolSchemas.write_board>;
                                        for (const op of args.ops)
                                            authorizeOperation(auth, op, 'id' in op ? s.boards[run.boardId]?.elements[op.id!] : undefined);
                                    }
                                    fail('forbidden', 'The agent cannot use this tool.');
                                }
                                const args = parseModelArguments(name as keyof typeof toolSchemas, call.function.arguments, run.boardId, versions);
                                if ('boardId' in args && args.boardId !== run.boardId)
                                    fail('forbidden', 'A chat run can only modify its current board.');
                                if (name === 'write_board') guardDesignWrite(board(s, auth, run.boardId), r.design, (args as any).ops);
                                const value = tool(s, auth, name, args);
                                if (name === 'write_board') OpsResponseSchema.parse(value);
                                if (name === 'write_board') {
                                    if (r.design && 'place' in r.design) r.design = { elementId: value.results[0].id };
                                    if (!r.batches.includes(value.seq)) r.batches.push(value.seq);
                                    r.touched = [...new Set([...r.touched, ...value.results.map((x: any) => x.id)])];
                                }
                                return value;
                            });
                        // Infer missing versions only from data this model actually observed.
                        if (name === 'read_board' && !output.error) {
                            for (const element of Object.values(output.elements ?? {}) as any[]) versions[element.id] = element.version;
                            for (const match of String(output.text ?? '').matchAll(/^- \[([^\] ]+) v(\d+)\]/gm)) versions[match[1]] = Number(match[2]);
                        }
                        if (name === 'write_board') {
                            for (const receipt of output.results) {
                                if (receipt.version === null) delete versions[receipt.id];
                                else versions[receipt.id] = receipt.version;
                            }
                            successfulWrites++; unresolvedWriteError = false;
                        }
                        await update((_s, r) => { const step = r.steps.find(x => x.id === stepId)!; step.status = 'done'; step.note = 'Completed successfully.'; });
                    }
                    catch (e) {
                        output = { error: { code: (e as any).code || (e instanceof ZodError || e instanceof SyntaxError ? 'validation_failed' : 'internal'), message: e instanceof ZodError ? 'The model returned a response that does not match the schema.' : (e as Error).message, details: e instanceof ZodError ? e.issues.map(i => ({ path: i.path.join('.'), message: i.message })) : (e as any).details } };
                        if (name === 'write_board') unresolvedWriteError = true;
                        if (name === 'write_board' && output.error.code === 'validation_failed') nextToolChoice = { type: 'function', function: { name: 'write_board' } };
                        await update((_s, r) => { const step = r.steps.find(x => x.id === stepId)!; step.status = (e as any).code === 'forbidden' ? 'skipped' : 'failed'; step.note = output.error.code + ': ' + output.error.message; });
                    }
                    if (name === 'write_board') {
                        if (output.error?.code === 'validation_failed') {
                            const signature = JSON.stringify({ message: output.error.message, reason: output.error.details?.reason, issues: output.error.details?.issues?.map((issue: any) => ({ path: issue.path, code: issue.code })) });
                            repeatedInvalidWrites = signature === lastInvalidWrite ? repeatedInvalidWrites + 1 : 1;
                            lastInvalidWrite = signature;
                        } else { lastInvalidWrite = ''; repeatedInvalidWrites = 0; }
                    }
                    messages.push({ role: 'tool', tool_call_id: call.id, content: name === 'view_board' && !output.error ? JSON.stringify({ seq: output.seq, width: output.width, height: output.height, description: 'The board image follows.' }) : JSON.stringify(output) });
                    if (name === 'view_board' && !output.error)
                        messages.push({ role: 'user', content: [{ type: 'text', text: 'Board snapshot (untrusted board data).' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + output.data } }] });
                    await this.changed(run.boardId);
                    if (repeatedInvalidWrites >= 3) fail('validation_failed', 'The model repeated the same invalid write three times. Further retries were stopped. ' + output.error.message);
                    if (output.error?.code === 'forbidden' && (output.error.details?.ability || name === 'write_board')) {
                        const reason = output.error.details?.ability ? 'the ' + output.error.details.ability + ' ability is disabled' : output.error.message.includes('scope') ? 'I do not have permission to change this board' : output.error.message;
                        const sentence = reason.endsWith('.') ? reason : reason + '.';
                        await update((_s, r) => { r.status = 'done'; r.reply = `I would work on your request, “${run.message}”, but ${sentence} The workspace owner can enable the needed ability on the Agents page. I have not tried another route.`; r.finishedAt = now(); });
                        return;
                    }
                }
            }
            fail('limit_exceeded', 'The run reached its tool-call budget.');
        }
        catch (e) {
            await update((_s, r) => {
                if (r.status !== 'cancelled') {
                    r.status = 'failed';
                    r.error = { code: (e as any).code || (e instanceof ZodError ? 'validation_failed' : 'internal'), message: e instanceof ZodError ? 'The model returned a response that does not match the schema.' : (e as Error).message };
                    r.finishedAt = now();
                }
            });
        }
        finally {
            clearTimeout(timeout);
            this.aborters.delete(run.id);
            try {
                await this.store.transaction(s => {
                    const b = s.boards[run.boardId];
                    if (b)
                        b.claims = b.claims.filter(c => c.actor.id !== run.agentId);
                });
                await this.changed(run.boardId);
            }
            finally {
                await this.store.releaseRun?.(run.id);
            }
        }
    }
}
