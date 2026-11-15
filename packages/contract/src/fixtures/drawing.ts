import { DRAWING_EXAMPLE } from '../index';
export const validDrawing = DRAWING_EXAMPLE;
export const invalidDrawingFixtures = [
    { rule: 'non-numeric point', data: { ...DRAWING_EXAMPLE, strokes: [[0, 0, 'bad', 20]] }, code: 'validation_failed' },
    { rule: 'odd coordinates', data: { ...DRAWING_EXAMPLE, strokes: [[0, 0, 20]] }, code: 'validation_failed' },
    { rule: 'one point', data: { ...DRAWING_EXAMPLE, strokes: [[0, 0]] }, code: 'validation_failed' },
    { rule: 'coordinate bounds', data: { ...DRAWING_EXAMPLE, strokes: [[0, 0, 8001, 20]] }, code: 'validation_failed' },
    { rule: 'empty description', data: { ...DRAWING_EXAMPLE, text: '' }, code: 'validation_failed' },
    { rule: 'view box bounds', data: { ...DRAWING_EXAMPLE, vw: 8001 }, code: 'validation_failed' },
    { rule: 'stroke limit', data: { ...DRAWING_EXAMPLE, strokes: Array.from({ length: 301 }, () => [0, 0, 10, 10]) }, code: 'limit_exceeded' },
    { rule: 'point limit', data: { ...DRAWING_EXAMPLE, strokes: [Array.from({ length: 20002 }, (_, i) => i % 100)] }, code: 'limit_exceeded' }
];
export const abilityRefusals = ['add', 'draw', 'edit', 'delete', 'knowledge'].map(ability => ({ error: { code: 'forbidden', message: `This agent may not ${ability}.`, details: { ability } } }));
