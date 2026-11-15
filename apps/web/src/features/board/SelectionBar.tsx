import type { Element, Op } from 'contract';
import { Pencil, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { Button, IconButton } from '../../ui';
const colors = ['yellow', 'blue', 'green', 'pink', 'purple', 'white'] as const;
export function SelectionBar({ elements, onOps, onEdit, onDelete, children, busy = false }: {
    children?: React.ReactNode;
    busy?: boolean;
    elements: Element[];
    onOps: (ops: Op[]) => unknown;
    onEdit: (element: Element) => void;
    onDelete: () => void;
}) {
    if (!elements.length)
        return null;
    const first = elements[0];
    if (elements.length === 1 && first.type === 'scene3d' && children) return <>{children}</>;
    return <div className="selection-toolbar" onPointerDown={e => e.stopPropagation()} aria-label="Selection actions"><fieldset disabled={busy} className="selection-controls">
  {elements.some(e => 'color' in e) && colors.map(color => <button key={color} aria-label={'Color ' + color} aria-pressed={elements.filter(e => 'color' in e).every(e => 'color' in e && e.color === color)} className={'swatch ' + color} onClick={() => onOps(elements.filter(e => 'color' in e).map(e => ({ op: 'update', id: e.id, ifVersion: e.version, data: { color } })))}/>)}
  {first.type === 'shape' && <select aria-label="Shape kind" value={first.kind} onChange={e => onOps([{ op: 'update', id: first.id, ifVersion: first.version, data: { kind: e.target.value as 'rect' | 'rounded' | 'ellipse' | 'diamond' } }])}>{['rect', 'rounded', 'ellipse', 'diamond'].map(k => <option key={k}>{k}</option>)}</select>}
  {first.type === 'text' && <select aria-label="Text size" value={first.size} onChange={e => onOps([{ op: 'update', id: first.id, ifVersion: first.version, data: { size: e.target.value as 'small' | 'body' | 'large' | 'title' } }])}>{['small', 'body', 'large', 'title'].map(k => <option key={k}>{k}</option>)}</select>}
  {children}
  {first.type === 'scene3d' ? null : first.type === 'embed' ? <Button aria-label="Refine mockup" onClick={() => onEdit(first)}><Pencil size={14}/>Refine design</Button> : first.type === 'drawing' ? <Button aria-label="Describe drawing" onClick={() => onEdit(first)}><Pencil size={14}/>Describe</Button> : <IconButton label={first.type === 'arrow' ? 'Edit label' : 'Edit text'} onClick={() => onEdit(first)}><Pencil size={15}/></IconButton>}
  <IconButton label="Bring to front" onClick={() => onOps([{ op: 'restack', ids: elements.map(e => e.id), to: 'front' }])}><ArrowUp size={15}/></IconButton><IconButton label="Send to back" onClick={() => onOps([{ op: 'restack', ids: elements.map(e => e.id), to: 'back' }])}><ArrowDown size={15}/></IconButton><IconButton label="Delete selected elements" onClick={onDelete}><Trash2 size={15}/></IconButton>
 </fieldset></div>;
}
