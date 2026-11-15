// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../apps/web/src/App';
import { LocalStore } from '../apps/api/src/db/store';
import { createApp } from '../apps/api/src/server';
it('stage 7: renders auth and navigates every real screen against the service routes', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: () => { } });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: () => { } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: () => { } });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => { } });
    class TestPointerEvent extends MouseEvent {
        pointerId: number;
        pointerType: string;
        constructor(type: string, init: MouseEventInit) { super(type, init); this.pointerId = 1; this.pointerType = 'mouse'; }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    const store = await new LocalStore().init();
    const server = createApp(store, { origin: window.location.origin });
    let cookie = '';
    vi.stubGlobal('fetch', async (input: string, init: any = {}) => {
        const url = new URL(String(input), window.location.origin);
        // Exercise navigation with an auth response slower than the old fixed wait.
        if (url.pathname.endsWith('/auth/signup')) await new Promise(resolve => setTimeout(resolve, 250));
        const headers = { origin: window.location.origin, cookie, ...init.headers };
        const result = await server.handle({ url: url.pathname + url.search, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers });
        if (result.headers?.['Set-Cookie'])
            cookie = result.headers['Set-Cookie'].split(';')[0];
        return new Response(result.body === undefined ? null : JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
    });
    class FakeWebSocket {
        onopen: any;
        onmessage: any;
        onclose: any;
        close() { }
        send() { }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket);
    window.history.replaceState({}, '', '/signup');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    async function settle() { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
    async function assertUI(assertion: () => void | Promise<void>) { await vi.waitFor(async () => { await settle(); await assertion(); }, { timeout: 5000, interval: 20 }); }
    async function click(find: () => Element | null | undefined) { let el: Element | null | undefined; await assertUI(() => { el = find(); expect(el).toBeTruthy(); expect((el as HTMLButtonElement).disabled).not.toBe(true); }); await act(async () => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); await settle(); }
    try {
        await act(async () => { root.render(React.createElement(App)); });
        await assertUI(async () => { expect(container.textContent).toContain('Make room for your ideas.'); });
        for (const [name, value] of [['name', 'Alex'], ['email', 'ui@example.com'], ['password', 'password123']]) {
            (container.querySelector(`input[name="${name}"]`) as HTMLInputElement).value = value;
        }
        await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
        await settle();
        await assertUI(async () => { expect(container.textContent).toContain('A place to think together.'); });
        await click(() => container.querySelector('nav a[href="/agents"]'));
        await click(() => [...container.querySelectorAll('button')].find(el => el.textContent === 'Connect agent')!);
        await assertUI(async () => { expect(container.querySelector('dialog')).toBeTruthy(); });
        (container.querySelector('input[name="name"]') as HTMLInputElement).value = 'UI Planner';
        await act(async () => { container.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
        await settle();
        await assertUI(async () => { expect(container.textContent).toContain('ab_live_'); });
        await assertUI(async () => { expect(container.textContent).toContain('Your agent is connected.'); });
        await click(() => [...container.querySelectorAll('button')].find(el => el.textContent?.startsWith('I’ve saved my key'))!);
        await assertUI(async () => { expect(container.textContent).toContain('UI Planner'); });
        for (const [path, text] of [['agents', 'A few extra perspectives.'], ['activity', 'See the thinking unfold.'], ['developers', 'Your agents. Your tools.'], ['settings', 'Your workspace, your way.'], ['boards', 'A place to think together.']]) {
            await click(() => container.querySelector(`nav a[href="/${path}"]`));
            await assertUI(() => expect(container.textContent).toContain(text));
        }
        await click(() => [...container.querySelectorAll('button')].find(el => el.textContent === 'New board')!);
        await settle();
        await assertUI(async () => { expect(container.querySelector('.canvas')).toBeTruthy(); });
        await assertUI(async () => { expect(container.querySelector('[aria-label="Board title"]')).toBeTruthy(); });
        const title = container.querySelector('[aria-label="Board title"]') as HTMLInputElement;
        title.value = 'Saved through Back';
        await click(() => container.querySelector('[aria-label="Back to boards"]'));
        await assertUI(async () => { expect(container.textContent).toContain('A place to think together.'); });
        await assertUI(async () => { expect(container.textContent).toContain('Saved through Back'); });
        await click(() => container.querySelector('.board-card a'));
        await settle();
        await assertUI(async () => { expect(container.textContent).toContain('A fresh space for a new thought.'); });
        await click(() => container.querySelector('[aria-label="Ask an agent"]'));
        await assertUI(async () => { expect(container.textContent).toContain('Sees everything on this board.'); });
        await click(() => container.querySelector('[aria-label="Return to tools"]'));
        await assertUI(async () => { expect(container.querySelector('.toolbar-ask')).toBeNull(); });
        async function stroke(x: number, y: number) {
            const canvas = container.querySelector('.canvas')!;
            for (const [type, cx, cy] of [['pointerdown', x, y], ['pointermove', x + 35, y + 25], ['pointerup', x + 60, y + 50]] as const) {
                await act(async () => { canvas.dispatchEvent(new TestPointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: cx, clientY: cy })); });
            }
            await settle();
        }
        await click(() => container.querySelector('[aria-label="Draw tool"]'));
        await assertUI(async () => { expect(container.querySelector('.canvas-empty')).toBeNull(); });
        await stroke(120, 150);
        await assertUI(async () => { expect(container.querySelectorAll('.element.drawing')).toHaveLength(1); });
        await stroke(180, 180);
        await assertUI(async () => { expect(container.querySelectorAll('.element.drawing')).toHaveLength(1); });
        await assertUI(async () => { expect(container.querySelectorAll('.element.drawing polyline')).toHaveLength(2); });
        await click(() => container.querySelector('[aria-label="Undo (⌘Z)"]'));
        await assertUI(async () => { expect(container.querySelectorAll('.element.drawing polyline')).toHaveLength(1); });
        await click(() => container.querySelector('[aria-label="Draw tool"]'));
        await assertUI(async () => { expect(container.querySelector('.canvas-empty')).toBeNull(); });
        await stroke(240, 180);
        await assertUI(async () => { expect(container.querySelectorAll('.element.drawing')).toHaveLength(2); });
        await click(() => container.querySelector('[aria-label="Select tool"]'));
        await click(() => container.querySelector('[aria-label="Describe drawing"]'));
        const description = container.querySelector('dialog input') as HTMLInputElement;
        await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(description, 'A pen sketch'); description.dispatchEvent(new Event('input', { bubbles: true })); });
        await act(async () => { container.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
        await settle();
        await assertUI(async () => { expect(container.querySelector('svg[aria-label="A pen sketch"]')).toBeTruthy(); });
        await click(() => container.querySelector('[aria-label="Delete selected elements"]'));
        await assertUI(async () => { expect(container.querySelectorAll('.element.drawing')).toHaveLength(1); });
        await click(() => container.querySelector('[aria-label="Undo (⌘Z)"]'));
        await assertUI(async () => { expect(container.querySelectorAll('.element.drawing')).toHaveLength(2); });
        await click(() => container.querySelector('[aria-label="Design tool"]'));
        await act(async () => { container.querySelector('.canvas')!.dispatchEvent(new TestPointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 300, clientY: 300 })); });
        await assertUI(async () => { expect(container.querySelector('dialog')).toBeNull(); });
        await assertUI(async () => { expect(container.querySelector('input[placeholder="Describe the design you want here…"]')).toBeTruthy(); });
        const design = container.querySelector('.toolbar-ask input') as HTMLInputElement;
        await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(design, 'A calm three-plan pricing page with green accents.'); design.dispatchEvent(new Event('input', { bubbles: true })); });
        await act(async () => { container.querySelector('.toolbar-ask')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
        await settle();
        await assertUI(async () => { expect(container.querySelector('.response-card')).toBeTruthy(); });
        await assertUI(async () => { expect(container.textContent).toContain('A calm three-plan pricing page with green accents.'); });
        await click(() => container.querySelector('[aria-label="Return to tools"]'));
        await click(() => container.querySelector('[aria-label="3D tool"]'));
        await act(async () => { container.querySelector('.canvas')!.dispatchEvent(new TestPointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 400, clientY: 300 })); }); await settle();
        await assertUI(async () => { expect(container.querySelectorAll('.element.scene3d')).toHaveLength(1); });
        await assertUI(async () => { expect(container.querySelector('input[placeholder="Describe the 3D model to build, or what to change…"]')).toBeTruthy(); });
        await assertUI(async () => { expect(container.querySelector('dialog')).toBeNull(); });
        const modelBoard = Object.values((await store.read()).boards).find(b => Object.values(b.elements).some(e => e.type === 'scene3d'))!;
        const seqBefore = modelBoard.board.seq;
        await click(() => container.querySelector('[aria-label="Pull apart model"]'));
        const slider = container.querySelector('[aria-label="Pull apart"]') as HTMLInputElement;
        await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '.7'); slider.dispatchEvent(new Event('input', { bubbles: true })); });
        await assertUI(async () => { expect(container.querySelector('.scene3d-explode output')?.textContent).toBe('70%'); });
        await assertUI(async () => { expect((await store.read()).boards[modelBoard.board.id].board.seq).toBe(seqBefore); });
        await click(() => container.querySelector('[aria-label="Add part"]'));
        await click(() => container.querySelector('[aria-label="Add sphere"]'));
        const getModel = async () => Object.values((await store.read()).boards[modelBoard.board.id].elements).find(e => e.type === 'scene3d')! as Extract<import('contract').Element, { type: 'scene3d' }>;
        await assertUI(async () => { expect((await getModel()).parts).toHaveLength(2); });
        await click(() => container.querySelector('[aria-label="Bigger"]')!);
        await assertUI(async () => { expect((await getModel()).parts[1].size[0]).toBeCloseTo(2.4); });
        await click(() => container.querySelector('[aria-label="Undo (⌘Z)"]'));
        await assertUI(async () => { expect((await getModel()).parts[1].size[0]).toBe(2); });
        await click(() => container.querySelector('[aria-label="Undo (⌘Z)"]'));
        await assertUI(async () => { expect((await getModel()).parts).toHaveLength(1); });

    }
    finally {
        await act(async () => root.unmount());
        container.remove();
        await server.close();
        vi.unstubAllGlobals();
        delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    }
}, 20000);
