import { it, expect, vi, afterEach } from 'vitest';
import { openAIModel } from '../apps/api/src/services/runner';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('executes provider tool calls with server credentials and returns usage', async () => { vi.stubEnv('OPENAI_API_KEY', 'test-only-placeholder'); vi.stubEnv('RUN_MODEL', 'test-model'); const call = { id: 'call1', function: { name: 'read_board', arguments: '{"boardId":"board"}' } }; const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: null, tool_calls: [call] } }], usage: { total_tokens: 42 } }) })); vi.stubGlobal('fetch', fetch); const result = await openAIModel([{ role: 'user', content: 'Read the board' }], [], new AbortController().signal, { toolChoice: { type: 'function', function: { name: 'read_board' } } }); expect(result.tool_calls).toEqual([call]); expect(result.tokens).toBe(42); const args = (fetch.mock.calls[0] as unknown as [
    string,
    RequestInit
]); expect(args[0]).toBe('https://api.openai.com/v1/chat/completions'); expect(JSON.parse(String(args[1].body)).model).toBe('test-model'); expect(JSON.parse(String(args[1].body)).tool_choice).toEqual({ type: 'function', function: { name: 'read_board' } }); expect((args[1].headers as Record<string, string>).Authorization).toBe('Bearer test-only-placeholder'); });
it('reports network failures without exposing credentials', async () => { vi.stubEnv('OPENAI_API_KEY', 'test-only-placeholder'); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }))); await expect(openAIModel([], [], new AbortController().signal)).rejects.toThrow('ENOTFOUND'); try {
    await openAIModel([], [], new AbortController().signal);
}
catch (error) {
    expect((error as Error).message).not.toContain('test-only-placeholder');
} });
