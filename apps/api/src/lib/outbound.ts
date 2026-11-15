import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import { fail } from './errors';
export function publicAddress(address: string) {
    if (isIP(address) === 4) {
        const [a, b, c] = address.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) || a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19));
    }
    if (isIP(address) === 6)
        return /^[23][0-9a-f]{3}:/i.test(address) && !/^2002:/i.test(address) && !/^2001:(?:0{0,3}[0-9a-f]{1,2}|0?db8):/i.test(address) && !/^3fff:/i.test(address);
    return false;
}
export async function validateUrl(value: string) {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password)
        fail('validation_failed', 'External services require an HTTPS URL without credentials.');
    const addresses = await lookup(u.hostname.replace(/^\[|\]$/g, ''), { all: true });
    if (!addresses.length || addresses.some(a => !publicAddress(a.address)))
        fail('validation_failed', 'External services must use public internet addresses.');
    return { url: u, address: addresses[0] };
}
export async function safePost(value: string, body: unknown, headers: Record<string, string> = {}) {
    const { url, address } = await validateUrl(value);
    const payload = JSON.stringify(body);
    return new Promise<any>((resolve, reject) => {
        const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)), ...headers }, lookup: ((_host: any, _opts: any, cb: any) => cb(null, address.address, address.family)) as any, timeout: 10000 }, res => {
            if ((res.statusCode ?? 500) >= 300) {
                res.resume();
                reject(new Error('External service refused the request. Redirects are disabled.'));
                return;
            }
            res.on('error', reject);
            res.on('aborted', () => reject(new Error('External response was interrupted.')));
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', chunk => {
                size += chunk.length;
                if (size > 1048576) {
                    req.destroy(new Error('External response exceeds 1 MB.'));
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => {
                try {
                    const text = Buffer.concat(chunks).toString();
                    if (!text.trim()) {
                        resolve({});
                        return;
                    }
                    if (res.headers['content-type']?.includes('text/event-stream')) {
                        const event = text.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim())).find(msg => msg.result || msg.error);
                        if (!event)
                            throw new Error('No JSON-RPC response received.');
                        resolve(event);
                    }
                    else
                        resolve(JSON.parse(text));
                }
                catch {
                    reject(new Error('External service did not return JSON.'));
                }
            });
        });
        const deadline = setTimeout(() => req.destroy(new Error('External request timed out.')), 10000);
        req.on('close', () => clearTimeout(deadline));
        req.on('timeout', () => req.destroy(new Error('External request timed out.')));
        req.on('error', reject);
        req.end(payload);
    });
}
