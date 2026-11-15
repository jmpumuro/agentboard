import { LocalStore, postgresStore } from './db/store';
import { loadProviderConfig } from './config/provider';
import { ensureIntegrationAgent } from './services/test-agent';
import { createApp } from './server';
await loadProviderConfig();
const store = process.env.DATABASE_URL ? await postgresStore(process.env.DATABASE_URL) : await new LocalStore(process.env.DATA_FILE || '.data/workspace.json').init();
if (process.env.BOOTSTRAP_INTEGRATION_AGENT === 'true' && (await store.read()).users.some(u => u.role === 'owner'))
    await ensureIntegrationAgent(store);
const app = createApp(store);
await app.worker.start();
const port = Number(process.env.PORT || 4173);
app.server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`AgentBoard: http://localhost:${port} (${process.env.DATABASE_URL ? 'PostgreSQL' : 'local development storage'})`));
app.server.on('error', async (error) => { console.error('Could not start AgentBoard:', error.message); await app.close(); process.exit(1); });
process.on('SIGTERM', async () => { await app.close(); process.exit(0); });
process.on('SIGINT', async () => { await app.close(); process.exit(0); });
