import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
const exec = promisify(execFile), port = Number(process.env.PORT || 4173), project = await realpath(process.cwd());
async function listeners() {
    try { return [...new Set((await exec('lsof', ['-t', '-nP', '-iTCP:' + port, '-sTCP:LISTEN'])).stdout.trim().split(/\s+/).filter(Boolean).map(Number))]; }
    catch (error: any) { if (error.code === 1) return []; throw error; }
}
const current = await listeners();
for (const pid of current) {
    const cwd = (await exec('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])).stdout.split('\n').find(line => line.startsWith('n'))?.slice(1);
    if (!cwd || await realpath(cwd) !== project) throw Error(`Port ${port} belongs to another project. It was left running.`);
}
for (const pid of current) process.kill(pid, 'SIGINT');
function stillRunning(pid: number) { try { process.kill(pid, 0); return true; } catch (error: any) { return error.code !== 'ESRCH'; } }
for (let i = 0; i < 50 && (current.some(stillRunning) || (await listeners()).length); i++) await new Promise(resolve => setTimeout(resolve, 100));
if (current.some(stillRunning) || (await listeners()).length) throw Error(`The old server did not release port ${port}. Stop it in its terminal and retry.`);
console.log('Starting AgentBoard with the updated server and existing workspace.');
const child = spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'apps/api/src/main.ts'], { stdio: 'inherit', env: process.env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
