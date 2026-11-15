import { Scene3DCard } from './scene3d/Scene3DCard';
import { Scene3DSelectionBar } from './scene3d/Scene3DSelectionBar';
import { initialView, liveModelIds, type Model, type ModelView } from './scene3d/view-state';
import { useQuery } from '@tanstack/react-query';
import type { ActivityEvent, Agent, Board, Element as BoardElement, Claim, DesignTarget, ElementInput, Op, Run } from 'contract';
import { STARTER_EMBED, STARTER_SCENE } from 'contract';
import { Activity, ArrowLeft, Bot, ChevronDown, Code2, Flag, Maximize, Minus, Plus, Redo2, StickyNote, Undo2, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import { qc } from '../../api/query';
import { applyLive, bounds, nearViewport, overlayBatches, type Snapshot } from '../../board-engine';
import { absoluteStrokes, fitStrokes, gridSpacing, samplePoint } from '../../board-engine/drawing';
import { Button, CopyCode, IconButton, Load, Modal, Stamp, useToast } from '../../ui';
import { BOARD_TOOLS, BoardToolbar } from './BoardToolbar';
import { DrawingView } from './DrawingView';
import { EmbedView } from './embeds/EmbedView';
import { useCanvasSize } from './embeds/useCanvasSize';
import { SelectionBar } from './SelectionBar';
const tools = BOARD_TOOLS;
const colors = ['yellow', 'blue', 'green', 'pink', 'purple', 'white'] as const;
export function Canvas({ userId }: {
    userId: string;
}) {
    const navigate = useNavigate();
    const { boardId: id } = useParams() as {
        boardId: string;
    }, toast = useToast(), location = useLocation();
    const [loaded, setLoaded] = useState(false);
    const [snapshot, setSnapshot] = useState<Snapshot>({ seq: 0, order: [], elements: [] }), snapshotRef = useRef(snapshot);
    snapshotRef.current = snapshot;
    const boardQ = useQuery<Board>({ queryKey: ['board', id], queryFn: () => api('/boards/' + id) }), agents = useQuery<{
        items: Agent[];
    }>({ queryKey: ['agents'], queryFn: () => api('/agents') });
    const [pending, setPending] = useState<Op[][]>([]), [tool, setTool] = useState('select'), [selected, setSelected] = useState<string[]>([]), [pan, setPan] = useState({ x: 70, y: 70 }), [zoom, setZoom] = useState(1), [chat, setChat] = useState(false), [activity, setActivity] = useState(false), [agentView, setAgentView] = useState<string | null>(null), [connected, setConnected] = useState(false), [claims, setClaims] = useState<Claim[]>([]), [presence, setPresence] = useState<{
        actor: {
            id: string;
            name: string;
            kind: string;
        };
    }[]>([]), [runs, setRuns] = useState<Run[]>([]), [editing, setEditing] = useState<string | null>(null), [editText, setEditText] = useState(''), [conflict, setConflict] = useState<any>(null), [rename, setRename] = useState(Boolean((location.state as any)?.rename)), [box, setBox] = useState<{
        x: number;
        y: number;
        w: number;
        h: number;
    } | null>(null), [arrowStart, setArrowStart] = useState<string | null>(null), [history, setHistory] = useState<number[]>([]), [redo, setRedo] = useState<number[]>([]), [dragPositions, setDragPositions] = useState<Record<string, {
        x: number;
        y: number;
        w?: number;
        h?: number;
    }>>({});
    const touches = useRef(new Map<number, {
        x: number;
        y: number;
    }>()), pinch = useRef<any>(null);
    const [designTarget, setDesignTarget] = useState<DesignTarget | undefined>();
    const [modelViews, setModelViews] = useState<Record<string, ModelView>>({}), initialViews = useRef(new Map<string, ModelView>());
    const [activeModel, setActiveModel] = useState<string | null>(null), [committing, setCommitting] = useState(0), commitQueue = useRef<Promise<unknown>>(Promise.resolve());
    const [spaceHeld, setSpaceHeld] = useState(false);
    function modelView(model: Model) { if (!initialViews.current.has(model.id)) initialViews.current.set(model.id, initialView(model)); return modelViews[model.id] ?? initialViews.current.get(model.id)!; }
    function changeModelView(model: Model, patch: Partial<ModelView>) { setModelViews(all => ({ ...all, [model.id]: { ...modelView(model), ...patch } })); }
    function askDesign(element?: BoardElement) {
        if (element?.type === 'embed' || element?.type === 'scene3d') setDesignTarget({ elementId: element.id });
        setChat(true); setTool('select');
    }
    const [draftStroke, setDraftStroke] = useState<number[]>([]), [descriptionId, setDescriptionId] = useState<string | null>(null), [description, setDescription] = useState('');
    const drawingSessions = useRef(new Map<number, string>()), drawingGeneration = useRef(0), drawingSession = useRef<string | null>(null), strokeQueue = useRef<Promise<unknown>>(Promise.resolve()), titleRef = useRef<HTMLInputElement>(null);
    const root = useRef<HTMLDivElement>(null), space = useRef(false), drag = useRef<any>(null), socket = useRef<WebSocket | null>(null);
    const canvasSize = useCanvasSize(root, !!boardQ.data);
    const viewport = { x: -pan.x / zoom, y: -pan.y / zoom, w: canvasSize.width / zoom, h: canvasSize.height / zoom };
    const view = overlayBatches(snapshot, pending);
    const elements = view.elements.map(e => dragPositions[e.id] ? { ...e, ...dragPositions[e.id] } as BoardElement : e);
    const map = Object.fromEntries(elements.map(e => [e.id, e]));
    const chosen = selected.map(id => map[id]).filter(Boolean);
    const selectedOne = chosen[0];
    const liveModels = liveModelIds(elements.filter((e): e is Model => e.type === 'scene3d' && nearViewport(e, viewport, 0)).map(e => e.id), [...(activeModel ? [activeModel] : []), ...selected]);
    const refetch = useCallback(async () => { const data = await api<Snapshot>(`/boards/${id}/elements`); setSnapshot(data); setLoaded(true); snapshotRef.current = data; return data; }, [id]);
    useEffect(() => {
        void refetch().catch(e => toast(e.message));
        api(`/boards/${id}/runs`).then(d => setRuns(current => [...current, ...d.items.filter((run: Run) => !current.some(r => r.id === run.id))])).catch(() => { });
        let dead = false, retry: ReturnType<typeof setTimeout>, attempt = 0;
        function connect() {
            if (dead)
                return;
            const ws = new WebSocket(`${locationProtocol()}//${window.location.host}/api/v1/boards/${id}/live?sinceSeq=${snapshotRef.current.seq}`);
            socket.current = ws;
            ws.onopen = () => { setConnected(true); attempt = 0; };
            ws.onmessage = ev => {
                const msg = JSON.parse(ev.data);
                if (msg.t === 'ops') {
                    setSnapshot(s => {
                        const result = applyLive(s, msg);
                        if (result.resync)
                            void refetch();
                        return result.state;
                    });
                }
                if (msg.t === 'resync')
                    void refetch();
                if (msg.t === 'hello') {
                    setClaims(msg.claims);
                    setPresence(msg.presence);
                }
                if (msg.t === 'presence')
                    setPresence(msg.presence);
                if (msg.t === 'claim')
                    setClaims(c => [...c.filter(x => x.id !== msg.claim.id), msg.claim]);
                if (msg.t === 'claimEnd')
                    setClaims(c => c.filter(x => x.id !== msg.claimId));
                if (msg.t === 'board')
                    qc.setQueryData(['board', id], msg.board);
                if (msg.t === 'run')
                    setRuns(r => [msg.run, ...r.filter(x => x.id !== msg.run.id)]);
            };
            ws.onclose = () => {
                setConnected(false);
                if (!dead)
                    retry = setTimeout(connect, Math.min(10000, 500 * 2 ** attempt++));
            };
        }
        connect();
        return () => { dead = true; clearTimeout(retry); socket.current?.close(); };
    }, [id, refetch]);
    function locationProtocol() { return window.location.protocol === 'https:' ? 'wss:' : 'ws:'; }
    function commit(ops: Op[], record = true, retryGeometry = true): Promise<boolean> {
        setCommitting(n => n + 1);
        setPending(batches => [...batches, ops]);
        const next = commitQueue.current.then(() => performCommit(ops, record, retryGeometry));
        commitQueue.current = next.catch(() => false);
        return next.finally(() => setCommitting(n => n - 1));
    }
    function dropHeadBatch() {
        setPending(batches => batches.slice(1));
    }
    async function performCommit(ops: Op[], record = true, retryGeometry = true): Promise<boolean> {
        try {
            const r = await api(`/boards/${id}/ops`, 'POST', { ops }, { 'Idempotency-Key': crypto.randomUUID() });
            await refetch();
            if (record) {
                setHistory(h => [...h, r.seq]);
                setRedo([]);
            }
            dropHeadBatch();
            return true;
        }
        catch (e) {
            dropHeadBatch();
            if (e instanceof ApiError && e.code === 'version_conflict') {
                await refetch();
                if (ops.length === 1 && ops[0].op === 'update') {
                    const op = ops[0];
                    if ('text' in op.data || 'label' in op.data) {
                        setConflict({ op, current: e.details.current });
                        return false;
                    }
                    if (retryGeometry && Object.keys(op.data).every(key => ['x', 'y', 'w', 'h'].includes(key))) {
                        const retryOps = [{ ...op, ifVersion: e.details.current.version }];
                        setPending(batches => [retryOps, ...batches]);
                        return performCommit(retryOps, record, false);
                    }
                }
            }
            toast((e as Error).message);
            return false;
        }
    }
    function place(type: string, x: number, y: number) {
        if (type === 'embed') {
            setDesignTarget({ place: { x, y } });
            setChat(true);
            setTool('select');
            return;
        }
        createElement(type, x, y);
    }
    function createElement(type: string, x: number, y: number) {
        const elId = 'el_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20);
        const data: ElementInput = type === 'scene3d' ? { ...STARTER_SCENE, x, y } : type === 'embed' ? { ...STARTER_EMBED, x, y } : type === 'text' ? { type: 'text', x, y, text: 'New text', size: 'body' } : type === 'shape' ? { type: 'shape', x, y, w: 210, h: 170, text: '', color: 'yellow', kind: 'rounded' } : { type: 'note', x, y, w: 210, h: 170, text: '', color: 'yellow' };
        void commit([{ op: 'create', id: elId, data }]).then(ok => {
            if (ok) {
                setSelected([elId]);
                if (type === 'embed' || type === 'scene3d') {
                    setDesignTarget({ elementId: elId }); setChat(true); setActiveModel(elId);
                    return;
                }
                setEditing(elId);
                setEditText(type === 'text' ? 'New text' : '');
            }
        });
        setTool('select');
    }
    const initiallyFit = useRef(false);
    useEffect(() => {
        if (root.current && loaded && !initiallyFit.current) {
            initiallyFit.current = true;
            if (snapshot.elements.length)
                fit(snapshot.elements);
        }
    }, [loaded, snapshot.seq, boardQ.data]);
    function fit(list = elements) {
        const rect = root.current?.getBoundingClientRect();
        if (!rect)
            return;
        const b = bounds(list), z = Math.max(.25, Math.min(1.2, (rect.width - 120) / (b.w + 70), (rect.height - 180) / (b.h + 70)));
        setZoom(z);
        setPan({ x: (rect.width - b.w * z) / 2 - b.x * z, y: (rect.height - b.h * z) / 2 - b.y * z - 20 });
    }
    function coord(e: {
        clientX: number;
        clientY: number;
    }) { const r = root.current!.getBoundingClientRect(); return { x: (e.clientX - r.left - pan.x) / zoom, y: (e.clientY - r.top - pan.y) / zoom }; }
    function pick(next: string) {
        drawingGeneration.current++;
        drawingSession.current = null;
        setTool(next);
        setChat(false); setDesignTarget(undefined);
        setArrowStart(null);
        if (next !== 'select' && next !== 'hand')
            toast(next === 'draw' ? 'Drag to draw. Consecutive strokes join one sketch.' : next === 'arrow' ? 'Tap one element, then another to connect them.' : `Tap the canvas to add ${next === 'shape' ? 'a shape' : next === 'note' ? 'a note' : next === 'embed' ? 'a design' : next === 'scene3d' ? 'a 3D model' : 'text'}.`);
    }
    function startElement(e: React.PointerEvent, el: BoardElement, resize = false) {
        if (editing === el.id)
            return;
        e.stopPropagation();
        if (tool === 'draw') {
            startCanvas(e, true);
            return;
        }
        if (tool === 'arrow' && el.type !== 'arrow') {
            if (!arrowStart) {
                setArrowStart(el.id);
                setSelected([el.id]);
            }
            else if (arrowStart !== el.id) {
                void commit([{ op: 'create', data: { type: 'arrow', x: 0, y: 0, from: arrowStart, to: el.id } }]);
                setArrowStart(null);
                setTool('select');
            }
            return;
        }
        if (tool === 'hand' || space.current) {
            startCanvas(e, true);
            return;
        }
        const ids = e.shiftKey ? (selected.includes(el.id) ? selected.filter(id => id !== el.id) : [...selected, el.id]) : selected.includes(el.id) ? selected : [el.id];
        setSelected(ids);
        if (el.type === 'arrow')
            return;
        const positions = ids.map(id => map[id]).filter(e => e && e.type !== 'arrow');
        drag.current = { kind: resize ? 'resize' : 'move', start: { x: e.clientX, y: e.clientY }, els: positions.map(e => ({ ...e })), pointer: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
    }
    function startCanvas(e: React.PointerEvent, force = false) {
        if (e.button !== 0 && e.button !== 1)
            return;
        if (!force && e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('world'))
            return;
        if (e.pointerType === 'touch') {
            touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (touches.current.size === 2) {
                const [a, b] = [...touches.current.values()];
                const rect = root.current!.getBoundingClientRect();
                pinch.current = { distance: Math.hypot(b.x - a.x, b.y - a.y), zoom, pan: { ...pan }, center: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top } };
                drag.current = null;
                setDraftStroke([]);
                e.currentTarget.setPointerCapture(e.pointerId);
                return;
            }
        }
        const pt = coord(e);
        if (tool === 'draw' && !space.current && e.button !== 1) {
            setSelected([]);
            drag.current = { kind: 'draw', points: [pt.x, pt.y], generation: drawingGeneration.current };
            setDraftStroke([pt.x, pt.y]);
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
        }
        if (['note', 'text', 'shape', 'embed', 'scene3d'].includes(tool)) {
            place(tool, pt.x, pt.y);
            return;
        }
        if (tool === 'arrow') {
            toast('Choose an element to start the arrow.');
            return;
        }
        if (tool === 'hand' || space.current || e.button === 1 || e.pointerType === 'touch') {
            drag.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, pan: { ...pan } };
        }
        else {
            setSelected([]);
            drag.current = { kind: 'box', point: pt };
            setBox({ x: pt.x, y: pt.y, w: 0, h: 0 });
        }
        e.currentTarget.setPointerCapture(e.pointerId);
    }
    function move(e: React.PointerEvent) {
        if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
            touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (touches.current.size === 2 && pinch.current) {
                const [a, b] = [...touches.current.values()], p = pinch.current, rect = root.current!.getBoundingClientRect();
                const next = Math.max(.25, Math.min(2, p.zoom * Math.hypot(b.x - a.x, b.y - a.y) / p.distance));
                setZoom(next);
                setPan({ x: (a.x + b.x) / 2 - rect.left - (p.center.x - p.pan.x) * next / p.zoom, y: (a.y + b.y) / 2 - rect.top - (p.center.y - p.pan.y) * next / p.zoom });
                return;
            }
        }
        const d = drag.current;
        if (!d)
            return;
        if (d.kind === 'draw') {
            d.points = samplePoint(d.points, coord(e), zoom);
            setDraftStroke(d.points);
            return;
        }
        if (d.kind === 'pan') {
            setPan({ x: d.pan.x + e.clientX - d.start.x, y: d.pan.y + e.clientY - d.start.y });
            return;
        }
        if (d.kind === 'box') {
            const p = coord(e);
            setBox({ x: Math.min(p.x, d.point.x), y: Math.min(p.y, d.point.y), w: Math.abs(p.x - d.point.x), h: Math.abs(p.y - d.point.y) });
            return;
        }
        const dx = (e.clientX - d.start.x) / zoom, dy = (e.clientY - d.start.y) / zoom;
        setDragPositions(Object.fromEntries(d.els.map((el: BoardElement) => [el.id, d.kind === 'resize' && 'w' in el ? { x: el.x, y: el.y, w: Math.max(20, Math.min(4000, el.w + dx)), h: Math.max(20, Math.min(4000, el.h + dy)) } : { x: Math.max(-100000, Math.min(100000, el.x + dx)), y: Math.max(-100000, Math.min(100000, el.y + dy)) }])));
    }
    function end(e: React.PointerEvent) {
        touches.current.delete(e.pointerId);
        if (pinch.current) {
            pinch.current = null;
            drag.current = null;
            return;
        }
        const d = drag.current;
        drag.current = null;
        if (!d)
            return;
        if (d.kind === 'draw') {
            setDraftStroke([]);
            const points = d.points;
            const generation = d.generation;
            strokeQueue.current = strokeQueue.current.then(async () => {
                const latest = await refetch();
                const existingId = drawingSessions.current.get(generation);
                const existing = existingId && latest.elements.find(el => el.id === existingId && el.type === 'drawing');
                const data = fitStrokes([...(existing && existing.type === 'drawing' ? absoluteStrokes(existing) : []), points], existing && existing.type === 'drawing' ? existing.text : 'Hand drawing');
                const elementId = existing ? existing.id : 'el_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20);
                const ok = await commit(existing ? [{ op: 'update', id: elementId, ifVersion: existing.version, data: { x: data.x, y: data.y, w: data.w, h: data.h, vw: data.vw, vh: data.vh, strokes: data.strokes } }] : [{ op: 'create', id: elementId, data }], true, false);
                if (ok) {
                    drawingSessions.current.set(generation, elementId);
                    if (generation === drawingGeneration.current) {
                        drawingSession.current = elementId;
                        setSelected([elementId]);
                    }
                }
            }).catch(e => toast((e as Error).message));
            return;
        }
        if (d.kind === 'box') {
            if (box)
                setSelected(elements.filter(e => e.type !== 'arrow' && e.x >= box.x && e.y >= box.y && e.x <= box.x + box.w && e.y <= box.y + box.h).map(e => e.id));
            setBox(null);
        }
        if (d.kind === 'move' || d.kind === 'resize') {
            const ops = d.els.filter((e: BoardElement) => dragPositions[e.id]).map((e: BoardElement) => ({ op: 'update', id: e.id, ifVersion: e.version, data: dragPositions[e.id] } as Op));
            if (ops.length)
                void commit(ops);
            setDragPositions({});
        }
    }
    function edit(el: BoardElement) {
        if (el.type === 'embed' || el.type === 'scene3d') {
            askDesign(el);
            return;
        }
        if (el.type === 'drawing')
            return;
        setEditing(el.id);
        setEditText(el.type === 'arrow' ? el.label || '' : el.text);
    }
    async function finishEdit() {
        if (!editing)
            return;
        const el = map[editing];
        setEditing(null);
        if (!el)
            return;
        const value = editText;
        if (el.type === 'text' && !value.trim()) {
            await commit([{ op: 'delete', id: el.id, ifVersion: el.version }]);
            return;
        }
        if (value !== (el.type === 'arrow' ? el.label || '' : el.text))
            await commit([{ op: 'update', id: el.id, ifVersion: el.version, data: el.type === 'arrow' ? { label: value } : { text: value } }]);
    }
    function remove() {
        if (chosen.length)
            void commit(chosen.map(e => ({ op: 'delete', id: e.id, ifVersion: e.version })));
        setSelected([]);
    }
    async function undoAction(isRedo = false) {
        const list = isRedo ? redo : history;
        if (!list.length)
            return;
        try {
            const seq = list.at(-1)!;
            const r = await api(`/boards/${id}/batches/${seq}/revert`, 'POST');
            if (isRedo) {
                setRedo(h => h.slice(0, -1));
                setHistory(h => [...h, r.seq]);
            }
            else {
                setHistory(h => h.slice(0, -1));
                setRedo(h => [...h, r.seq]);
            }
            await refetch();
        }
        catch (e) {
            toast((e as Error).message);
        }
    }
    useEffect(() => {
        function down(e: KeyboardEvent) {
            if ((e.target as HTMLElement).matches('input,textarea,select,[contenteditable]'))
                return;
            if (e.key === ' ') {
                space.current = true; setSpaceHeld(true);
                e.preventDefault();
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault();
                void undoAction(e.shiftKey);
                return;
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && !committing) {
                e.preventDefault();
                if (selectedOne?.type === 'scene3d') { const part = selectedOne.parts.find(p => p.id === modelView(selectedOne).selected); if (part) { void commit([{ op: 'part.delete', id: selectedOne.id, partId: part.id, ifPartVersion: part.v }]); changeModelView(selectedOne, { selected: null }); } else remove(); } else remove();
            }
            if (e.key === 'Escape') {
                setSelected([]);
                pick('select');
                setChat(false);
            }
            if (e.key === 'Enter' && selectedOne)
                edit(selectedOne);
            if (e.key.startsWith('Arrow') && chosen.length) {
                e.preventDefault();
                const step = e.shiftKey ? 10 : 1;
                void commit(chosen.filter(e => e.type !== 'arrow').map(el => ({ op: 'update', id: el.id, ifVersion: el.version, data: { x: el.x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0), y: el.y + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0) } })));
            }
            if (!e.metaKey && !e.ctrlKey) {
                const item = tools.find(t => t[3].toLowerCase() === e.key.toLowerCase());
                if (item)
                    pick(item[0]);
            }
        }
        function up(e: KeyboardEvent) {
            if (e.key === ' ') { space.current = false; setSpaceHeld(false); }
        }
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    });
    useEffect(() => {
        const node = root.current;
        if (!node)
            return;
        const wheel = (e: WheelEvent) => {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                const r = node.getBoundingClientRect(), next = Math.min(2, Math.max(.25, zoom * Math.exp(-e.deltaY * .005)));
                const x = e.clientX - r.left, y = e.clientY - r.top;
                setPan({ x: x - (x - pan.x) * next / zoom, y: y - (y - pan.y) * next / zoom });
                setZoom(next);
            }
            else
                setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
        };
        node.addEventListener('wheel', wheel, { passive: false });
        return () => node.removeEventListener('wheel', wheel);
    }, [zoom, pan, boardQ.data]);
    if (boardQ.isPending || boardQ.error)
        return <Load error={boardQ.error} refetch={boardQ.refetch}/>;
    return <div className="board-screen"><header className="board-header"><button type="button" className="icon-btn board-back" aria-label="Back to boards" onPointerDown={e => e.preventDefault()} onClick={async () => {
            try {
                await finishEdit();
                if (rename && titleRef.current?.value.trim())
                    await api('/boards/' + id, 'PATCH', { title: titleRef.current.value.trim() });
                await qc.invalidateQueries({ queryKey: ['boards'] });
                navigate('/boards');
            }
            catch (e) {
                toast((e as Error).message);
            }
        }}><ArrowLeft size={19}/></button><span className="header-divider"/>{rename ? <input ref={titleRef} className="board-title-input" autoFocus defaultValue={boardQ.data.title} aria-label="Board title" maxLength={120} onFocus={e => e.target.select()} onBlur={async (e) => {
                setRename(false);
                if (e.target.value.trim())
                    try {
                        await api('/boards/' + id, 'PATCH', { title: e.target.value.trim() });
                        boardQ.refetch();
                    }
                    catch (e) {
                        toast((e as Error).message);
                    }
            }} onKeyDown={e => {
                if (e.key === 'Enter')
                    e.currentTarget.blur();
            }}/> : <button className="board-title" onClick={() => setRename(true)}>{boardQ.data.title}<ChevronDown size={14}/></button>}<span className={'live-status ' + (connected ? '' : 'offline')}><span className="status-dot"/>{connected ? 'Live' : 'Reconnecting'}</span><div className="header-right"><div className="presence">{presence.filter((p, i, all) => all.findIndex(x => x.actor.id === p.actor.id) === i).map(p => <Stamp key={p.actor.id} name={p.actor.name} kind={p.actor.kind}/>)}</div><Button onClick={async () => { const d = await api(`/boards/${id}/digest`); setAgentView(d.text); }} title="The exact text an agent reads"><Code2 size={16}/><span>Agent view</span></Button><Button className={activity ? 'active' : ''} onClick={() => setActivity(!activity)}><Activity size={16}/><span>Activity</span></Button></div></header>
 <div className={'canvas ' + (tool === 'hand' ? 'panning' : tool === 'draw' ? 'drawing-mode' : '')} ref={root} onPointerDown={startCanvas} onPointerMove={move} onPointerUp={end} onPointerCancel={e => { touches.current.delete(e.pointerId); pinch.current = null; drag.current = null; setDraftStroke([]); setDragPositions({}); }} style={{ backgroundPosition: `${pan.x}px ${pan.y}px`, backgroundSize: `${gridSpacing(zoom) * zoom}px ${gridSpacing(zoom) * zoom}px` }}>
 <div className="canvas-label">A LITTLE ROOM FOR YOUR BIG IDEAS <span>·</span> {snapshot.elements.length} elements</div><div className="canvas-controls" onPointerDown={e => e.stopPropagation()}><IconButton label={claims.some(c => c.actor.id === userId) ? 'Release working area' : 'Mark working area'} onClick={async () => {
            try {
                const own = claims.filter(c => c.actor.id === userId);
                if (own.length) {
                    await Promise.all(own.map(c => api(`/boards/${id}/claims/${c.id}`, 'DELETE')));
                    setClaims(c => c.filter(c => c.actor.id !== userId));
                }
                else {
                    const rect = root.current!.getBoundingClientRect();
                    const claim = await api<Claim>(`/boards/${id}/claims`, 'POST', { target: { rect: { x: -pan.x / zoom, y: -pan.y / zoom, w: Math.min(4000, Math.max(20, rect.width / zoom)), h: Math.min(4000, Math.max(20, rect.height / zoom)) } }, note: 'Working here' });
                    setClaims(c => [...c, claim]);
                }
            }
            catch (e) {
                toast((e as Error).message);
            }
        }}><Flag size={16}/></IconButton><i /><IconButton label="Undo (⌘Z)" onClick={() => undoAction()} disabled={committing > 0 || !history.length}><Undo2 size={17}/></IconButton><IconButton label="Redo (⌘⇧Z)" onClick={() => undoAction(true)} disabled={committing > 0 || !redo.length}><Redo2 size={17}/></IconButton><i /><IconButton label="Zoom out" onClick={() => setZoom(z => Math.max(.25, z - .1))}><Minus size={17}/></IconButton><button className="zoom-level" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><IconButton label="Zoom in" onClick={() => setZoom(z => Math.min(2, z + .1))}><Plus size={17}/></IconButton><i /><IconButton label="Fit to content" onClick={() => fit()}><Maximize size={17}/></IconButton></div>
 {!elements.length && ['select', 'hand'].includes(tool) && <div className="canvas-empty"><div><StickyNote size={28}/></div><h2>A fresh space for a new thought.</h2><p>Pick a tool below, or ask an agent to help you get started.</p><Button onClick={() => { place('note', 150, 130); }}><Plus size={16}/>Add your first note</Button></div>}
 <div className="world" style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}><svg className="arrows" style={{ overflow: 'visible' }}><defs><marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10" fill="none" stroke="currentColor" strokeWidth="1.5"/></marker></defs>{elements.filter(e => e.type === 'arrow').map(el => {
            if (el.type !== 'arrow')
                return null;
            const from = map[el.from], to = map[el.to];
            if (!from || !to)
                return null;
            const x1 = from.x + ('w' in from ? from.w : 200) / 2, y1 = from.y + ('h' in from ? from.h : 50) / 2, x2 = to.x + ('w' in to ? to.w : 200) / 2, y2 = to.y + ('h' in to ? to.h : 50) / 2;
            return <g key={el.id} className={selected.includes(el.id) ? 'selected-arrow' : ''} onPointerDown={e => { e.stopPropagation(); setSelected([el.id]); }} onDoubleClick={() => edit(el)}><line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={16 / zoom} stroke="transparent" style={{ pointerEvents: 'stroke' }}/><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={1.5} markerEnd="url(#arrowhead)" style={{ pointerEvents: 'none' }}/>{el.label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 10} textAnchor="middle">{el.label}</text>}</g>;
        })}</svg>
 {draftStroke.length > 0 && <svg className="draft-ink"><polyline points={(draftStroke.length === 2 ? [...draftStroke, ...draftStroke] : draftStroke).join(' ')}/></svg>}
 {view.order.map(elementId => {
            const el = map[elementId];
            if (!el || el.type === 'arrow')
                return null;
            const isSelected = selected.includes(el.id), isEdit = editing === el.id;
            return <div key={el.id} tabIndex={0} role="button" aria-label={`${el.type}: ${el.text || 'Empty ' + el.type}`} className={`element ${el.type} ${'color' in el ? el.color : ''} ${el.type === 'shape' ? el.kind : ''} ${el.type === 'text' ? el.size : ''} ${isSelected ? 'selected' : ''}`} style={{ left: el.x, top: el.y, width: 'w' in el ? el.w : undefined, height: 'h' in el ? el.h : undefined, '--handle': `${16 / zoom}px`, '--selection': `${2 / zoom}px` } as React.CSSProperties} onPointerDown={e => startElement(e, el)} onDoubleClick={() => edit(el)} onFocus={() => {
                    if (!selected.includes(el.id))
                        setSelected([el.id]);
                }} title={`Last changed by ${el.updatedBy.name}`}>
 {el.type === 'scene3d' ? <Scene3DCard stillUrl={nearViewport(el, viewport, 100 / zoom) ? `/api/v1/boards/${id}/scenes/${el.id}/frame?v=${el.version}` : undefined} model={el} view={modelView(el)} onView={patch => changeModelView(el, patch)} live={liveModels.includes(el.id)} onActivate={() => { setSelected([el.id]); setActiveModel(el.id); }} interactive={tool === 'select' && !spaceHeld} onTouchStart={e => { touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (touches.current.size === 2) startCanvas(e, true); }}/> : el.type === 'embed' ? <EmbedView html={el.html} title={el.text} visible={nearViewport(el, viewport, 400 / zoom)}/> : el.type === 'drawing' ? <DrawingView drawing={el}/> : isEdit ? <textarea aria-label="Element text" autoFocus value={editText} maxLength={4000} onChange={e => setEditText(e.target.value)} onPointerDown={e => e.stopPropagation()} onBlur={finishEdit} onKeyDown={e => {
                        if (e.key === 'Escape') {
                            setEditing(null);
                            e.stopPropagation();
                        }
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
                            e.currentTarget.blur();
                    }}/> : <div className="element-text">{el.text || <span className="placeholder">Double-click to add a thought…</span>}</div>}{el.updatedBy.kind === 'agent' && <span className="agent-mark"><Bot size={14}/></span>}{isSelected && 'w' in el && <button className="resize-handle" aria-label="Resize element" onPointerDown={e => startElement(e, el, true)}/>}</div>;
        })}
 {claims.map(c => {
            let rect: {
                x: number;
                y: number;
                w: number;
                h: number;
            };
            if ('rect' in c.target)
                rect = c.target.rect;
            else
                rect = bounds(c.target.elementIds.map(id => map[id]).filter(Boolean));
            return <div key={c.id} className="claim-frame" style={{ left: rect.x - 10, top: rect.y - 10, width: rect.w + 20, height: rect.h + 20 }}><span><Bot size={13}/>{c.actor.name} · {c.note || 'working'}</span></div>;
        })}{box && <div className="selection-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}/>}</div>
 <SelectionBar busy={committing > 0} elements={chosen} onOps={commit} onDelete={remove} onEdit={el => {
            if (el.type === 'drawing') {
                setDescriptionId(el.id);
                setDescription(el.text);
            }
            else
                edit(el);
        }}>{selectedOne?.type === 'scene3d' && chosen.length === 1 && <Scene3DSelectionBar model={selectedOne} view={modelView(selectedOne)} onView={patch => changeModelView(selectedOne, patch)} onOps={commit} onAsk={() => askDesign(selectedOne)} busy={committing > 0}/>}</SelectionBar>
 <BoardToolbar onRun={run => setRuns(all => all.some(r => r.id === run.id) ? all : [run, ...all])} design={designTarget} designKind={designTarget && 'elementId' in designTarget && map[designTarget.elementId]?.type === 'scene3d' ? 'scene3d' : 'embed'} onPlaced={elementId => setDesignTarget({ elementId })} boardId={id} userId={userId} canvasRef={root} tool={tool} onPick={pick} allAgents={agents.data?.items} agents={(agents.data?.items || []).filter(a => a.status === 'active' && (a.boardIds === null || a.boardIds.includes(id)))} runs={runs} askMode={chat} onAskMode={ask => {
            if (ask) {
                drawingGeneration.current++;
                drawingSession.current = null;
            }
            if (ask && !designTarget && (selectedOne?.type === 'embed' || selectedOne?.type === 'scene3d')) setDesignTarget({ elementId: selectedOne.id });
            if (!ask) setDesignTarget(undefined);
            setChat(ask);
        }} onShow={run => { setSelected(run.touched); fit(elements.filter(e => run.touched.includes(e.id))); }} onRevert={async (run) => {
            try {
                await api('/runs/' + run.id + '/revert', 'POST');
                await refetch();
                setRuns(r => r.map(x => x.id === run.id ? { ...x, reverted: true } : x));
                toast('Agent changes undone.');
            }
            catch (e) {
                toast((e as Error).message);
            }
        }}/><div className="canvas-hint">Space + drag to pan <span>·</span> ⌘ + scroll to zoom</div>
 </div>{activity && <BoardActivity id={id} onClose={() => setActivity(false)} onRevert={async (seq) => {
                try {
                    await api(`/boards/${id}/batches/${seq}/revert`, 'POST');
                    await refetch();
                    toast('Change undone.');
                }
                catch (e) {
                    toast((e as Error).message);
                }
            }}/>}
 {descriptionId && <Modal title="Describe drawing" onClose={() => setDescriptionId(null)}><form onSubmit={async (e) => {
                e.preventDefault();
                const el = map[descriptionId];
                if (el && await commit([{ op: 'update', id: el.id, ifVersion: el.version, data: { text: description } }]))
                    setDescriptionId(null);
            }}><label>Description<input autoFocus required minLength={1} maxLength={200} value={description} onChange={e => setDescription(e.target.value)}/></label><Button className="primary">Save description</Button></form></Modal>}
 {agentView !== null && <Modal title="Agent view" wide onClose={() => setAgentView(null)}><p className="muted">The exact context your agents receive when reading this board.</p><img className="board-snapshot" src={`/api/v1/boards/${id}/view`} alt="Board snapshot including drawings"/><CopyCode value={agentView}/></Modal>}{editing && map[editing]?.type === 'arrow' && <Modal title="Arrow label" onClose={() => setEditing(null)}><form onSubmit={e => { e.preventDefault(); finishEdit(); }}><label>Label<input autoFocus value={editText} onChange={e => setEditText(e.target.value)}/></label><Button className="primary">Save label</Button></form></Modal>}{conflict && <Modal title="This text changed while you were editing." onClose={() => setConflict(null)}><p>Your words are saved here. Choose which version to keep.</p><h3>Your text</h3><pre className="response">{conflict.op.data.text || conflict.op.data.label}</pre><h3>Current text</h3><p>{conflict.current.text || conflict.current.label}</p><div className="form-actions"><Button onClick={() => setConflict(null)}>Use theirs</Button><Button className="primary" onClick={async () => { const c = conflict; setConflict(null); await commit([{ ...c.op, ifVersion: c.current.version }]); }}>Keep mine</Button></div></Modal>}</div>;
}
function BoardActivity({ id, onClose, onRevert }: {
    id: string;
    onClose: () => void;
    onRevert: (seq: number) => void;
}) {
    const q = useQuery<{
        items: ActivityEvent[];
    }>({ queryKey: ['board-activity', id], queryFn: () => api('/activity?boardId=' + id), refetchInterval: 3000 });
    return <aside className="board-activity"><div className="panel-title"><Activity size={18}/><h2>Board activity</h2><IconButton label="Close activity panel" onClick={onClose}><X size={19}/></IconButton></div>{q.isPending || q.error ? <Load error={q.error} refetch={q.refetch}/> : q.data.items.length ? q.data.items.map(e => <div className="board-activity-row" key={e.id}><Stamp name={e.actor.name} kind={e.actor.kind}/><div><strong>{e.actor.name}</strong><p>{e.summary}</p><small>{new Date(e.at).toLocaleTimeString()}</small>{e.actor.kind === 'agent' && <button onClick={() => onRevert(e.seq)}>Undo</button>}</div></div>) : <div className="empty"><p>The next thought starts the story.</p></div>}</aside>;
}
