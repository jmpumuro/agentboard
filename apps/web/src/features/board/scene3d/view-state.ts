import type { Element } from 'contract';
export type Model = Extract<Element, { type: 'scene3d' }>;
export type ModelView = { selected: string | null; hidden: string[]; only: string | null; explode: number; camera: { yaw: number; pitch: number } };
export function initialView(model: Model): ModelView { return { selected: null, hidden: [], only: null, explode: model.explode, camera: model.camera }; }
export const LIVE_MODEL_LIMIT = 2;
export function liveModelIds(visible: string[], selected: string[]) { return [...new Set([...selected.filter(id => visible.includes(id)), ...visible])].slice(0, LIVE_MODEL_LIMIT); }
