import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ActivityEvent, Agent, Board, Op, User, WorkspaceSettings } from 'contract';
import { ABILITIES, DRAWING_EXAMPLE, EXAMPLE_BOARDS, LIMITS, STARTER_EMBED, statusCodes, toolSchemas } from 'contract';
import { Activity, ArrowUpRight, BookOpen, Bot, Check, Code2, KeyRound, LayoutGrid, LogOut, Pencil, Plus, Search, Send, Settings, Shield, Trash2, X } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import { api } from './api/client';
import { qc } from './api/query';
import { bounds, type Snapshot } from './board-engine';
import { AbilityPicker } from './features/agents/AbilityPicker';
import { Canvas } from './features/board/BoardPage';
import { DrawingView } from './features/board/DrawingView';
import { ThemeControl } from './theme/ThemeControl';
import { ThemeContext, useThemePreference } from './theme/theme';
import { Button, CopyCode, IconButton, Load, Modal, Stamp, ToastContext, useToast } from './ui';
import { Brand } from './ui/Brand';
function time(at: string) { const n = Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60000)); return n < 1 ? 'Just now' : n < 60 ? `${n}m ago` : n < 1440 ? `${Math.floor(n / 60)}h ago` : new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function Header({ eyebrow, title, description, children }: {
    eyebrow?: string;
    title: string;
    description?: string;
    children?: ReactNode;
}) { return <header className="page-head"><div><div className="eyebrow">{eyebrow || 'YOUR WORKSPACE'}</div><h1>{title}</h1>{description && <p>{description}</p>}</div><div className="head-actions">{children}</div></header>; }
function Auth() {
    const location = useLocation(), signup = location.pathname === '/signup', navigate = useNavigate();
    const [error, setError] = useState(''), [busy, setBusy] = useState(false);
    return <div className="auth-page"><div className="auth-art"><div className="brand full" aria-label="AgentBoard"><Brand /></div><div><div className="eyebrow">A LITTLE SPACE. A BIGGER PICTURE.</div><h1>Good ideas<br />think together.</h1><p>A shared canvas for your thoughts,<br />your team, and your AI agents.</p><div className="auth-notes"><div className="note yellow">What if we<br />tried something<br /><strong>different?</strong></div><div className="note green">More perspectives.<br />Better possibilities.<Bot size={22}/></div></div></div><small>Room for a little human + agent ingenuity.</small></div><div className="auth-form"><div className="brand auth-mobile-brand" aria-label="AgentBoard"><Brand /></div><div className="eyebrow">WELCOME TO YOUR THINKING SPACE</div><h2>{signup ? 'Make room for your ideas.' : 'Pick up where you left off.'}</h2><p className="muted">{signup ? 'Create your account to start your workspace.' : 'Sign in to your workspace.'}</p><form onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            const form = new FormData(e.currentTarget);
            try {
                await api('/auth/' + (signup ? 'signup' : 'login'), 'POST', { email: form.get('email'), password: form.get('password'), ...(signup ? { name: form.get('name'), invite: new URLSearchParams(location.search).get('invite') || undefined } : {}) });
                await qc.invalidateQueries({ queryKey: ['me'] });
                navigate('/boards');
            }
            catch (e) {
                setError((e as Error).message);
            }
            finally {
                setBusy(false);
            }
        }}>{signup && <label>Your name<input name="name" required maxLength={60} autoComplete="name" placeholder="Alex Morgan"/></label>}<label>Email address<input name="email" type="email" required autoComplete="email" placeholder="you@company.com"/></label><label>Password<input name="password" type="password" required minLength={8} autoComplete={signup ? 'new-password' : 'current-password'} placeholder="At least 8 characters"/></label>{error && <p role="alert" className="error">{error}</p>}<Button className="primary" disabled={busy}>{busy ? 'One moment…' : signup ? 'Create workspace' : 'Sign in'}<ArrowUpRight size={17}/></Button></form><p>{signup ? 'Already have an account?' : 'New here?'} <Link to={signup ? '/login' : '/signup'}>{signup ? 'Sign in' : 'Create an account'}</Link></p>{signup && <small className="muted">The first account owns this workspace. Additional people need an owner’s invite.</small>}</div></div>;
}
const destinations = [['/boards', 'Boards', LayoutGrid], ['/agents', 'Agents', Bot], ['/activity', 'Activity', Activity], ['/developers', 'Developers', Code2], ['/settings', 'Settings', Settings]] as const;
function Shell() {
    const me = useQuery({ queryKey: ['me'], queryFn: () => api('/me') }), loc = useLocation();
    if (me.isPending)
        return <Load />;
    if (me.error)
        return <Navigate to="/login" replace/>;
    return <div className={'app ' + (loc.pathname.match(/^\/boards\/.+/) ? 'is-board' : '')}><aside className="sidebar"><Link to="/boards" className="brand" aria-label="AgentBoard"><Brand /></Link><nav>{destinations.map(([to, label, Icon]) => <NavLink key={to} to={to} aria-label={label} title={label}><Icon size={21}/><span className="nav-label">{label}</span></NavLink>)}</nav><Link className="profile" to="/settings" aria-label="Account settings" title="Account settings"><Stamp name={me.data.actor.name}/><span className="profile-label">{me.data.actor.name}<small>Workspace account</small></span></Link></aside><main><Routes><Route path="/boards" element={<Boards />}/><Route path="/boards/:boardId" element={<Canvas userId={me.data.actor.id}/>}/><Route path="/agents" element={<Agents />}/><Route path="/activity" element={<ActivityPage />}/><Route path="/developers" element={<Developers />}/><Route path="/settings" element={<SettingsPage user={me.data.user}/>}/><Route path="/" element={<Navigate to="/boards" replace/>}/><Route path="*" element={<div className="empty"><h1>A little off the board.</h1><Link to="/boards">Back to Boards</Link></div>}/></Routes></main></div>;
}
function Miniature({ id }: {
    id: string;
}) {
    const { data } = useQuery<Snapshot>({ queryKey: ['elements', id], queryFn: () => api(`/boards/${id}/elements`) });
    if (!data)
        return <div className="mini loading"/>;
    const b = bounds(data.elements), scale = Math.min(270 / (b.w + 120), 130 / (b.h + 80), .35);
    return <div className="mini"><div style={{ position: 'absolute', left: '50%', top: '50%', transform: `scale(${scale}) translate(${-b.x - b.w / 2}px,${-b.y - b.h / 2}px)`, transformOrigin: '0 0' }}>{data.elements.filter(e => e.type !== 'arrow').map(e => <div key={e.id} className={'mini-element ' + e.type + ' ' + ('color' in e ? e.color : '')} style={{ left: e.x, top: e.y, width: 'w' in e ? e.w : 340, height: 'h' in e ? e.h : 70, fontSize: e.type === 'text' && e.size === 'title' ? 32 : 20 }}>{e.type === 'scene3d' ? <div className="mini-embed"><strong>◇ {e.text}</strong><small>{e.parts.length} named 3D parts</small></div> : e.type === 'embed' ? <div className="mini-embed"><strong>&lt;/&gt; {e.text}</strong><small>HTML / CSS mockup</small></div> : e.type === 'drawing' ? <DrawingView drawing={e}/> : e.text}</div>)}</div>{!data.elements.length && <span className="mini-empty">A fresh place to think</span>}</div>;
}
const starter: Op[] = [{ op: 'create', id: 'heading', data: { type: 'text', x: 80, y: 60, text: 'A better way to work together', size: 'title' } }, { op: 'create', id: 'takeaway', data: { type: 'text', x: 80, y: 120, text: 'People bring perspective. Agents help us explore what’s possible.', size: 'body' } }, ...[
        ['idea', 'yellow', 80, 210, 'Start with a question\n\nWhat would make our work feel simpler?'], ['explore', 'blue', 330, 210, 'Explore the possibilities\n\nMake space for a few unexpected ideas.'], ['next', 'green', 580, 210, 'Find the next step\n\nChoose one small thing to try this week.'], ['remember', 'pink', 330, 450, 'A little reminder\n\nYou can always change your mind.']
    ].map(([id, color, x, y, text]) => ({ op: 'create', id, data: { type: 'note', x, y, w: 210, h: 190, text, color } } as Op)), { op: 'create', data: { type: 'arrow', x: 0, y: 0, from: 'explore', to: 'next', label: 'try it' } }];
