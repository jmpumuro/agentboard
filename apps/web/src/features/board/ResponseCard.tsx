import type { Agent, Run } from 'contract';
import { Bot, ChevronLeft, ChevronRight, Maximize, Undo2, X } from 'lucide-react';
import { Button, IconButton } from '../../ui';
function Steps({ run }: {
    run: Run;
}) { return <div className="run-steps">{run.steps.map(s => <div className={'run-step ' + s.status} key={s.id}><span>{s.status === 'done' ? '✓' : s.status === 'failed' ? '×' : s.status === 'skipped' ? '–' : '·'}</span><code>{s.kind.toUpperCase()}</code><div><strong>{s.name}</strong><small>{s.note}</small></div></div>)}</div>; }
export function ResponseCard({ run, agents, index, total, onPrevious, onNext, onHide, onShow, onRevert }: {
    run: Run;
    agents: Agent[];
    index: number;
    total: number;
    onPrevious: () => void;
    onNext: () => void;
    onHide: () => void;
    onShow: (run: Run) => void;
    onRevert: (run: Run) => void;
}) {
    const active = ['queued', 'running'].includes(run.status);
    return <section className="response-card" aria-label="Agent response">
  <header><Bot size={17}/><strong>{agents.find(a => a.id === run.agentId)?.name || 'Agent'}</strong><span className="badge">{run.status}</span><div className="response-pager"><IconButton label="Previous response" disabled={index <= 0} onClick={onPrevious}><ChevronLeft size={16}/></IconButton><span aria-live="polite">{index + 1} / {total}</span><IconButton label="Next response" disabled={index >= total - 1} onClick={onNext}><ChevronRight size={16}/></IconButton></div><IconButton label="Hide response" onClick={onHide}><X size={17}/></IconButton></header>
  <div className="response-content"><div className="user-message">{run.message}</div>{active ? <Steps run={run}/> : <details key={run.id}><summary>Show the {run.steps.length} steps it took</summary><Steps run={run}/></details>}{run.reply && <p className="run-reply">{run.reply}</p>}{run.error && <p className="error">{run.error.message}</p>}{!!run.touched.length && <div className="row-actions"><Button onClick={() => onShow(run)}><Maximize size={14}/>Show on board</Button><Button disabled={run.reverted || active} onClick={() => onRevert(run)}><Undo2 size={14}/>{run.reverted ? 'Undone' : 'Undo changes'}</Button></div>}</div>
 </section>;
}
