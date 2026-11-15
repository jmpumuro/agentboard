import { useState } from 'react';
import { Link } from 'react-router';
import type { Agent, EmbedInputType } from 'contract';
import { Modal, Button } from '../../../ui';
export function MockupComposer({ agents, existing, onClose, onSubmit, onAdvanced }: {
    agents: Agent[];
    existing?: EmbedInputType;
    onClose: () => void;
    onSubmit: (agentId: string, brief: string) => Promise<void>;
    onAdvanced: () => void;
}) {
    const allowed = agents.filter(a => a.status === 'active' && a.scopes.includes('boards:write') && a.capabilities.includes(existing ? 'edit' : 'add'));
    const [agentId, setAgentId] = useState(allowed[0]?.id || ''), [brief, setBrief] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    return <Modal title={existing ? 'Refine this mockup' : 'Describe your design'} onClose={onClose}><p className="muted">{existing ? 'Tell your agent what to change. It will revise this mockup in place.' : 'Describe what you want to see. Your agent will build a live mockup on the board.'}</p>{allowed.length ? <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try {
        await onSubmit(agentId, brief.trim());
        onClose();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }}><label>Design agent<select value={agentId} onChange={e => setAgentId(e.target.value)}>{allowed.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label><label>{existing ? 'What should change?' : 'Describe the design'}<textarea autoFocus rows={5} maxLength={1200} minLength={3} required value={brief} onChange={e => setBrief(e.target.value)} placeholder={existing ? 'Make the headline shorter, add more space, and use a warm green background.' : 'A clean pricing page with three plans, a green accent, and one clear call to action.'}/></label><p className="help">No code needed. You can ask for more changes after it appears.</p>{error && <p className="error" role="alert">{error}</p>}<div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button className="primary" disabled={busy || brief.trim().length < 3}>{busy ? 'Starting…' : existing ? 'Update mockup' : 'Create mockup'}</Button></div></form> : <p>No agent has permission to {existing ? 'edit' : 'add'} mockups on this board. <Link to="/agents">Configure an agent</Link></p>}<details className="embed-advanced"><summary>Advanced</summary><p className="help">Optional direct editing for people who want to work with HTML and CSS.</p><Button onClick={onAdvanced}>{existing ? 'Edit code' : 'Start from HTML and CSS'}</Button></details></Modal>;
}
