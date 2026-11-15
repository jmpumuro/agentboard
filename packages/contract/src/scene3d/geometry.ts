import * as THREE from 'three';
import type { Part } from '../index';
export const PART_COLORS = { gray: '#74818b', red: '#cf4e43', orange: '#d47a31', yellow: '#d5ac32', green: '#39856b', blue: '#447fbd', purple: '#8e61b0', white: '#e8e9e1' } as const;
export function partPosition(part: Part, parts: Part[], explode: number): [number, number, number] {
    const center = parts.reduce((v, p) => v.map((n, i) => n + p.pos[i] / Math.max(1, parts.length)), [0, 0, 0]);
    let out = part.out;
    if (!out) {
        const direction = new THREE.Vector3(...part.pos).sub(new THREE.Vector3(...center));
        // A part exactly at the centre still needs to be revealed.
        if (direction.lengthSq() < .0001) direction.set(0, 1, 0);
        direction.normalize().multiplyScalar(Math.max(...part.size) * 2 + 2);
        out = direction.toArray();
    }
    return part.pos.map((n, i) => n + out![i] * explode) as [number, number, number];
}
export function buildScene(parts: Part[], explode: number, hidden: Set<string> = new Set()) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f3f5f0');
    scene.add(new THREE.AmbientLight(0xffffff, .65));
    const light = new THREE.DirectionalLight(0xffffff, .85); light.position.set(5, 8, 10); scene.add(light);
    for (const p of parts) {
        if (hidden.has(p.id)) continue;
        const geometry = p.kind === 'box' ? new THREE.BoxGeometry(1, 1, 1) : p.kind === 'sphere' ? new THREE.SphereGeometry(.5, 16, 10) : p.kind === 'cylinder' ? new THREE.CylinderGeometry(.5, .5, 1, 16) : new THREE.ConeGeometry(.5, 1, 16);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: PART_COLORS[p.color] }));
        // Scale before orienting: size describes the solid before its height axis changes.
        geometry.scale(...p.size);
        if (p.axis === 'x') geometry.rotateZ(-Math.PI / 2);
        if (p.axis === 'z') geometry.rotateX(Math.PI / 2);
        mesh.position.set(...partPosition(p, parts, explode)); mesh.userData.partId = p.id;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 40), new THREE.LineBasicMaterial({ color: '#435047', linewidth: .7 }));
        mesh.add(edges);
        scene.add(mesh);
    }
    return scene;
}
export function sceneCamera(scene: THREE.Scene, aspect: number, angles: { yaw: number; pitch: number }) {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene), center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const radius = box.isEmpty() ? 2 : Math.max(.5, box.getBoundingSphere(new THREE.Sphere()).radius);
    const height = radius * 1.2 * Math.max(1, 1 / aspect);
    const camera = new THREE.OrthographicCamera(-height * aspect, height * aspect, height, -height, .01, radius * 12 + 20);
    const distance = radius * 4 + 5;
    camera.position.set(center.x + Math.sin(angles.yaw) * Math.cos(angles.pitch) * distance, center.y + Math.sin(angles.pitch) * distance, center.z + Math.cos(angles.yaw) * Math.cos(angles.pitch) * distance);
    camera.lookAt(center); camera.updateMatrixWorld(true);
    const projected = new THREE.Box3();
    scene.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        const box = new THREE.Box3().setFromObject(o);
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
    });
    if (!projected.isEmpty()) {
        const size = projected.getSize(new THREE.Vector3()), offset = projected.getCenter(new THREE.Vector3());
        const halfHeight = Math.max(.5, size.y / 2, size.x / (2 * aspect)) * 1.12;
        const shift = new THREE.Vector3(offset.x, offset.y, 0).applyQuaternion(camera.quaternion);
        center.add(shift); camera.position.add(shift);
        camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight;
        camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    }
    return { camera, center };
}
export function disposeScene(scene: THREE.Scene) {
    scene.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) { o.geometry.dispose(); for (const material of Array.isArray(o.material) ? o.material : [o.material]) material.dispose(); } });
}
