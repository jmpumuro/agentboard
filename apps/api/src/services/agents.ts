import { AgentCreateSchema } from 'contract';
import type { PrivateAgent } from '../db/store';
import { validateUrl } from '../lib/outbound';
import { encrypt } from '../lib/secrets';
import { uid } from './core';
export async function prepareAgent(input: unknown, previous?: PrivateAgent) {
    const parsed = AgentCreateSchema.parse(input);
    const secrets: Record<string, string> = {};
    for (const server of parsed.mcpServers) {
        await validateUrl(server.url);
        if (server.secret)
            secrets[server.url] = encrypt(server.secret);
        else if (server.secret === undefined && previous?.secrets?.[server.url])
            secrets[server.url] = previous.secrets[server.url];
    }
    let webhookSecret = previous?.webhookSecret, once: string | undefined;
    if (parsed.runner.kind === 'webhook') {
        await validateUrl(parsed.runner.url);
        if (previous?.runner.kind !== 'webhook' || previous.runner.url !== parsed.runner.url) {
            once = uid('whsec') + uid('');
            webhookSecret = encrypt(once);
        }
    }
    else
        webhookSecret = undefined;
    return { fields: { ...parsed, mcpServers: parsed.mcpServers.map(({ name, url }) => ({ name, url, hasSecret: Boolean(secrets[url]) })), secrets, webhookSecret }, once };
}
