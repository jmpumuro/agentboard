import type { Agent, DesignTarget, Run } from 'contract';
import { ABILITIES } from 'contract';
import { ArrowLeft, Box, Code2, GripVertical, Hand, MousePointer2, MoveUpRight, Pencil, Send, Square, StickyNote, StopCircle, Type } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { constrainToolbar, DEFAULT_TOOLBAR_POSITION, hiddenResponseKey, readToolbarPosition } from '../../board-engine/toolbar-position';
import { Button, useToast } from '../../ui';
import { ResponseCard } from './ResponseCard';
export const BOARD_TOOLS = [['select', 'Select', MousePointer2, 'V'], ['hand', 'Pan', Hand, 'H'], ['text', 'Text', Type, 'T'], ['note', 'Note', StickyNote, 'N'], ['shape', 'Shape', Square, 'S'], ['arrow', 'Arrow', MoveUpRight, 'A'], ['draw', 'Draw', Pencil, 'D'], ['embed', 'Design', Code2, 'E'], ['scene3d', '3D', Box, 'M']] as const;
export function BoardToolbar({ boardId, userId, canvasRef, tool, onPick, agents, allAgents, runs, askMode, onAskMode, onShow, onRevert, design, designKind, onPlaced, onRun }: {
    onRun?: (run: Run) => void;
    design?: DesignTarget;
    designKind?: 'embed' | 'scene3d';
    onPlaced?: (elementId: string) => void;
    boardId: string;
    userId: string;
    canvasRef: RefObject<HTMLDivElement | null>;
    tool: string;
    onPick: (tool: string) => void;
    agents: Agent[];
    allAgents?: Agent[];
    runs: Run[];
    askMode: boolean;
    onAskMode: (ask: boolean) => void;
    onShow: (run: Run) => void;
    onRevert: (run: Run) => void;
}) {
    const key = `agentboard.toolbar.${userId}`, hiddenKey = hiddenResponseKey(userId, boardId);
    const [position, setPosition] = useState(() => readToolbarPosition(key));
    const [size, setSize] = useState({ width: 800, height: 600 }), [barSize, setBarSize] = useState({ width: 520, height: 64 });
    const [contextVisible, setContextVisible] = useState(true);
    const [placementRun, setPlacementRun] = useState<string | null>(null);
    const [message, setMessage] = useState(''), [agentId, setAgentId] = useState(agents[0]?.id || ''), [sending, setSending] = useState(false);
    const ordered = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const latest = ordered.at(-1)?.id;
    const [chosenId, setChosenId] = useState<string | undefined>(), [hidden, setHidden] = useState<string | null>(() => {
        try {
            return localStorage.getItem(hiddenKey);
        }
        catch {
            return null;
        }
    });
    const toolbarRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLInputElement>(null), drag = useRef<{
        x: number;
        y: number;
        position: typeof position;
    } | null>(null), previousLatest = useRef<string | undefined>(undefined), toast = useToast();
    useEffect(() => {
        if (!agents.some(a => a.id === agentId))
            setAgentId(agents[0]?.id || '');
    }, [agents, agentId]);
    useEffect(() => {
        if (latest && latest !== previousLatest.current) {
            setChosenId(latest);
            if (previousLatest.current) {
                setHidden(null);
                try {
                    localStorage.removeItem(hiddenKey);
                }
                catch { }
            }
            previousLatest.current = latest;
        }
    }, [latest, hiddenKey]);
    useEffect(() => {
        if (askMode) { inputRef.current?.focus(); setContextVisible(true); }
    }, [askMode]);
    useEffect(() => {
        const update = () => {
            const rect = canvasRef.current?.getBoundingClientRect(), bar = toolbarRef.current?.getBoundingClientRect();
            if (rect?.width && rect.height)
                setSize({ width: rect.width, height: rect.height });
            if (bar?.width && bar.height)
                setBarSize({ width: bar.width, height: bar.height });
        };
        update();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
        if (canvasRef.current)
            observer?.observe(canvasRef.current);
        if (toolbarRef.current)
            observer?.observe(toolbarRef.current);
        window.addEventListener('resize', update);
        return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
    }, [canvasRef, askMode]);
    const clamped = constrainToolbar(position, size, barSize), index = Math.max(0, ordered.findIndex(r => r.id === (chosenId || latest))), run = ordered[index];
    const visible = run && hidden !== latest;
    const top = size.height - clamped.bottom - barSize.height, placement = top < 240 ? 'below' : 'above';
    const cardHeight = Math.max(80, Math.min(430, (placement === 'above' ? top : clamped.bottom) - 16));
    const agent = agents.find(a => a.id === agentId), active = ordered.find(r => r.agentId === agentId && ['running', 'queued'].includes(r.status));
    useEffect(() => {
        const completed = placementRun && runs.find(r => r.id === placementRun);
        if (completed && design && 'place' in design && completed.design && 'elementId' in completed.design) {
            onPlaced?.(completed.design.elementId); setPlacementRun(null);
        }
    }, [runs, placementRun, design, onPlaced]);
    function save(p: typeof position) {
        const next = constrainToolbar(p, size, barSize);
        setPosition(next);
        try {
            localStorage.setItem(key, JSON.stringify(next));
        }
        catch { }
    }
    function hide() {
        setContextVisible(false);
        setHidden(latest || null);
        try {
            if (latest)
                localStorage.setItem(hiddenKey, latest);
        }
        catch { }
    }
    function restore(runId = latest) {
        setHidden(null);
        setChosenId(runId);
        try {
            localStorage.removeItem(hiddenKey);
        }
        catch { }
    }
    async function send() {
        if (active) {
            try {
                await api('/runs/' + active.id + '/cancel', 'POST');
            }
            catch (e) {
                toast((e as Error).message);
            }
            return;
        }
        if (!agentId || !message.trim())
            return;
        setSending(true);
        try {
            const run = await api<Run>(`/boards/${boardId}/runs`, 'POST', { agentId, message, ...(design ? { design } : {}) });
            onRun?.(run);
            if (design && 'place' in design) setPlacementRun(run.id);
            setMessage('');
            if (design && 'place' in design && run.design && 'elementId' in run.design) onPlaced?.(run.design.elementId);
            restore(run.id);
        }
        catch (e) {
            toast((e as Error).message);
        }
        finally {
            setSending(false);
        }
    }
    return <div className="board-dock" style={{ left: `${clamped.fraction * 100}%`, bottom: clamped.bottom, '--response-height': `${cardHeight}px` } as React.CSSProperties} data-response-placement={placement} onPointerDown={e => e.stopPropagation()}>
  {visible ? <ResponseCard run={run} agents={allAgents ?? agents} index={index} total={ordered.length} onPrevious={() => setChosenId(ordered[index - 1]?.id)} onNext={() => setChosenId(ordered[index + 1]?.id)} onHide={hide} onShow={onShow} onRevert={onRevert}/> : askMode && contextVisible && <section className="agent-context" aria-label="Agent capabilities"><strong>Sees everything on this board.</strong><p>May: {agent?.capabilities.length ? agent.capabilities.map(id => ABILITIES.find(a => a.id === id)?.label || id).join(', ') : 'read only'}.</p><div className="chat-chips">{['Explore a few ideas', 'Draw a rocket', 'Mock up a pricing page'].map(s => <button key={s} onClick={() => { setMessage(s); inputRef.current?.focus(); }}>{s}</button>)}</div>{latest && <Button onClick={() => restore()}>Show the last response</Button>}</section>}
  <div className={'canvas-toolbar dock-toolbar ' + (askMode ? 'ask-mode' : '')} ref={toolbarRef}>
   <button className="toolbar-grip" aria-label="Move toolbar" title="Drag to move. Double-click to reset. Arrow keys also move the toolbar." onDoubleClick={() => save(DEFAULT_TOOLBAR_POSITION)} onKeyDown={e => {
            const step = e.shiftKey ? 30 : 10;
            if (e.key.startsWith('Arrow')) {
                e.preventDefault();
                e.stopPropagation();
                save({ fraction: position.fraction + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0) / size.width, bottom: position.bottom + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0) });
            }
        }} onPointerDown={e => { e.stopPropagation(); drag.current = { x: e.clientX, y: e.clientY, position: clamped }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => {
            if (!drag.current)
                return;
            save({ fraction: drag.current.position.fraction + (e.clientX - drag.current.x) / size.width, bottom: drag.current.position.bottom - (e.clientY - drag.current.y) });
        }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}><GripVertical size={19}/></button>
   {askMode ? <><button className="tools-return" aria-label="Return to tools" onClick={() => onAskMode(false)}><ArrowLeft size={18}/><span>Tools</span></button>{agents.length ? <form className="toolbar-ask" onSubmit={e => { e.preventDefault(); void send(); }}><select aria-label="Choose agent" value={agentId} onChange={e => setAgentId(e.target.value)}>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><input ref={inputRef} aria-label="Ask your agent" placeholder={designKind === 'scene3d' ? 'Describe the 3D model to build, or what to change…' : design && 'elementId' in design ? 'Describe what should change in this design…' : design ? 'Describe the design you want here…' : 'Ask the agent…'} maxLength={2000} value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        onAskMode(false);
                    }
                }}/><Button className="primary" disabled={sending || (!active && !message.trim())} aria-label={active ? 'Stop run' : 'Send message'}>{active ? <StopCircle size={16}/> : <Send size={16}/>}<span>{active ? 'Stop' : 'Send'}</span></Button></form> : <div className="no-agents">No agent can work on this board. <Link to="/agents">Connect an agent</Link></div>}</> : <>{BOARD_TOOLS.map(([value, label, Icon, shortcut]) => <button key={value} className={tool === value ? 'active' : ''} aria-label={label + ' tool'} title={`${label} (${shortcut})`} onClick={() => onPick(value)}><Icon size={21}/><span>{label}</span></button>)}<i /><button className="agent-tool" aria-label="Ask an agent" onClick={() => onAskMode(true)}><span>Agent</span></button></>}
  </div>
 </div>;
}
