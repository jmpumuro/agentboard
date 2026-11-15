import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
/** Publish assets before HTML, retaining the last five builds for open tabs. */
export async function publishWeb(stage: string, destination: string) {
    await mkdir(join(destination, 'assets'), { recursive: true });
    const assets = await readdir(join(stage, 'assets'));
    await cp(join(stage, 'assets'), join(destination, 'assets'), { recursive: true });
    for (const entry of await readdir(stage)) if (!['assets', 'index.html'].includes(entry)) await cp(join(stage, entry), join(destination, entry), { recursive: true });
    let history: string[][] = [];
    try { history = JSON.parse(await readFile(join(destination, '.build-history.json'), 'utf8')); } catch {}
    history = [assets, ...history].slice(0, 5);
    await writeFile(join(destination, '.build-history.json'), JSON.stringify(history));
    const html = await readFile(join(stage, 'index.html'));
    await writeFile(join(destination, '.index.next.html'), html);
    await rename(join(destination, '.index.next.html'), join(destination, 'index.html'));
    const keep = new Set(history.flat());
    for (const file of await readdir(join(destination, 'assets'))) if (!keep.has(file)) await rm(join(destination, 'assets', file), { force: true });
}
