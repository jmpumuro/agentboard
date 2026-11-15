// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Scene3DSelectionBar } from '../apps/web/src/features/board/scene3d/Scene3DSelectionBar';
import { STARTER_SCENE, type Element } from 'contract';
import { initialView } from '../apps/web/src/features/board/scene3d/view-state';
it('uses a vertical icon-only rail while retaining labelled controls and shared part operations', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const actor = { kind: 'user' as const, id: 'u', name: 'Alex' };
    const model: Extract<Element, { type: 'scene3d' }> = { ...STARTER_SCENE, id: 'm', version: 1, createdBy: actor, updatedBy: actor, updatedAt: new Date().toISOString(), parts: [{ ...STARTER_SCENE.parts[0], id: 'p', v: 2 }] };
    const onOps = vi.fn(), node = document.createElement('div'), root = createRoot(node); document.body.append(node);
    try {
        await act(async () => root.render(<Scene3DSelectionBar model={model} view={{ ...initialView(model), selected: 'p' }} onView={() => {}} onOps={onOps} onAsk={() => {}} busy={false}/>));
        const toolbar = node.querySelector('[role=toolbar]')!; expect(toolbar.getAttribute('aria-orientation')).toBe('vertical'); expect(toolbar.textContent).toBe('');
        for (const button of toolbar.querySelectorAll('button')) { expect(button.getAttribute('aria-label')).toBeTruthy(); expect(button.querySelector('svg')).toBeTruthy(); }
        await act(async () => (node.querySelector('[aria-label="Bigger"]') as HTMLElement).click());
        expect(onOps).toHaveBeenCalledWith([{ op: 'part.update', id: 'm', partId: 'p', ifPartVersion: 2, data: { size: [2.4, 2.4, 2.4] } }]);
        await act(async () => (node.querySelector('[aria-label="Add part"]') as HTMLElement).click());
        expect(node.querySelector('[aria-label="Add cone"]')).toBeTruthy();
    } finally { await act(async () => root.unmount()); node.remove(); delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; }
});
