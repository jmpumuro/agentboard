// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { STARTER_SCENE } from 'contract';
import { Scene3DCard } from '../apps/web/src/features/board/scene3d/Scene3DCard';
import { initialView, liveModelIds, type Model } from '../apps/web/src/features/board/scene3d/view-state';
const counts = vi.hoisted(() => ({ live: 0, max: 0, created: 0, disposed: 0, renders: 0 }));
vi.mock('three', async original => {
    const actual = await original<typeof import('three')>();
    return { ...actual, WebGLRenderer: class {
        domElement = document.createElement('canvas');
        constructor() { counts.created++; counts.live++; counts.max = Math.max(counts.max, counts.live); }
        setPixelRatio() {} setSize(w: number, h: number) { this.domElement.width = w; this.domElement.height = h; }
        getContext() { return { isContextLost: () => false }; }
        render() { counts.renders++; }
        dispose() { counts.live--; counts.disposed++; } forceContextLoss() {}
    } };
});
const viewChanges = vi.fn();
let root: Root, container: HTMLDivElement, activate: (id: string) => void;
const actor = { kind: 'user' as const, id: 'u', name: 'Alex' };
const models: Model[] = ['a', 'b', 'c'].map(id => ({ ...STARTER_SCENE, id, parts: [{ ...STARTER_SCENE.parts[0], id: 'block', v: 1 }], version: 1, createdBy: actor, updatedBy: actor, updatedAt: new Date().toISOString() }));
function Harness() {
    const [active, setActive] = useState('a'); activate = setActive;
    const live = liveModelIds(models.map(m => m.id), [active]);
    return <>{models.map(model => <Scene3DCard key={model.id} model={model} view={initialView(model)} onView={viewChanges} live={live.includes(model.id)} onActivate={() => setActive(model.id)} interactive onTouchStart={() => {}}/>)}</>;
}
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    viewChanges.mockClear();
    Object.assign(counts, { live: 0, max: 0, created: 0, disposed: 0, renders: 0 });
    vi.stubGlobal('WebGL2RenderingContext', class {});
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => window.setTimeout(() => f(0), 1));
    vi.stubGlobal('cancelAnimationFrame', window.clearTimeout);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,still');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 380, bottom: 250, width: 380, height: 250, toJSON() {} });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(380);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(250);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; });
it('mounts at most two renderers, keeps stills, recovers context loss and disposes released views', async () => {
    // Fake GPU, real Three.js scene graph and OrbitControls lifecycle.
    await import('../apps/web/src/features/board/scene3d/Scene3DView');
    await act(async () => { root.render(React.createElement(Harness)); await new Promise(r => setTimeout(r, 50)); });
    for (let i = 0; i < 12 && counts.live < 2; i++) await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(counts.live).toBe(2); expect(container.querySelectorAll('canvas')).toHaveLength(2);
    expect(counts.renders).toBeGreaterThan(0);
    const canvas = container.querySelector('canvas')!;
    await act(async () => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
    expect(canvas.parentElement?.dataset.fallback).toBe('true');
    await act(async () => canvas.dispatchEvent(new Event('webglcontextrestored')));
    expect(canvas.parentElement?.dataset.fallback).toBeUndefined();
    await act(async () => activate('c'));
    expect(counts.live).toBe(2); expect(counts.max).toBe(2); expect(counts.disposed).toBe(1);
    expect(container.querySelectorAll('.scene3d-still')).toHaveLength(3);
    await act(async () => root.render(null));
    expect(counts.live).toBe(0); expect(counts.disposed).toBe(counts.created);
});

it('can pick a part after board pinch releases a pointer outside the view', async () => {
    await import('../apps/web/src/features/board/scene3d/Scene3DView');
    await act(async () => root.render(React.createElement(Harness)));
    for (let i = 0; i < 12 && counts.live < 2; i++) await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    const view = container.querySelector('.scene3d-live')!;
    async function pointer(target: EventTarget, type: string, id: number, pointerType = 'touch') {
        const e = new MouseEvent(type, { bubbles: true, clientX: 190, clientY: 125 });
        Object.defineProperties(e, { pointerId: { value: id }, pointerType: { value: pointerType } });
        await act(async () => target.dispatchEvent(e));
    }
    await pointer(view, 'pointerdown', 1); await pointer(view, 'pointerdown', 2);
    await pointer(document, 'pointerup', 2); await pointer(view, 'pointerup', 1);
    expect(viewChanges.mock.calls.some(([patch]) => patch.selected)).toBe(false);
    await pointer(view, 'pointerdown', 3, 'mouse'); await pointer(view, 'pointerup', 3, 'mouse');
    expect(viewChanges).toHaveBeenCalledWith({ selected: 'block' });
});