function Boards() {
    const [examplesOpen, setExamplesOpen] = useState(false);
    const [trash, setTrash] = useState(false), [search, setSearch] = useState(''), [busy, setBusy] = useState(false);
    const navigate = useNavigate(), toast = useToast();
    const q = useQuery<{
        items: Board[];
    }>({ queryKey: ['boards', trash], queryFn: () => api('/boards' + (trash ? '?trashed=true' : '')) }), settings = useQuery<WorkspaceSettings>({ queryKey: ['settings'], queryFn: () => api('/settings') });
    async function create(sample = false) {
        setBusy(true);
        try {
            const b = await api<Board>('/boards', 'POST', { title: sample ? 'A better way to work' : 'Untitled board' });
            if (sample)
                await api(`/boards/${b.id}/ops`, 'POST', { ops: starter });
            await qc.invalidateQueries({ queryKey: ['boards'] });
            navigate('/boards/' + b.id, { state: { rename: !sample } });
        }
        catch (e) {
            toast((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    return <div className="page"><Header title={trash ? 'Room for a second thought.' : 'A place to think together.'} description={trash ? 'Deleted boards stay here for 30 days.' : `${settings.data?.name || 'Your workspace'} · Big ideas start with a little space.`}><Button onClick={() => setExamplesOpen(true)}>Example boards</Button><Button onClick={() => setTrash(!trash)}><Trash2 size={16}/>{trash ? 'Back to boards' : 'Trash'}</Button><Button className="primary" disabled={busy} onClick={() => create()}><Plus size={18}/>New board</Button></Header><div className="section-bar"><div className="tabs"><button className="active">{trash ? 'Recently deleted' : 'All boards'} <span>{q.data?.items.length ?? 0}</span></button></div><div className="search"><Search size={16}/><input aria-label="Search boards" placeholder="Find a board…" value={search} onChange={e => setSearch(e.target.value)}/></div></div>{q.isPending || q.error ? <Load error={q.error} refetch={q.refetch}/> : <div className="board-grid">{q.data.items.filter(b => b.title.toLowerCase().includes(search.toLowerCase())).map(b => <article className="board-card" key={b.id}><Link to={trash ? '#' : '/boards/' + b.id} aria-label={'Open ' + b.title}><Miniature id={b.id}/></Link><div className="card-body"><Link to={trash ? '#' : '/boards/' + b.id}><h3>{b.title}</h3></Link><div className="card-meta"><span>{b.elementCount} elements <b>·</b> {time(b.updatedAt)}</span>{trash ? <Button onClick={async () => { await api(`/boards/${b.id}/restore`, 'POST'); q.refetch(); toast('Board restored.'); }}>Restore</Button> : <IconButton label={'Delete ' + b.title} onClick={async () => {
                        try {
                            await api('/boards/' + b.id, 'DELETE');
                            q.refetch();
                            toast('Moved to Trash.', async () => { await api(`/boards/${b.id}/restore`, 'POST'); q.refetch(); });
                        }
                        catch (e) {
                            toast((e as Error).message);
                        }
                    }}><Trash2 size={16}/></IconButton>}</div></div></article>)}{!trash && !search && <button className="new-card" onClick={() => create(q.data.items.length === 0)}><span><Plus size={26}/></span><strong>{q.data.items.length ? 'Make room for your next idea' : 'Start with a little inspiration'}</strong><small>{q.data.items.length ? 'Create a blank board' : 'Create a starter board to explore the canvas'}</small></button>}</div>}{examplesOpen && <Modal title="Explore an example board" onClose={() => setExamplesOpen(false)}><p className="muted">Create a copy to explore notes, drawings, flows, live mockups and interactive 3D models together.</p>{EXAMPLE_BOARDS.map(example => <button className="example-board-option" key={example.id} onClick={async () => { setBusy(true); try {
        const board = await api<Board>('/boards', 'POST', { title: example.title });
        await api(`/boards/${board.id}/ops`, 'POST', { ops: example.ops });
        await qc.invalidateQueries({ queryKey: ['boards'] });
        navigate('/boards/' + board.id);
    }
    catch (e) {
        toast((e as Error).message);
    }
    finally {
        setBusy(false);
    } }} disabled={busy}><strong>{example.title}</strong><span>{example.description}</span><small>Create a copy →</small></button>)}</Modal>}<div className="page-foot"><span><span className="status-dot"/>One canvas. A few more perspectives.</span><span>Made for people + agents <Bot size={15}/></span></div></div>;
}
function Agents() {
    const q = useQuery<{
        items: Agent[];
    }>({ queryKey: ['agents'], queryFn: () => api('/agents') });
    const [editing, setEditing] = useState<Agent | 'new' | null>(null), [key, setKey] = useState<{
        key?: string;
        agent: Agent;
        webhookSecret?: string;
    } | null>(null), [confirm, setConfirm] = useState<{
        agent: Agent;
        action: 'revoke' | 'rotate-key';
    } | null>(null);
    const toast = useToast();
    return <div className="page"><Header eyebrow="YOUR EXTENDED TEAM" title="A few extra perspectives." description="Connect agents, set their boundaries, and let good ideas grow."><Button className="primary" onClick={() => setEditing('new')}><Plus size={17}/>Connect agent</Button></Header><div className="info-banner"><span className="banner-icon"><Bot size={23}/></span><div><strong>Different strengths. The same shared canvas.</strong><p>Agents work through the same API, with their own identity. Every change is visible, attributed, and reversible.</p></div><Shield size={24}/></div>{q.isPending || q.error ? <Load error={q.error} refetch={q.refetch}/> : q.data.items.length ? <div className="table-wrap"><table><thead><tr><th>Agent</th><th>Access & abilities</th><th className="desktop">Key</th><th>Status</th><th>Actions</th></tr></thead><tbody>{q.data.items.map(a => <tr key={a.id}><td><div className="actor-cell"><Stamp kind="agent" name={a.name}/><div><strong>{a.name}</strong><small>{a.harness}</small></div></div></td><td><div className="badges">{a.scopes.map(s => <span className="badge" key={s}>{s.replace('boards:', '')}</span>)}{a.capabilities.map(s => <span className="badge rust" key={s}>{ABILITIES.find(a => a.id === s)?.label || s}</span>)}</div><small className="muted">{a.boardIds === null ? 'All boards' : `${a.boardIds.length} selected boards`}</small></td><td className="desktop"><code>{a.keyPrefix}…</code></td><td><span className={'badge ' + (a.status === 'active' ? 'success' : '')}>{a.status}</span></td><td><div className="row-actions"><IconButton label={'Edit ' + a.name} onClick={() => setEditing(a)}><Pencil size={15}/></IconButton><IconButton label={'Rotate key for ' + a.name} disabled={a.status !== 'active'} onClick={() => setConfirm({ agent: a, action: 'rotate-key' })}><KeyRound size={15}/></IconButton><IconButton label={'Revoke ' + a.name} disabled={a.status !== 'active'} onClick={() => setConfirm({ agent: a, action: 'revoke' })}><Trash2 size={15}/></IconButton></div></td></tr>)}</tbody></table></div> : <div className="empty bordered"><Bot size={40}/><h2>Meet your next thinking partner.</h2><p>Connect your first agent with the capabilities it needs.</p><Button onClick={() => setEditing('new')}>Connect an agent<ArrowUpRight size={16}/></Button></div>}<div className="two-cards"><div className="plain-card"><KeyRound size={20}/><h3>A key for every agent</h3><p>Keys are shown once, stored as hashes, and can be rotated or revoked anytime.</p></div><div className="plain-card"><Code2 size={20}/><h3>Bring your own harness</h3><p>Connect over REST or MCP. Your agent’s scopes and board permissions follow every request.</p><Link to="/developers">Explore the API <ArrowUpRight size={14}/></Link></div></div>{editing && <AgentDialog agent={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSave={result => {
                setEditing(null);
                q.refetch();
                if (result.key || result.webhookSecret)
                    setKey(result);
            }}/>}{key && <Modal title="Your agent is connected." onClose={() => setKey(null)}><p>Copy this key now. You won’t be able to see it again.</p>{key.webhookSecret && <><h3>Webhook signing secret</h3><CopyCode value={key.webhookSecret}/></>}{key.key && <><CopyCode value={key.key}/><h3>Try your first request</h3><CopyCode value={`curl ${window.location.origin}/api/v1/boards \\\n  -H 'Authorization: Bearer ${key.key}'`}/><h3>MCP client configuration</h3><CopyCode value={JSON.stringify({ mcpServers: { agentboard: { url: window.location.origin + '/mcp', headers: { Authorization: 'Bearer ' + key.key } } } }, null, 2)}/></>}<Button className="primary" onClick={() => setKey(null)}>I’ve saved my key<Check size={16}/></Button></Modal>}{confirm && <Modal title={confirm.action === 'revoke' ? 'Revoke this agent?' : 'Rotate this key?'} onClose={() => setConfirm(null)}><p>{confirm.action === 'revoke' ? 'This will stop active runs and prevent future access.' : 'The existing key will stop working immediately.'}</p><div className="form-actions"><Button onClick={() => setConfirm(null)}>Cancel</Button><Button className="primary" onClick={async () => {
                try {
                    const result = await api('/agents/' + confirm.agent.id + (confirm.action === 'revoke' ? '' : '/rotate-key'), confirm.action === 'revoke' ? 'DELETE' : 'POST');
                    if (result?.key)
                        setKey(result);
                    setConfirm(null);
                    q.refetch();
                }
                catch (e) {
                    toast((e as Error).message);
                }
            }}>Confirm</Button></div></Modal>}</div>;
}
function AgentDialog({ agent, onClose, onSave }: {
    agent?: Agent;
    onClose: () => void;
    onSave: (r: any) => void;
}) {
    const boards = useQuery<{
        items: Board[];
    }>({ queryKey: ['boards', false], queryFn: () => api('/boards') }), [runnerKind, setRunnerKind] = useState(agent?.runner.kind || 'builtin'), [restricted, setRestricted] = useState(agent?.boardIds !== null && agent?.boardIds !== undefined), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    return <Modal title={agent ? 'Edit agent' : 'Connect a thinking partner'} onClose={onClose}><form onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setBusy(true);
            try {
                const result = await api('/agents' + (agent ? '/' + agent.id : ''), agent ? 'PATCH' : 'POST', { name: fd.get('name'), harness: fd.get('harness'), scopes: ['boards:read', ...(fd.getAll('capabilities').some(c => ['add', 'draw', 'edit', 'delete'].includes(String(c))) ? ['boards:write'] : [])], capabilities: fd.getAll('capabilities'), instructions: fd.get('instructions'), boardIds: restricted ? fd.getAll('boards') : null, runner: runnerKind === 'builtin' ? { kind: 'builtin' } : { kind: 'webhook', url: fd.get('webhookUrl') }, mcpServers: JSON.parse(String(fd.get('servers') || '[]')) });
                onSave(result);
            }
            catch (e) {
                setError((e as Error).message);
            }
            finally {
                setBusy(false);
            }
        }}><div className="form-grid"><label>Agent name<input name="name" defaultValue={agent?.name} placeholder="Planner" required maxLength={60}/></label><label>Harness<input name="harness" defaultValue={agent?.harness || 'custom'} required placeholder="claude-code, langgraph…"/></label></div><AbilityPicker selected={agent?.capabilities}/><label>Instructions<textarea name="instructions" rows={4} maxLength={2000} defaultValue={agent?.instructions} placeholder="How should this agent help your team?"/></label><label className="check"><input type="checkbox" checked={restricted} onChange={e => setRestricted(e.target.checked)}/>Limit access to selected boards</label>{restricted && <fieldset>{boards.data?.items.map(b => <label className="check" key={b.id}><input type="checkbox" name="boards" value={b.id} defaultChecked={agent?.boardIds?.includes(b.id)}/>{b.title}</label>)}</fieldset>}<label>Runner<select value={runnerKind} onChange={e => setRunnerKind(e.target.value as 'builtin' | 'webhook')}><option value="builtin">Built-in model</option><option value="webhook">External webhook harness</option></select></label>{runnerKind === 'webhook' && <label>Webhook URL<input name="webhookUrl" type="url" placeholder="https://your-harness.example/run" defaultValue={agent?.runner.kind === 'webhook' ? agent.runner.url : ''} required/></label>}<label>External MCP servers (JSON)<textarea name="servers" className="mono" rows={3} defaultValue={JSON.stringify(agent?.mcpServers.map(({ name, url }) => ({ name, url })) || [], null, 2)}/></label><p className="help">Add up to five HTTPS servers with name, url, and optional secret fields. Credentials are encrypted on the server.</p><p className="help">Built-in runs use your server’s configured model. External harnesses can connect with the REST API or MCP.</p>{error && <p className="error" role="alert">{error}</p>}<div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button className="primary" disabled={busy}>{busy ? 'Saving…' : agent ? 'Save changes' : 'Connect agent'}</Button></div></form></Modal>;
}
function ActivityPage() {
    const [kind, setKind] = useState(''), [board, setBoard] = useState(''), [cursor, setCursor] = useState(''), [previous, setPrevious] = useState<ActivityEvent[]>([]);
    const boards = useQuery<{
        items: Board[];
    }>({ queryKey: ['boards', false], queryFn: () => api('/boards') }), q = useQuery<{
        items: ActivityEvent[];
        nextCursor: string | null;
    }>({ queryKey: ['activity', kind, board, cursor], queryFn: () => api(`/activity?actorKind=${kind}&boardId=${board}&cursor=${cursor}`) });
    return <div className="page"><Header eyebrow="THE SHARED STORY" title="See the thinking unfold." description="A clear trail of who changed what, across your workspace."/><div className="section-bar"><div className="tabs">{[['', 'Everyone'], ['user', 'People'], ['agent', 'Agents']].map(([value, label]) => <button key={value} className={kind === value ? 'active' : ''} onClick={() => { setKind(value); setCursor(''); setPrevious([]); }}>{label}</button>)}</div><select aria-label="Filter activity by board" value={board} onChange={e => { setBoard(e.target.value); setCursor(''); setPrevious([]); }}><option value="">All boards</option>{boards.data?.items.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select></div>{q.isPending || q.error ? <Load error={q.error} refetch={q.refetch}/> : <><div className="activity-feed">{[...previous, ...q.data.items].map(e => <div className="activity-row" key={e.id}><Stamp kind={e.actor.kind} name={e.actor.name}/><div><p><strong>{e.actor.name}</strong> {e.summary}</p><Link to={'/boards/' + e.boardId}>{e.boardTitle}<ArrowUpRight size={13}/></Link></div><time>{time(e.at)}</time></div>)}{!q.data.items.length && !previous.length && <div className="empty"><Activity size={36}/><h2>Your story starts here.</h2><p>Changes to your boards will appear in this feed.</p></div>}</div>{q.data.nextCursor && <Button onClick={() => { setPrevious([...previous, ...q.data.items]); setCursor(q.data.nextCursor!); }}>Load more</Button>}</>}</div>;
}
function SettingsPage({ user }: {
    user: User;
}) {
    const q = useQuery<WorkspaceSettings>({ queryKey: ['settings'], queryFn: () => api('/settings') }), docs = useQuery<{
        items: any[];
    }>({ queryKey: ['knowledge'], queryFn: () => api('/knowledge') }), [add, setAdd] = useState(false), [invite, setInvite] = useState<string | null>(null), [error, setError] = useState('');
    const navigate = useNavigate(), toast = useToast(), isOwner = user?.role === 'owner';
    async function save(patch: Partial<WorkspaceSettings>) {
        try {
            await api('/settings', 'PATCH', patch);
            await q.refetch();
            toast('Settings saved.');
        }
        catch (e) {
            toast((e as Error).message);
        }
    }
    return <div className="page settings-page"><Header eyebrow="MAKE YOURSELF AT HOME" title="Your workspace, your way." description="A few thoughtful defaults for how people and agents work together."/>{q.isPending || q.error ? <Load error={q.error} refetch={q.refetch}/> : <><section className="settings-section"><div><h2>Appearance</h2><p>A comfortable view for any time of day.</p></div><div className="settings-content"><ThemeControl /></div></section><section className="settings-section"><div><h2>Workspace</h2><p>A shared home for your ideas.</p></div><div className="settings-content"><label>Workspace name<input key={q.data.name} defaultValue={q.data.name} disabled={!isOwner} onBlur={e => {
                if (e.target.value !== q.data.name)
                    save({ name: e.target.value });
            }} maxLength={120}/></label><small className="help">Saved when you leave the field.</small></div></section><section className="settings-section"><div><h2>Agent guardrails</h2><p>Give your team room to explore.<br />Keep people in control.</p></div><div className="settings-content">{[['agentsCanDeleteOthersElements', 'Allow agents to delete others’ elements', 'Off by default. Agents can always delete their own elements.'], ['requireClaimBeforeAgentWrite', 'Require a claim before writing', 'Agents must mark the space they plan to change. Claims never block people.']].map(([key, title, description]) => <label className="switch-row" key={key}><span><strong>{title}</strong><small>{description}</small></span><input role="switch" type="checkbox" checked={q.data[key as keyof WorkspaceSettings] as boolean} disabled={!isOwner} onChange={e => save({ [key]: e.target.checked })}/></label>)}</div></section><section className="settings-section"><div><h2>Workspace knowledge</h2><p>Give agents a little more context.<br />Paste documents they can search.</p></div><div className="settings-content">{docs.data?.items.map(d => <div className="doc-row" key={d.id}><BookOpen size={19}/><div><strong>{d.title}</strong><small>{d.text.length.toLocaleString()} characters</small></div>{isOwner && <IconButton label={'Remove ' + d.title} onClick={async () => { await api('/knowledge/' + d.id, 'DELETE'); docs.refetch(); }}><Trash2 size={16}/></IconButton>}</div>)}{!docs.data?.items.length && <p className="muted">No documents yet. Add a brief, a few guidelines, or helpful context.</p>}{isOwner && <Button onClick={() => setAdd(true)}><Plus size={16}/>Add document</Button>}</div></section><section className="settings-section"><div><h2>Your account</h2><p>The person behind the ideas.</p></div><div className="settings-content"><div className="actor-cell"><Stamp name={user?.name || 'You'}/><div><strong>{user?.name}</strong><small>{user?.email} · {user?.role}</small></div></div><div className="row-actions account-actions">{isOwner && <Button onClick={() => setInvite('')}><Plus size={16}/>Invite a member</Button>}<Button onClick={async () => { await api('/auth/logout', 'POST'); qc.clear(); navigate('/login'); }}><LogOut size={16}/>Sign out</Button></div></div></section></>}{add && <Modal title="Add workspace knowledge" onClose={() => setAdd(false)}><form onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                try {
                    await api('/knowledge', 'POST', { title: fd.get('title'), text: fd.get('text') });
                    docs.refetch();
                    setAdd(false);
                    setError('');
                }
                catch (e) {
                    setError((e as Error).message);
                }
            }}><label>Title<input name="title" required maxLength={120}/></label><label>Document text<textarea rows={10} name="text" required maxLength={20000}/></label>{error && <p className="error">{error}</p>}<Button className="primary">Add document</Button></form></Modal>}{invite !== null && <Modal title="Invite a member" onClose={() => setInvite(null)}>{invite ? <CopyCode value={invite}/> : <form onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                        const data = await api('/auth/invites', 'POST', { email: new FormData(e.currentTarget).get('email'), role: 'member' });
                        setInvite(data.inviteUrl);
                    }
                    catch (e) {
                        toast((e as Error).message);
                    }
                }}><p>Invitations are single-use and expire in seven days.</p><label>Email address<input type="email" name="email" required/></label><Button className="primary">Create invite link</Button></form>}</Modal>}</div>;
}
function Developers() {
    const boards = useQuery<{
        items: Board[];
    }>({ queryKey: ['boards', false], queryFn: () => api('/boards') });
    const [method, setMethod] = useState('GET'), [path, setPath] = useState('/me'), [body, setBody] = useState(''), [key, setKey] = useState(''), [idem, setIdem] = useState(''), [result, setResult] = useState('Send a request to see the response.'), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
    const toast = useToast();
    return <div className="page"><Header eyebrow="BUILT TO CONNECT" title="Your agents. Your tools." description="A small, predictable API. The same rules through every door."/><div className="developer-grid"><section className="panel"><div className="panel-title"><Code2 size={19}/><h2>API playground</h2><span className="badge success">Live requests</span></div><p className="muted">Requests run against this workspace and can change your boards.</p><label>Authenticate as<select onChange={e => {
            if (e.target.value === 'person')
                setKey('');
            else if (e.target.value === 'invalid')
                setKey('invalid');
            else
                setKey('paste-key');
        }}><option value="person">Your signed-in account</option><option value="key">Agent API key</option><option value="invalid">Invalid key (test 401)</option></select></label>{key && <label>Bearer key<input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off"/></label>}<label>Example<select defaultValue="/me" onChange={e => {
            if (e.target.value === 'drawing-valid' || e.target.value === 'drawing-invalid') {
                setPath('/boards/' + (boards.data?.items[0]?.id || 'BOARD_ID') + '/ops');
                setMethod('POST');
                setBody(JSON.stringify({ ops: [{ op: 'create', data: { ...DRAWING_EXAMPLE, ...(e.target.value === 'drawing-invalid' ? { strokes: [[0, 0, 10]] } : {}) } }] }, null, 2));
            }
            else if (e.target.value === 'embed-valid' || e.target.value === 'embed-invalid') {
                setPath('/boards/' + (boards.data?.items[0]?.id || 'BOARD_ID') + '/ops');
                setMethod('POST');
                setBody(JSON.stringify({ ops: [{ op: 'create', data: { ...STARTER_EMBED, ...(e.target.value === 'embed-invalid' ? { html: 'x'.repeat(20001) } : {}) } }] }, null, 2));
            }
            else {
                setPath(e.target.value);
                setMethod('GET');
                setBody('');
            }
        }}>{[['/me', 'Who am I?'], ['/boards', 'List boards'], ['/agents', 'List agents'], ['/activity?actorKind=agent', 'Agent activity'], ['/knowledge/search?q=project', 'Search knowledge'], ['/settings', 'Workspace settings'], ['drawing-valid', 'Create a pen drawing'], ['drawing-invalid', 'Malformed drawing (422)'], ['embed-valid', 'Create an HTML/CSS mockup'], ['embed-invalid', 'Oversized embed (422)']].map(([p, label]) => <option value={p} key={p}>{label}</option>)}</select></label><div className="request-line"><select aria-label="HTTP method" value={method} onChange={e => {
            setMethod(e.target.value);
            if (e.target.value === 'MCP')
                setPath('list_boards');
        }}>{['GET', 'POST', 'PATCH', 'DELETE', 'MCP'].map(m => <option key={m}>{m}</option>)}</select><input aria-label="Request path or MCP tool" value={path} onChange={e => setPath(e.target.value)}/></div><label>Idempotency-Key <span className="muted">optional</span><input value={idem} onChange={e => setIdem(e.target.value)} placeholder="16–128 characters"/></label><label>JSON body<textarea className="mono" rows={5} value={body} onChange={e => setBody(e.target.value)} placeholder="{}"/></label><Button className="primary" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
                const payload = body ? JSON.parse(body) : undefined;
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (key)
                    headers.Authorization = 'Bearer ' + key;
                if (idem)
                    headers['Idempotency-Key'] = idem;
                const response = await fetch(method === 'MCP' ? '/mcp' : '/api/v1' + path, { method: method === 'MCP' ? 'POST' : method, headers, credentials: 'include', body: method === 'GET' ? undefined : JSON.stringify(method === 'MCP' ? { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: path, arguments: payload || {} } } : payload) });
                setStatus(String(response.status));
                setResult(response.status === 204 ? 'No content' : JSON.stringify(await response.json(), null, 2));
            }
            catch (e) {
                toast((e as Error).message);
            }
            finally {
                setBusy(false);
            }
        }}><Send size={15}/>Send request</Button><div className="response-head">Response <span className="badge">{status || '—'}</span></div><pre className="response">{result}</pre></section><section className="reference"><h2>A good collaboration loop.</h2><p className="muted">Read the context. Claim your space. Make a small change. Release the claim.</p><ol className="api-loop">{['Read the board', 'Claim a region', 'Write a batch', 'Release the claim'].map((s, i) => <li key={s}><span>0{i + 1}</span>{s}</li>)}</ol><CopyCode value={`curl ${window.location.origin}/api/v1/boards \\\n  -H 'Authorization: Bearer YOUR_KEY'`}/><h3>MCP tools</h3><div className="tool-list">{Object.keys(toolSchemas).map(name => <button key={name} onClick={() => { setMethod('MCP'); setPath(name); setBody('{}'); }}><code>{name}</code><ArrowUpRight size={14}/></button>)}</div><h3>Drawing and abilities</h3><p className="muted">Drawings are numeric pen strokes in black ink: no color, fill, SVG or executable content. Each needs a short description, board size w/h, recording size vw/vh, and strokes as flat x/y coordinates. Maximum 300 strokes and 10,000 points per drawing; 200 drawings per board.</p>{ABILITIES.map(a => <p key={a.id} className="help"><strong>{a.label}</strong>: {a.description}</p>)}<p className="help">Agents always see the whole board. Write scope and the matching ability are required to change it. Forbidden actions name the missing ability.</p><h3>Live HTML/CSS mockups</h3><p className="muted">Use type embed with x/y/w/h, a title in text, and html containing self-contained HTML and CSS. Add creates a mockup; Edit revises it. No scripts, external assets, forms or popups. Up to 20,000 characters per embed and 30 embeds per board. Read JSON with includeHtml=true to revise existing code. Board snapshots currently show a labelled placeholder for embeds.</p><h3>Shared 3D models</h3><p className="muted">Create scene3d elements with named box, cylinder, sphere and cone parts. Add creates a model; Edit adds, changes or removes parts using part.add, part.update and part.delete. Part edits use ifPartVersion; whole-model updates use ifVersion. Read full JSON for part IDs and versions. Maximum 60 parts per model and 20 models per board. Orbit, pull-apart and hidden-part exploration stay local.</p><h3>Limits & errors</h3><p className="muted">{LIMITS.elements} elements per board · {LIMITS.ops} operations per batch · {LIMITS.text.toLocaleString()} characters per element</p><div className="error-list">{Object.entries(statusCodes).map(([code, n]) => <div key={code}><code>{code}</code><span>{n}</span></div>)}</div></section></div></div>;
}
export default function App() {
    const theme = useThemePreference();
    const [toast, setToast] = useState<{
        text: string;
        action?: () => void;
    } | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const notify = useCallback((text: string, action?: () => void) => { clearTimeout(timer.current); setToast({ text, action }); timer.current = setTimeout(() => setToast(null), 6000); }, []);
    return <ThemeContext.Provider value={theme}><QueryClientProvider client={qc}><ToastContext.Provider value={notify}><BrowserRouter><Routes><Route path="/login" element={<Auth />}/><Route path="/signup" element={<Auth />}/><Route path="*" element={<Shell />}/></Routes></BrowserRouter>{toast && <div className="toast" role="status"><Check size={17}/><span>{toast.text}</span>{toast.action && <button onClick={() => { toast.action?.(); setToast(null); }}>Undo</button>}<IconButton label="Dismiss notification" onClick={() => setToast(null)}><X size={16}/></IconButton></div>}</ToastContext.Provider></QueryClientProvider></ThemeContext.Provider>;
}
