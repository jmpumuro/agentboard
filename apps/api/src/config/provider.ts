import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
/** Import only provider credentials, never another project's database or runtime settings. */
export async function loadProviderConfig(env: NodeJS.ProcessEnv = process.env) {
    if (env.OPENAI_ENV_FILE) {
        const source = parseEnv(await readFile(resolve(env.OPENAI_ENV_FILE), 'utf8'));
        if (!env.OPENAI_API_KEY && source.OPENAI_API_KEY)
            env.OPENAI_API_KEY = source.OPENAI_API_KEY;
        if (!env.RUN_MODEL && source.OPENAI_MODEL)
            env.RUN_MODEL = source.OPENAI_MODEL;
    }
    return { configured: Boolean(env.OPENAI_API_KEY), model: env.RUN_MODEL || 'gpt-4.1-mini' };
}
