import { build } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { publishWeb } from './publish-web';
const stage = await mkdtemp(resolve('.web-build-'));
try {
    await build({ configFile: 'apps/web/vite.config.ts', build: { outDir: stage, emptyOutDir: true } });
    // Preserve current assets on the first adoption of the build history.
    const { readdir, writeFile, access } = await import('node:fs/promises');
    try { await access('dist/.build-history.json'); } catch {
        try { await writeFile('dist/.build-history.json', JSON.stringify([await readdir('dist/assets')])); } catch {}
    }
    await publishWeb(stage, resolve('dist'));
} finally { await rm(stage, { recursive: true, force: true }); }
