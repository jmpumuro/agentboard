import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Op, PartInput } from 'contract';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, ArrowDownLeft, Bot, Box, Camera, Circle, Cone, Cylinder, Eye, EyeOff, Focus, Layers, Maximize2, Minimize2, Move3d, Palette, Pencil, Plus, Trash2, UnfoldVertical } from 'lucide-react';
import { Button, IconButton, Modal } from '../../../ui';
import type { Model, ModelView } from './view-state';
const COLORS = { gray: '#74818b', red: '#cf4e43', orange: '#d47a31', yellow: '#d5ac32', green: '#39856b', blue: '#447fbd', purple: '#8e61b0', white: '#e8e9e1' } as const;
type Popover = 'parts' | 'explode' | 'add' | 'color' | 'move' | null;
export function Scene3DSelectionBar({ model, view, onView, onOps, onAsk, busy }: { model: Model; view: ModelView; onView: (patch: Partial<ModelView>) => void; onOps: (ops: Op[]) => unknown; onAsk: () => void; busy: boolean }) {
    const [rename, setRename] = useState(false), [name, setName] = useState(''), [info, setInfo] = useState(''), [popover, setPopover] = useState<Popover>(null);
    const renameVersion = useRef(1);
    const rail = useRef<HTMLDivElement>(null), part = model.parts.find(p => p.id === view.selected);
    useEffect(() => {
        const outside = (e: PointerEvent) => { if (!rail.current?.contains(e.target as Node)) setPopover(null); };
        window.addEventListener('pointerdown', outside);
        return () => window.removeEventListener('pointerdown', outside);
    }, []);
    const update = (data: Partial<Omit<PartInput, 'id'>>) => part && onOps([{ op: 'part.update', id: model.id, partId: part.id, ifPartVersion: part.v, data }]);
    function toggle(next: Popover) { setPopover(current => current === next ? null : next); }
    function add(kind: PartInput['kind']) {
        const id = 'prt_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20);
        onOps([{ op: 'part.add', id: model.id, part: { id, kind, pos: [0, 0, 0], size: [2, 2, 2], color: 'blue', name: 'New ' + kind, info: '' } }]);
        onView({ selected: id }); setPopover(null);
    }
    const tool = (label: string, icon: ReactNode, action: () => void, disabled = false, pressed?: boolean) => <IconButton key={label} label={label} onClick={action} disabled={disabled} {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}>{icon}</IconButton>;
    return <div ref={rail} className="scene3d-rail" onPointerDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape' && popover) { e.stopPropagation(); setPopover(null); } }}>
        <div className="scene3d-rail-scroll" role="toolbar" aria-label="3D model tools" aria-orientation="vertical">
            {tool('Select model part', <Layers size={18}/>, () => toggle('parts'), false, popover === 'parts')}
            {tool('Pull apart model', <UnfoldVertical size={18}/>, () => toggle('explode'), false, popover === 'explode')}
            {tool('Add part', <Plus size={19}/>, () => toggle('add'), busy || model.parts.length >= 60, popover === 'add')}
            {part && <><i className="scene3d-rail-divider"/>
                {tool('Part colour', <Palette size={18}/>, () => toggle('color'), busy, popover === 'color')}
                {tool(view.hidden.includes(part.id) ? 'Unhide part' : 'Hide part', view.hidden.includes(part.id) ? <Eye size={18}/> : <EyeOff size={18}/>, () => onView({ hidden: view.hidden.includes(part.id) ? view.hidden.filter(id => id !== part.id) : [...view.hidden, part.id] }))}
                {tool(view.only === part.id ? 'Show all parts' : 'Only this part', <Focus size={18}/>, () => onView(view.only === part.id ? { only: null, hidden: [] } : { only: part.id, hidden: [] }), false, view.only === part.id)}
                {view.hidden.length > 0 && !view.only && tool('Show all parts', <Eye size={18}/>, () => onView({ only: null, hidden: [] }))}
                {tool('Move part', <Move3d size={18}/>, () => toggle('move'), busy, popover === 'move')}
                {tool('Bigger', <Maximize2 size={18}/>, () => update({ size: part.size.map(n => Math.min(100, n * 1.2)) as PartInput['size'] }), busy)}
                {tool('Smaller', <Minimize2 size={18}/>, () => update({ size: part.size.map(n => Math.max(.05, n / 1.2)) as PartInput['size'] }), busy)}
                {tool('Rename part', <Pencil size={18}/>, () => { renameVersion.current = part.v; setName(part.name); setInfo(part.info); setRename(true); setPopover(null); }, busy)}
                {tool('Delete part', <Trash2 size={18}/>, () => { onOps([{ op: 'part.delete', id: model.id, partId: part.id, ifPartVersion: part.v }]); onView({ selected: null }); setPopover(null); }, busy)}
            </>}
            <i className="scene3d-rail-divider"/>
            {tool('Ask agent about model', <Bot size={18}/>, onAsk)}
            {tool('Save default view', <Camera size={18}/>, () => onOps([{ op: 'update', id: model.id, ifVersion: model.version, data: { camera: view.camera, explode: view.explode } }]), busy)}
            {tool('Bring model to front', <ArrowUp size={18}/>, () => onOps([{ op: 'restack', ids: [model.id], to: 'front' }]), busy)}
            {tool('Send model to back', <ArrowDown size={18}/>, () => onOps([{ op: 'restack', ids: [model.id], to: 'back' }]), busy)}
            {tool('Delete model', <Trash2 size={18}/>, () => onOps([{ op: 'delete', id: model.id, ifVersion: model.version }]), busy)}
        </div>
        {popover && <div className="scene3d-tool-popover" role="group" aria-label="3D tool options">
            {popover === 'parts' && <label>Model part<select autoFocus aria-label="Model part" value={part?.id ?? ''} onChange={e => { onView({ selected: e.target.value || null }); setPopover(null); }}><option value="">Whole model</option>{model.parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
            {popover === 'explode' && <label className="scene3d-explode">Pull apart<input autoFocus aria-label="Pull apart" type="range" min="0" max="1" step=".01" value={view.explode} onChange={e => onView({ explode: Number(e.target.value) })}/><output>{Math.round(view.explode * 100)}%</output></label>}
            {popover === 'add' && <div className="scene3d-primitive-options">{([['box', Box], ['cylinder', Cylinder], ['sphere', Circle], ['cone', Cone]] as const).map(([kind, Icon]) => tool('Add ' + kind, <Icon size={20}/>, () => add(kind), busy))}</div>}
            {popover === 'color' && part && <div className="scene3d-colors" role="group" aria-label="Part colour">{Object.entries(COLORS).map(([color, value]) => <button key={color} title={color} className="scene3d-swatch" style={{ background: value }} aria-label={'Part color ' + color} aria-pressed={part.color === color} disabled={busy} onClick={() => update({ color: color as PartInput['color'] })}/>)}</div>}
            {popover === 'move' && part && <div className="scene3d-move-options">{([['Left', 0, -1, ArrowLeft], ['Right', 0, 1, ArrowRight], ['Up', 1, 1, ArrowUp], ['Down', 1, -1, ArrowDown], ['Near', 2, 1, ArrowUpRight], ['Far', 2, -1, ArrowDownLeft]] as const).map(([label, axis, step, Icon]) => tool('Move part ' + label.toLowerCase(), <Icon size={18}/>, () => update({ pos: part.pos.map((n, i) => Math.max(-100, Math.min(100, n + (i === axis ? step : 0)))) as PartInput['pos'] }), busy))}</div>}
        </div>}
        {rename && part && <Modal title="Name and explain this part" onClose={() => setRename(false)}><form onSubmit={e => { e.preventDefault(); onOps([{ op: 'part.update', id: model.id, partId: part.id, ifPartVersion: renameVersion.current, data: { name, info } }]); setRename(false); }}><label>Name<input required maxLength={60} value={name} onChange={e => setName(e.target.value)}/></label><label>What does it do?<textarea maxLength={300} value={info} onChange={e => setInfo(e.target.value)}/></label><Button className="primary" disabled={busy || !name.trim()}>Save part</Button></form></Modal>}
    </div>;
}
