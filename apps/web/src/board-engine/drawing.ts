import type { DrawingInputType } from 'contract';
export type Point = {
    x: number;
    y: number;
};
export function samplePoint(stroke: number[], point: Point, zoom: number) {
    if (stroke.length >= 4000)
        return stroke;
    const last = stroke.length - 2;
    if (last >= 0 && Math.hypot(point.x - stroke[last], point.y - stroke[last + 1]) * zoom < 2.5)
        return stroke;
    return [...stroke, point.x, point.y];
}
export function absoluteStrokes(drawing: DrawingInputType) { return drawing.strokes.map(s => s.map((v, i) => i % 2 ? drawing.y + v * drawing.h / drawing.vh : drawing.x + v * drawing.w / drawing.vw)); }
/** Refitting preserves each stroke's world geometry; a tap is represented by two coincident points. */
export function fitStrokes(strokes: number[][], description = 'Hand drawing'): DrawingInputType {
    const valid = strokes.map(s => s.length === 2 ? [...s, ...s] : s);
    const xs = valid.flatMap(s => s.filter((_, i) => i % 2 === 0)), ys = valid.flatMap(s => s.filter((_, i) => i % 2 === 1));
    const x = Math.min(...xs) - 3, y = Math.min(...ys) - 3;
    const w = Math.max(20, Math.max(...xs) - x + 3), h = Math.max(20, Math.max(...ys) - y + 3);
    if (w > 4000 || h > 4000 || Math.abs(x) > 100000 || Math.abs(y) > 100000)
        throw Error('This sketch is too large. Start another drawing.');
    return { type: 'drawing', x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10, vw: Math.round(w * 10) / 10, vh: Math.round(h * 10) / 10, text: description, strokes: valid.map(s => s.map((v, i) => Math.round((v - (i % 2 ? y : x)) * 10) / 10)) };
}
export function gridSpacing(zoom: number) { return zoom < .5 ? 48 : 24; }
