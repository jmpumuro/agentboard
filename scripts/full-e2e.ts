import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const liveOnly = process.argv.includes('--live-only');
const reportFile = liveOnly ? 'reports/live-e2e-result.json' : 'reports/full-e2e-result.json';
const results: { phase: string; passed: boolean }[] = [];
await mkdir('reports', { recursive: true });
await writeFile(reportFile, JSON.stringify({ status: 'running', passed: null, results }, null, 2));
async function phase(name: string, args: string[], env: NodeJS.ProcessEnv = {}) {
    console.log('\n' + name);
    const passed = await new Promise<boolean>((resolve, reject) => {
        const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } });
        child.on('error', reject); child.on('exit', code => resolve(code === 0));
    });
    results.push({ phase: name, passed }); await writeFile(reportFile, JSON.stringify({ status: passed ? 'running' : 'failed', passed: passed ? null : false, results }, null, 2));
    if (!passed) throw Error(name + ' failed; see reports.');
}
try {
    await phase('Typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']);
    await phase('Contract generation', ['--import', 'tsx', 'packages/contract/generate.ts']);
    await phase('Unit and integration tests', ['node_modules/vitest/vitest.mjs', 'run']);
    await phase('Production build', ['--import', 'tsx', 'scripts/build-web.ts']);
    if (!liveOnly) await phase('Desktop and phone browser flows', ['node_modules/@playwright/test/cli.js', 'test', '--grep-invert', 'real OpenAI']);
    await phase('Live OpenAI browser flow', ['node_modules/@playwright/test/cli.js', 'test', 'real-agent.spec.ts', '--project=desktop'], { E2E_REAL_MODEL: '1' });
    await writeFile(reportFile, JSON.stringify({ status: 'passed', passed: true, results }, null, 2));
    console.log(liveOnly ? '\nLIVE OPENAI END-TO-END CHECKS PASSED' : '\nALL END-TO-END CHECKS PASSED');
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
