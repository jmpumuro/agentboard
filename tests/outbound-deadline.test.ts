import { EventEmitter } from 'node:events';
import https from 'node:https';
import { afterEach, expect, it, vi } from 'vitest';
import { safePost } from '../apps/api/src/lib/outbound';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]) }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('ends a slow streaming response at the absolute deadline', async () => {
    vi.useFakeTimers();
    const req = new EventEmitter() as any;
    req.end = vi.fn();
    req.destroy = vi.fn((error: Error) => { req.emit('error', error); req.emit('close'); });
    const res = new EventEmitter() as any;
    res.statusCode = 200; res.headers = {};
    vi.spyOn(https, 'request').mockImplementation(((_url: any, _options: any, callback: any) => { queueMicrotask(() => callback(res)); return req; }) as any);
    const pending = safePost('https://example.com', {});
    const rejection = expect(pending).rejects.toThrow('timed out');
    await Promise.resolve(); await Promise.resolve();
    for (let i = 0; i < 9; i++) { await vi.advanceTimersByTimeAsync(1000); res.emit('data', Buffer.from(' ')); }
    expect(req.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
    expect(req.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
});
