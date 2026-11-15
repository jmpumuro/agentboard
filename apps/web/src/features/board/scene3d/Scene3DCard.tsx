import { ModuleBoundary } from '../../../ui/ModuleBoundary';
import { lazy, Suspense, useState } from 'react';
import { Box } from 'lucide-react';
import type { Model, ModelView } from './view-state';
const Scene3DView = lazy(() => import('./Scene3DView'));
export function Scene3DCard({ model, view, onView, live, onActivate, interactive, onTouchStart, stillUrl }: { stillUrl?: string; model: Model; view: ModelView; onView: (patch: Partial<ModelView>) => void; live: boolean; onActivate: () => void; interactive: boolean; onTouchStart: (e: React.PointerEvent) => void }) {
    const [still, setStill] = useState<{ src: string; version: number } | null>(null);
    const src = still?.version === model.version ? still.src : stillUrl;
    const part = model.parts.find(p => p.id === view.selected);
    return <div className="scene3d-card">
        <div className="scene3d-title"><Box size={15}/><span>{model.text}</span><small>3D</small></div>
        <div className="scene3d-viewport" role="group" tabIndex={0} aria-label={`${model.text}. Parts: ${model.parts.map(p => p.name).join(', ') || 'No parts'}`} onFocus={onActivate} onPointerDown={e => {
            if (!interactive) return;
            onActivate(); e.stopPropagation();
            if (e.pointerType === 'touch') onTouchStart(e);
        }} onDoubleClick={e => e.stopPropagation()}>
            {src ? <img className="scene3d-still" src={src} alt=""/> : <div className="scene3d-empty">{model.parts.length ? 'Select to explore this model' : 'Add a part to start building'}</div>}
            {live && <ModuleBoundary><Suspense fallback={<span className="scene3d-loading">Loading 3D view…</span>}><Scene3DView model={model} view={view} onView={onView} onStill={src => setStill({ src, version: model.version })} interactive={interactive}/></Suspense></ModuleBoundary>}
        </div>
        <div className="scene3d-caption" aria-live="polite">{part ? <><strong>{part.name}</strong><span>{part.info}</span></> : <span>{model.parts.length} named parts · Drag to turn · Tap a part to learn</span>}</div>
    </div>;
}
