import { LocalStore, postgresStore } from '../apps/api/src/db/store';
import { ensureIntegrationAgent } from '../apps/api/src/services/test-agent';
import { loadProviderConfig } from '../apps/api/src/config/provider';
await loadProviderConfig();
const store = process.env.DATABASE_URL ? await postgresStore(process.env.DATABASE_URL) : await new LocalStore(process.env.DATA_FILE || '.data/workspace.json').init();
try {
    const result = await ensureIntegrationAgent(store);
    console.log(JSON.stringify({ name: result.agent.name, boardId: result.boardId, created: result.created, providerConfigured: Boolean(process.env.OPENAI_API_KEY) }));
}
finally {
    await store.close();
}
