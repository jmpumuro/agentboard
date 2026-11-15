import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildScene, disposeScene, sceneCamera } from 'contract/scene3d';
import type { Model, ModelView } from './view-state';
export default function Scene3DView({ model, view, onView, onStill, interactive }: { model: Model; view: ModelView; onView: (patch: Partial<ModelView>) => void; onStill: (src: string) => void; interactive: boolean }) {
    const host = useRef<HTMLDivElement>(null), callbacks = useRef({ onView, onStill });
    callbacks.current = { onView, onStill };
    const angles = useRef(view.camera), rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const update = useRef<() => void>(() => {}), sceneRef = useRef<THREE.Scene | null>(null), cameraRef = useRef<THREE.Camera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const start = useRef<{ x: number; y: number } | null>(null), pointers = useRef(new Set<number>()), pinching = useRef(false);
    useEffect(() => {
        // Board pinch may capture a pointer outside this view; release bookkeeping
        // must still complete before the next part tap.
        const release = (event: PointerEvent) => {
            pointers.current.delete(event.pointerId);
            if (!pointers.current.size) { pinching.current = false; start.current = null; }
        };
        document.addEventListener('pointerup', release); document.addEventListener('pointercancel', release);
        return () => { document.removeEventListener('pointerup', release); document.removeEventListener('pointercancel', release); };
    }, []);
    useEffect(() => {
        const node = host.current!;
        if (typeof WebGL2RenderingContext === 'undefined') { node.dataset.fallback = 'true'; return; }
        let renderer: THREE.WebGLRenderer;
        try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false }); }
        catch { node.dataset.fallback = 'true'; return; }
        rendererRef.current = renderer;
        renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
        node.appendChild(renderer.domElement);
        const controls = new OrbitControls(new THREE.OrthographicCamera(), renderer.domElement);
        controls.enableZoom = false; controls.enablePan = false; controls.enableDamping = false;
        controls.touches.ONE = THREE.TOUCH.ROTATE; controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
        controls.minPolarAngle = Math.PI / 2 - 1.5; controls.maxPolarAngle = Math.PI / 2 + 1.5;
        controlsRef.current = controls;
        let frame = 0;
        const render = () => { if (sceneRef.current && cameraRef.current && !renderer.getContext().isContextLost()) renderer.render(sceneRef.current, cameraRef.current); };
        const invalidate = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(render); };
        update.current = invalidate;
        controls.addEventListener('change', invalidate);
        const capture = () => {
            if (!cameraRef.current || !renderer.domElement.width || renderer.getContext().isContextLost()) return;
            render();
            try { callbacks.current.onStill(renderer.domElement.toDataURL('image/png')); } catch {}
            const offset = cameraRef.current.position.clone().sub(controls.target);
            angles.current = { yaw: Math.atan2(offset.x, offset.z), pitch: Math.atan2(offset.y, Math.hypot(offset.x, offset.z)) };
            callbacks.current.onView({ camera: angles.current });
        };
        controls.addEventListener('end', capture);
        const lost = (e: Event) => { e.preventDefault(); node.dataset.fallback = 'true'; };
        const restored = () => { delete node.dataset.fallback; invalidate(); };
        renderer.domElement.addEventListener('webglcontextlost', lost);
        renderer.domElement.addEventListener('webglcontextrestored', restored);
        const resize = new ResizeObserver(() => {
            const w = node.clientWidth, h = node.clientHeight;
            if (w && h) {
                renderer.setSize(w, h, false);
                if (sceneRef.current && cameraRef.current) {
                    const offset = cameraRef.current.position.clone().sub(controls.target);
                    const angles = { yaw: Math.atan2(offset.x, offset.z), pitch: Math.atan2(offset.y, Math.hypot(offset.x, offset.z)) };
                    const { camera, center } = sceneCamera(sceneRef.current, w / h, angles);
                    cameraRef.current = camera; controls.object = camera; controls.target.copy(center); controls.update();
                }
                update.current();
            }
        }); resize.observe(node);
        return () => {
            capture(); cancelAnimationFrame(frame); resize.disconnect(); controls.dispose();
            renderer.domElement.removeEventListener('webglcontextlost', lost); renderer.domElement.removeEventListener('webglcontextrestored', restored);
            renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); rendererRef.current = null; controlsRef.current = null;
        };
    }, []);
    useEffect(() => { if (controlsRef.current) controlsRef.current.enabled = interactive; }, [interactive]);
    useEffect(() => {
        const renderer = rendererRef.current, controls = controlsRef.current, node = host.current!;
        if (!renderer || !controls) return;
        const hidden = new Set(view.hidden);
        if (view.only) for (const p of model.parts) if (p.id !== view.only) hidden.add(p.id);
        const scene = buildScene(model.parts, view.explode, hidden);
        const { camera, center } = sceneCamera(scene, Math.max(1, node.clientWidth) / Math.max(1, node.clientHeight), angles.current);
        sceneRef.current = scene; cameraRef.current = camera;
        controls.object = camera; controls.target.copy(center); controls.enabled = interactive; controls.update();
        renderer.setSize(Math.max(1, node.clientWidth), Math.max(1, node.clientHeight), false);
        renderer.render(scene, camera);
        try { callbacks.current.onStill(renderer.domElement.toDataURL('image/png')); } catch {}
        return () => { sceneRef.current = null; cameraRef.current = null; disposeScene(scene); };
    }, [model.parts, view.explode, view.hidden, view.only]);
    return <div className="scene3d-live" ref={host} onPointerDown={e => { pointers.current.add(e.pointerId); if (pointers.current.size > 1) pinching.current = true; start.current = { x: e.clientX, y: e.clientY }; }} onPointerCancel={() => { pointers.current.clear(); pinching.current = false; start.current = null; }} onPointerUp={e => {
        pointers.current.delete(e.pointerId);
        if (pinching.current) { if (!pointers.current.size) pinching.current = false; start.current = null; return; }
        if (!interactive || !start.current || Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 5) return;
        const scene = sceneRef.current, camera = cameraRef.current;
        if (!scene || !camera) return;
        const r = host.current!.getBoundingClientRect(), ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
        const hit = ray.intersectObjects(scene.children).find(hit => hit.object instanceof THREE.Mesh && hit.object.userData.partId);
        callbacks.current.onView({ selected: hit?.object.userData.partId ?? null }); start.current = null;
    }} />;
}
