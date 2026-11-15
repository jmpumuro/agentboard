import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
const MIME: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };
export async function staticWeb(url: string, directory = 'dist') {
    const root = resolve(directory);
    try {
        const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
        const path = resolve(root, '.' + pathname);
        if (!path.startsWith(root + '/') && path !== root) throw Error('Outside web root');
        const asset = pathname.startsWith('/assets/') || !!extname(pathname);
        const file = asset ? path : resolve(root, 'index.html');
        try {
            return { status: 200, body: await readFile(file), headers: { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store', 'X-Content-Type-Options': 'nosniff' } };
        } catch { return { status: 404, body: Buffer.from(asset ? 'Asset not found. Refresh the app to load the latest build.' : 'Build the web app first: npm run build'), headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }; }
    } catch { return { status: 404, body: Buffer.from('Not found'), headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }; }
}
