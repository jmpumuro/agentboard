import { JSDOM } from 'jsdom';
import { Path2D, type SKRSContext2D } from '@napi-rs/canvas';
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js';
import { buildScene, disposeScene, sceneCamera } from 'contract/scene3d';
import type { Element } from 'contract';
// Only Three.js-generated paths are rasterized. User HTML/SVG is never executed or parsed.
const document = new JSDOM('').window.document;
export function drawScene3D(ctx: SKRSContext2D, model: Extract<Element, { type: 'scene3d' }>) {
    const width = Math.max(20, model.w), height = Math.max(20, model.h - 64);
    const scene = buildScene(model.parts, model.explode), { camera } = sceneCamera(scene, width / height, model.camera);
    const previous = globalThis.document;
    try {
        globalThis.document = document;
        const renderer = new SVGRenderer(); renderer.setSize(width, height); renderer.setPrecision(2); renderer.render(scene, camera);
        ctx.save(); ctx.translate(model.x, model.y + 30);
        ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
        ctx.fillStyle = '#f3f5f0'; ctx.fillRect(0, 0, width, height);
        ctx.translate(width / 2, height / 2);
        for (const path of renderer.domElement.querySelectorAll('path')) {
            const shape = new Path2D(path.getAttribute('d') || '');
            if (path.style.fill && path.style.fill !== 'none') {
                ctx.fillStyle = path.style.fill; ctx.globalAlpha = Number(path.style.fillOpacity || 1); ctx.fill(shape);
            }
            if (path.style.stroke && path.style.stroke !== 'none') {
                ctx.strokeStyle = path.style.stroke; ctx.lineWidth = Number(path.style.strokeWidth || 1); ctx.globalAlpha = Number(path.style.strokeOpacity || 1); ctx.stroke(shape);
            }
        }
        ctx.restore();
    } finally { globalThis.document = previous; disposeScene(scene); }
}
