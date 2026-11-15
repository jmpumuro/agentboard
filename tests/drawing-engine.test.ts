import { it, expect } from 'vitest';
import { samplePoint, fitStrokes, absoluteStrokes, gridSpacing } from '../apps/web/src/board-engine/drawing';
import { constrainToolbar, DEFAULT_TOOLBAR_POSITION } from '../apps/web/src/board-engine/toolbar-position';
it('refits multiple strokes without moving their world points', () => { const first = fitStrokes([[100, 100, 140, 140]]); const next = fitStrokes([...absoluteStrokes(first), [80, 90, 150, 160]]); expect(next.strokes).toHaveLength(2); expect(absoluteStrokes(next)[0]).toEqual([100, 100, 140, 140]); expect(next.x).toBeLessThan(first.x); expect(next.text).toBe('Hand drawing'); });
it('encodes taps as two points and filters/caps samples in screen pixels', () => { expect(fitStrokes([[10, 20]]).strokes[0]).toHaveLength(4); expect(samplePoint([0, 0], { x: 2, y: 0 }, 1)).toEqual([0, 0]); expect(samplePoint([0, 0], { x: 2, y: 0 }, 2)).toEqual([0, 0, 2, 0]); const max = Array(4000).fill(0); expect(samplePoint(max, { x: 20, y: 20 }, 1)).toBe(max); });
it('keeps dot spacing consistent at 100%, 50%, 200% and sparse at 25%', () => { expect([1, .5, 2, .25].map(gridSpacing)).toEqual([24, 24, 24, 48]); });
it('constrains toolbars to desktop and phone canvas bounds', () => {
    for (const width of [360, 1200]) {
        const bounds = { width, height: 600 }, bar = { width: Math.min(520, width - 24), height: 60 };
        for (const p of [{ fraction: -1, bottom: 900 }, { fraction: 2, bottom: -20 }, DEFAULT_TOOLBAR_POSITION]) {
            const constrained = constrainToolbar(p, bounds, bar);
            expect(constrained.fraction * width - bar.width / 2).toBeGreaterThanOrEqual(12);
            expect(constrained.fraction * width + bar.width / 2).toBeLessThanOrEqual(width - 12);
            expect(constrained.bottom).toBeGreaterThanOrEqual(12);
            expect(constrained.bottom + bar.height).toBeLessThanOrEqual(588);
        }
    }
});
