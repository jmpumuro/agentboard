import { test as setup, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { E2E_ORIGIN, AUTH_STATE } from './environment';
setup('authenticate the isolated browser workspace', async ({ request }) => {
    const signup = await request.post('/api/v1/auth/signup', { headers: { Origin: E2E_ORIGIN }, data: { name: 'Test Owner', email: 'e2e-owner@example.com', password: 'test-password-123' } });
    expect(signup.status(), await signup.text()).toBe(201);
    await mkdir('.data', { recursive: true });
    await writeFile(AUTH_STATE, JSON.stringify(await request.storageState()), { mode: 0o600 });
});
