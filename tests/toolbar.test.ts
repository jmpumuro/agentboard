// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import React, { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { BoardToolbar } from '../apps/web/src/features/board/BoardToolbar';
import type { Agent, Run } from 'contract';
const agent: Agent = { id: 'agt_artist', name: 'Artist', harness: 'custom', scopes: ['boards:read', 'boards:write'], capabilities: ['add', 'draw', 'edit'], instructions: '', mcpServers: [], boardIds: null, runner: { kind: 'builtin' }, status: 'active', keyPrefix: 'ab_live_12', lastSeenAt: null, createdAt: '2026-11-14T15:00:00.000Z' };
const run = (id: string, at: string): Run => ({ id, boardId: 'board', agentId: agent.id, requestedBy: { kind: 'user', id: 'user', name: 'Alex' }, message: 'Draw a rocket', status: 'done', steps: [{ id: 'step', kind: 'mcp', name: 'write_board', note: 'Drew a rocket', status: 'done' }], reply: 'A rocket, in open space.', error: null, createdAt: at, finishedAt: at, batches: [1], touched: ['drawing'], reverted: false });
let container: HTMLDivElement, root: Root, setRuns: (runs: Run[]) => void;
let initial: Run[] = [];
function Harness() { const canvas = useRef<HTMLDivElement>(null), [ask, setAsk] = useState(false), [runs, updateRuns] = useState(initial); setRuns = updateRuns; return React.createElement(MemoryRouter, {}, React.createElement('div', { ref: canvas, className: 'test-canvas' }, React.createElement(BoardToolbar, { boardId: 'board', userId: 'user', canvasRef: canvas, tool: 'select', onPick: () => { }, agents: [agent], runs, askMode: ask, onAskMode: setAsk, onShow: () => { }, onRevert: () => { }, onRun: run => updateRuns(all => all.some(r => r.id === run.id) ? all : [run, ...all]) }))); }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); initial = []; vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return { x: 0, y: 0, left: 0, top: 0, right: this.classList.contains('test-canvas') ? 800 : 530, bottom: this.classList.contains('test-canvas') ? 600 : 64, width: this.classList.contains('test-canvas') ? 800 : 530, height: this.classList.contains('test-canvas') ? 600 : 64, toJSON() { } } as DOMRect; }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); localStorage.clear(); delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; });
async function render() { await act(async () => root.render(React.createElement(Harness))); }
async function click(selector: string) { const el = container.querySelector(selector) as HTMLElement; expect(el).toBeTruthy(); await act(async () => el.click()); }
it('keeps the unsent request when switching tools and ask modes', async () => { await render(); expect(container.querySelector('[aria-label="Draw tool"]')).toBeTruthy(); expect(container.querySelector('[aria-label="Ask an agent"] svg')).toBeNull(); await click('[aria-label="Ask an agent"]'); const input = container.querySelector('input') as HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'An unsent drawing request'); input.dispatchEvent(new Event('input', { bubbles: true })); }); await click('[aria-label="Return to tools"]'); expect(container.querySelector('.toolbar-ask')).toBeNull(); await click('[aria-label="Ask an agent"]'); expect((container.querySelector('input') as HTMLInputElement).value).toBe('An unsent drawing request'); expect(container.textContent).toContain('Sees everything on this board.'); });
it('restores, hides and pages durable responses; a new run reveals its card', async () => { initial = [run('run_1', '2026-11-14T15:00:00.000Z')]; await render(); expect(container.querySelector('[aria-label="Agent response"]')).toBeTruthy(); expect(container.textContent).toContain('1 / 1'); expect(container.querySelector('details')?.open).toBe(false); await click('[aria-label="Hide response"]'); expect(container.querySelector('.response-card')).toBeNull(); await act(async () => root.unmount()); root = createRoot(container); await render(); expect(container.querySelector('.response-card')).toBeNull(); await click('[aria-label="Ask an agent"]'); await click('.agent-context .btn'); expect(container.querySelector('.response-card')).toBeTruthy(); await click('[aria-label="Hide response"]'); await act(async () => setRuns([...initial, run('run_2', '2026-11-14T15:01:00.000Z')])); expect(container.textContent).toContain('2 / 2'); await click('[aria-label="Previous response"]'); expect(container.textContent).toContain('1 / 2'); });
it('remembers the toolbar position and flips the attached response below near the top', async () => { initial = [run('run_1', '2026-11-14T15:00:00.000Z')]; localStorage.setItem('agentboard.toolbar.user', JSON.stringify({ fraction: .5, bottom: 500 })); await render(); expect(container.querySelector('.board-dock')?.getAttribute('data-response-placement')).toBe('below'); const grip = container.querySelector('[aria-label="Move toolbar"]')!; await act(async () => grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))); expect(JSON.parse(localStorage.getItem('agentboard.toolbar.user')!).bottom).toBe(32); expect(container.querySelector('.board-dock')?.getAttribute('data-response-placement')).toBe('above'); await act(async () => grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))); expect(JSON.parse(localStorage.getItem('agentboard.toolbar.user')!).bottom).toBe(42); });
it('hides both the response and replacement help so the canvas remains reachable', async () => {
    initial = [run('run_hide', '2026-11-14T15:00:00.000Z')]; await render();
    await click('[aria-label="Ask an agent"]'); await click('[aria-label="Hide response"]');
    expect(container.querySelector('.response-card')).toBeNull(); expect(container.querySelector('.agent-context')).toBeNull();
    await click('[aria-label="Return to tools"]'); await click('[aria-label="Ask an agent"]');
    expect(container.querySelector('.agent-context')).toBeTruthy();
});

it('keeps the new response selected when live completion arrives before the create-run response', async () => {
    const first = run('run_old', '2026-11-14T15:00:00.000Z'), next = { ...run('run_new', '2026-11-14T15:01:00.000Z'), reply: 'The draw ability is disabled.' };
    initial = [first]; await render(); await click('[aria-label="Ask an agent"]');
    let release!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(resolve => { release = resolve; }));
    const input = container.querySelector('.toolbar-ask input') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Draw a rocket'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { container.querySelector('.toolbar-ask')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await act(async () => setRuns([first, next]));
    expect(container.querySelector('.response-card')?.textContent).toContain('draw ability is disabled');
    await act(async () => { release(new Response(JSON.stringify({ ...next, status: 'queued', reply: null, steps: [] }), { status: 202, headers: { 'Content-Type': 'application/json' } })); });
    expect(container.querySelector('.response-pager')?.textContent).toContain('2 / 2');
    expect(container.querySelector('.response-card')?.textContent).toContain('draw ability is disabled');
});
