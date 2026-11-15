import type { ElementInput, PartInput } from '../index';
const yaw = .65, pitch = .4;
function part(i: number, data: Omit<PartInput, 'out'>): PartInput {
    const col = i % 3 - 1, row = 1 - Math.floor(i / 3);
    const right = [Math.cos(yaw), 0, -Math.sin(yaw)], up = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch)];
    return { ...data, out: data.pos.map((n, axis) => right[axis] * col * 8 + up[axis] * row * 8 - n) as PartInput['pos'] };
}
export const ENGINE_MODEL: Extract<ElementInput, { type: 'scene3d' }> = {
    type: 'scene3d', x: 350, y: 50, w: 610, h: 460, text: 'How an engine turns fuel into motion', prompt: 'Explain a simple engine with named parts that pull apart to show how combustion turns the crankshaft.', camera: { yaw, pitch }, explode: 0,
    parts: [
        part(0, { id: 'engine_block', kind: 'box', pos: [0, 0, 0], size: [3, 3, 2.5], color: 'gray', name: 'Engine block', info: 'The strong outer structure supports the cylinder and moving parts.' }),
        part(1, { id: 'cylinder', kind: 'cylinder', pos: [0, .7, 0], size: [1.6, 2.4, 1.6], color: 'blue', name: 'Cylinder', info: 'The piston slides up and down inside this chamber.' }),
        part(2, { id: 'piston', kind: 'cylinder', pos: [0, .8, 0], size: [1.35, .7, 1.35], color: 'orange', name: 'Piston', info: 'Expanding gas pushes the piston down, starting the power stroke.' }),
        part(3, { id: 'connecting_rod', kind: 'box', pos: [0, -.8, 0], size: [.35, 2, .35], color: 'yellow', name: 'Connecting rod', info: 'This link transfers the piston’s push to the crankshaft.' }),
        part(4, { id: 'crankshaft', kind: 'cylinder', axis: 'x', pos: [0, -2, 0], size: [.65, 4.2, .65], color: 'red', name: 'Crankshaft', info: 'Its offset connection converts the rod’s up-and-down motion into rotation.' }),
        part(5, { id: 'flywheel', kind: 'cylinder', axis: 'x', pos: [2.3, -2, 0], size: [2.4, .35, 2.4], color: 'green', name: 'Flywheel', info: 'This heavy wheel stores rotational energy and smooths the engine’s output.' }),
        part(6, { id: 'intake_valve', kind: 'cone', pos: [-.6, 2.1, 0], size: [.8, .8, .8], color: 'purple', name: 'Intake valve', info: 'It opens to let fresh air and fuel enter the cylinder.' }),
        part(7, { id: 'spark_plug', kind: 'cylinder', pos: [0, 2.7, 0], size: [.35, .8, .35], color: 'white', name: 'Spark plug', info: 'An electric spark ignites the mixture so hot gas expands against the piston.' }),
        part(8, { id: 'exhaust_valve', kind: 'cone', pos: [.6, 2.1, 0], size: [.8, .8, .8], color: 'orange', name: 'Exhaust valve', info: 'It opens after the power stroke to let used gases leave the cylinder.' })
    ]
};
