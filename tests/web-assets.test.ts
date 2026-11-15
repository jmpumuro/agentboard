import { it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staticWeb } from '../apps/api/src/lib/static-web';
import { publishWeb } from '../scripts/publish-web';
import { recoverModule } from '../apps/web/src/module-recovery';
it('serves real JavaScript and never substitutes HTML for a missing lazy chunk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentboard-assets-'));
    try {
        await mkdir(join(dir, 'assets')); await writeFile(join(dir, 'index.html'), '<html>App</html>'); await writeFile(join(dir, 'assets/view-abc.js'), 'export default 1;');
        expect((await staticWeb('/boards/a', dir)).body.toString()).toBe('<html>App</html>');
        const js = await staticWeb('/assets/view-abc.js', dir); expect(js.status).toBe(200); expect(js.headers['Content-Type']).toContain('javascript');
        const missing = await staticWeb('/assets/Scene3DView-old.js', dir); expect(missing.status).toBe(404); expect(missing.headers['Content-Type']).not.toContain('html'); expect(missing.body.toString()).not.toContain('<html>');
        expect((await staticWeb('/assets/%2e%2e/%2e%2e/secret.js', dir)).status).toBe(404);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
it('publishes assets before the new index and retains old chunks for open tabs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentboard-builds-'));
    try {
        const destination = join(dir, 'dist');
        for (let i = 0; i < 2; i++) {
            const stage = join(dir, 'stage' + i); await mkdir(join(stage, 'assets'), { recursive: true }); await writeFile(join(stage, 'assets/view-' + i + '.js'), 'export default ' + i); await writeFile(join(stage, 'index.html'), 'build ' + i); await publishWeb(stage, destination);
        }
        expect(await readFile(join(destination, 'index.html'), 'utf8')).toBe('build 1');
        expect((await staticWeb('/assets/view-0.js', destination)).status).toBe(200);
        expect((await staticWeb('/assets/view-1.js', destination)).status).toBe(200);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
it('recovers a stale module with one reload and prevents reload loops', () => {
    const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; let reloads = 0;
    const first = new Event('vite:preloadError', { cancelable: true }); expect(recoverModule(first, storage, () => reloads++, 100000)).toBe(true); expect(first.defaultPrevented).toBe(true);
    expect(recoverModule(new Event('vite:preloadError'), storage, () => reloads++, 100001)).toBe(false); expect(reloads).toBe(1);
});
