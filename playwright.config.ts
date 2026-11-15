import { defineConfig, devices } from '@playwright/test';
const authState = '.data/e2e-auth-state.json';
const origin = process.env.E2E_ORIGIN || 'http://localhost:4184';
export default defineConfig({
    testDir: 'tests/browser', fullyParallel: false, workers: 1,
    timeout: process.env.E2E_REAL_MODEL ? 360000 : 45000,
    outputDir: 'reports/e2e-artifacts',
    reporter: [['list'], ['json', { outputFile: process.env.E2E_REAL_MODEL ? 'reports/e2e-real-results.json' : 'reports/e2e-results.json' }]],
    use: { baseURL: origin, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    projects: [{ name: 'setup', testMatch: /auth\.setup\.ts/ }, { name: 'desktop', dependencies: ['setup'], use: { ...devices['Desktop Chrome'], storageState: authState } }, { name: 'phone', dependencies: ['setup'], use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', storageState: authState } }],
    webServer: { command: 'node --env-file-if-exists=.env --import tsx tests/browser/server.ts', url: origin + '/healthz', reuseExistingServer: false, env: { E2E_ORIGIN: origin }, timeout: 30000 }
});
