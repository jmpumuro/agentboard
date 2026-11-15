import { expect, it } from 'vitest';
import * as THREE from 'three';
import { buildScene, disposeScene, sceneCamera } from 'contract/scene3d';
import { ENGINE_MODEL } from '../packages/contract/src/scene3d/example';
import { liveModelIds, LIVE_MODEL_LIMIT } from '../apps/web/src/features/board/scene3d/view-state';
const parts = ENGINE_MODEL.parts.map((p, i) => ({ ...p, id: p.id ?? 'p' + i, v: 1 }));
it('explodes every engine part into a distinct visible region from the saved camera', () => {
    const scene = buildScene(parts, 1), { camera } = sceneCamera(scene, 610 / 396, ENGINE_MODEL.camera);
    const rectangles = scene.children.filter(o => o instanceof THREE.Mesh).map(mesh => {
        const box = new THREE.Box3().setFromObject(mesh), points = [];
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x, y, z).project(camera));
        return { id: mesh.userData.partId, left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
    });
    expect(rectangles).toHaveLength(parts.length);
    for (const a of rectangles) {
        expect(a.left).toBeGreaterThan(-1); expect(a.right).toBeLessThan(1); expect(a.top).toBeGreaterThan(-1); expect(a.bottom).toBeLessThan(1);
        for (const b of rectangles) if (a.id !== b.id) expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `${a.id} overlaps ${b.id}`).toBe(true);
    }
    disposeScene(scene);
});
it('caps live contexts at two and prioritises the active visible model', () => {
    const visible = Array.from({ length: 20 }, (_, i) => 'model' + i);
    expect(liveModelIds(visible, ['model19', 'offscreen'])).toEqual(['model19', 'model0']);
    expect(liveModelIds(visible, visible)).toHaveLength(LIVE_MODEL_LIMIT);
    expect(liveModelIds([], ['model1'])).toEqual([]);
});
it('uses y-up primitive orientation and ray-picks the named part', () => {
    const scene = buildScene([{ ...parts[4], pos: [0, 0, 0], size: [1, 4, 1] }], 0);
    const mesh = scene.children.find(o => o instanceof THREE.Mesh)!;
    const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(4); expect(size.y).toBeCloseTo(1);
    const { camera } = sceneCamera(scene, 1, ENGINE_MODEL.camera), ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(), camera);
    expect(ray.intersectObjects(scene.children)[0].object.userData.partId).toBe('crankshaft');
    disposeScene(scene);
});
