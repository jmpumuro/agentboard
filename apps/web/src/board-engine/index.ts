import type { Element, Op, ServerMsg } from 'contract';
export type Snapshot = {
    seq: number;
    order: string[];
    elements: Element[];
};
export function applyLive(state: Snapshot, msg: ServerMsg): {
    state: Snapshot;
    resync: boolean;
} {
    if (msg.t === 'resync')
        return { state, resync: true };
    if (msg.t !== 'ops' || msg.seq <= state.seq)
        return { state, resync: false };
    if (msg.seq !== state.seq + 1)
        return { state, resync: true };
    const map = new Map(state.elements.map(e => [e.id, e]));
    for (const op of msg.ops) {
        if (op.op === 'delete')
            map.delete(op.id);
        else
            map.set(op.element.id, op.element);
    }
    return { state: { seq: msg.seq, order: msg.order, elements: [...map.values()] }, resync: false };
}
export function overlay(state: Snapshot, ops: Op[]): Snapshot {
    if (!ops.length) return state;
    const result = structuredClone(state);
    for (const op of ops) {
        if (op.op === 'update')
            result.elements = result.elements.map(e => e.id === op.id ? { ...e, ...op.data } as Element : e);
        if (op.op === 'part.add' || op.op === 'part.update' || op.op === 'part.delete') {
            const model = result.elements.find(e => e.id === op.id);
            if (model?.type === 'scene3d') {
                if (op.op === 'part.add') model.parts.push({ ...op.part, id: op.part.id ?? 'pending_part', v: 1 });
                if (op.op === 'part.update') model.parts = model.parts.map(p => p.id === op.partId ? { ...p, ...op.data } : p);
                if (op.op === 'part.delete') model.parts = model.parts.filter(p => p.id !== op.partId);
            }
        }
        if (op.op === 'delete') {
            result.elements = result.elements.filter(e => e.id !== op.id);
            result.order = result.order.filter(id => id !== op.id);
        }
        if (op.op === 'create' && op.id) {
            const actor = { kind: 'user' as const, id: 'pending', name: 'You' };
            result.elements.push({ ...op.data, id: op.id, version: 1, createdBy: actor, updatedBy: actor, updatedAt: new Date().toISOString() } as Element);
            result.order.push(op.id);
        }
        if (op.op === 'restack') {
            result.order = result.order.filter(id => !op.ids.includes(id));
            result.order = op.to === 'front' ? [...result.order, ...op.ids] : [...op.ids, ...result.order];
        }
    }
    return result;
}
export function overlayBatches(state: Snapshot, batches: Op[][]): Snapshot {
    let current = state;
    for (const batch of batches)
        current = overlay(current, batch);
    return current;
}
export function bounds(elements: Element[]) {
    const list = elements.filter(e => e.type !== 'arrow');
    if (!list.length)
        return { x: 0, y: 0, w: 800, h: 500 };
    const x = Math.min(...list.map(e => e.x)), y = Math.min(...list.map(e => e.y));
    return { x, y, w: Math.max(...list.map(e => e.x + ('w' in e ? e.w : 320))) - x, h: Math.max(...list.map(e => e.y + ('h' in e ? e.h : 70))) - y };
}
export function nearViewport(element: {
    x: number;
    y: number;
    w: number;
    h: number;
}, viewport: {
    x: number;
    y: number;
    w: number;
    h: number;
}, margin = 400) { return element.x + element.w >= viewport.x - margin && element.x <= viewport.x + viewport.w + margin && element.y + element.h >= viewport.y - margin && element.y <= viewport.y + viewport.h + margin; }
