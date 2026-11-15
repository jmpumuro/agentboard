# Frontend prompt

You are building `apps/web`, the browser app for AgentBoard. Read `01-architecture-prompt.md` and `02-contract-prompt.md` first, then open `prototype/index.html` and click through every screen. The prototype is the reference for navigation, layout, and behaviour. It is not production code and its data is fake; do not copy its code.

Build against the contract only. Import types from `packages/contract`. Until the backend is ready, run against a mock server generated from the contract fixtures.

## 1. Suggested stack

| Concern | Choice | Why |
|---|---|---|
| Framework | React with TypeScript | Largest ecosystem, and every coding agent knows it well |
| Build tool | Vite | Fast, simple, and a single-page app needs no server rendering |
| Routing | React Router | Standard nested routes with a shared shell |
| Server data | TanStack Query | Caching, paging, and refetch for boards, agents, activity, and settings |
| Live board state | Zustand, one store per open board | Fine-grained subscriptions so one moved note does not re-render the canvas |
| Styling | Tailwind CSS with design tokens as CSS variables | Fast to build, consistent, easy to theme |
| Accessible primitives | Radix UI (dialog, menu, switch, tooltip) | Keyboard and screen-reader behaviour handled correctly |
| Forms | React Hook Form with the contract's Zod schemas | Same validation rules as the server |
| API mocking | Mock Service Worker, fed by contract fixtures | Frontend can be finished before the backend |
| Tests | Vitest and Testing Library for units, Playwright for flows | Standard and reliable |

No whiteboard library. The canvas is ours (see stage 8 in the architecture prompt).

## 2. Routes and navigation

| Route | Screen | In nav |
|---|---|---|
| `/login`, `/signup` | Auth: email and password; signup also asks for a name and requires a password of at least 8 characters; errors show inline | no |
| `/boards` | Board list | Boards |
| `/boards/:boardId` | Board canvas | highlights Boards |
| `/agents` | Agents and keys | Agents |
| `/activity` | Activity feed | Activity |
| `/developers` | Quickstart and API reference | Developers |
| `/settings` | Workspace settings | Settings |

**Every nav item is a real page.** Each of the five destinations loads its data from, and writes through, the endpoints listed for it under "Pages and the endpoints behind them" in the contract. No page may show placeholder data or call anything outside its row. Navigation must work by click, tap and keyboard, and the browser's back and forward buttons must follow it.

**Shell:** The signed-in user's avatar in the nav opens Settings, where the account and Sign out live. at 760 px and wider, the side nav is a fixed 60 px icon rail (logo, five nav icons, the signed-in user's avatar). It expands to about 216 px with labels on hover or keyboard focus, overlaying the page with a shadow so content does not shift, and collapses when the pointer or focus leaves. Below 760 px it becomes a bottom tab bar with the same five items and labels. The current item is highlighted. Unknown routes show a not-found screen inside the shell with a link back to Boards. Signed-out visitors are redirected to `/login`.

## 3. Screens and the decision at each

### Boards
A grid of board cards: a miniature of the board's real layout, title, element count, last updated, small avatars of who is on the board now, and Delete. Delete moves the board to the trash at once and shows a toast with Undo for a few seconds; a Trash view lists trashed boards with Restore. The page subtitle shows the workspace name. A "New board" button creates a board and opens it. Empty state invites creating the first board.
**Decision:** cards show live presence so people can see where agents are working without opening each board.

### Board canvas
The main screen. Layout as in the prototype: a toolbar on top, the canvas filling the rest, and a collapsible activity panel on the right (a slide-over sheet on phones).

- **Free-form:** the canvas has no sections, frames or columns. Anything goes anywhere.
- **Top bar:** back to Boards, title (click to rename), presence avatars (agents are visually distinct from people, and highlighted while they work), an "Agent view" button that shows the exact text an agent reads (the digest), and the Activity panel toggle.
- **Floating toolbar (bottom centre):** select, pan (hand), text, note, shape, arrow, then the Agent button. A placing tool drops its element where the person taps and starts text editing at once; the arrow tool takes two taps, start then end.
- **Floating controls (top right):** undo, redo, zoom out, zoom level, zoom in, fit to content.
- **Selection bar (above the toolbar, only while something is selected):** the six colours for notes and shapes, shape kind, text size, Edit (or Label for an arrow), bring to front, send to back, Delete.
- **Activity panel:** the agent's recent API calls with status codes, then this board's activity.
- **Canvas:** pan by dragging empty space or two-finger scroll; zoom with pinch or Ctrl/Cmd plus wheel, between 25% and 200%. Elements are positioned DOM nodes; arrows are drawn in one SVG layer; everything sits in one container moved with a CSS transform.
- **Editing:** click selects, drag moves, handles resize, double-click edits text, Delete removes, Shift-click multi-selects, a small colour menu appears on selection. Undo and redo cover the current session's own changes.
- **Selecting and moving around:** with a mouse, dragging empty canvas with the select tool draws a selection box; pan with the hand tool, Space and drag, the middle button, or the wheel. With touch, one finger on empty canvas pans and two fingers pinch-zoom. Shift-click adds to the selection. Tools have single-key shortcuts (V, H, T, N, S, A) shown in their tooltips, and labels under the icons on desktop.
- **Handles and bars stay usable:** the resize handle keeps a constant size on screen at any zoom (larger on touch). The selection bar moves to the top of the canvas when the selection sits low, so it never covers what it acts on.
- **Empty board:** a centred hint says to pick a tool or ask an agent. A new board opens with its title already in rename mode. A text element left empty is removed.
- **Seeing and undoing agent work:** every finished run in the chat has "Show on board" (pans to and selects what it changed) and "Undo changes". Agent entries in the board's activity panel have Undo. Both call the revert endpoints; a refusal because something changed since is shown as a plain message.
- **Text conflicts keep the person's words:** if a person's text edit is refused with `version_conflict`, keep their text in the editor and offer "Keep mine" (retry on `details.current`) or "Use theirs". A refused move or resize retries once on top of `details.current` without asking, since geometry rarely conflicts in meaning.
- **Writes:** every change is sent as an ops batch. Apply it locally at once (optimistic), then confirm with the server's versions. Moving sends one update when the drag ends, not on every frame. On `version_conflict`, drop the local change, apply the server state, and show a brief notice ("Updated by Planner agent just now").
- **Live:** open the WebSocket on entry with the last known `seq`. Apply `ops` messages in order. On `resync`, refetch elements. On disconnect, show a small "Reconnecting" badge and retry with backoff.
- **Claims:** a claim renders as a dashed labelled frame in the agent accent colour showing the agent's name and note. It is not interactive and never blocks editing.
- **Attribution:** elements last changed by an agent show a small agent mark; hovering shows who and when.

**Decision:** the store holds the server-confirmed state and a short list of pending local batches; what is drawn is confirmed state with pending batches applied on top. This makes rollback on conflict trivial and keeps live updates from other actors from fighting local edits.
**Decision:** optimistic updates for people, because dragging must feel instant. Agents never go through this path.

### Agent chat (on the board canvas)
The Agent button in the floating toolbar toggles a floating chat panel above the toolbar; the canvas stays usable behind it.
- **Header:** agent picker (active agents only) and close. Under it, one line listing what the chosen agent can use: board tools (read or read and write), knowledge search, its instructions, external MCP servers.
- **Log:** the person's messages, and for each run the agent's name, its steps as they stream in (status mark, a kind badge such as PROMPT, PLAN, MCP, RAG, the tool name, one short note), then the reply. Failed steps show the error code.
- **Input:** one text field and Send. While a run is in progress the button reads Stop and cancels the run. Before the first message, show a few example requests as chips.
- **Data:** `POST /boards/{id}/runs`, then render from `{ t: "run" }` WebSocket messages. Past runs for the board load from `GET /boards/{id}/runs` when the panel opens.
- The board updates through the normal live feed while the agent works, including its claim frame.

**Decision:** chat is a panel on the canvas, not a separate screen, so the person watches the board change while reading the steps.
**Decision:** steps are always visible, never collapsed behind a spinner. Seeing which tool ran, and which was skipped for lack of a capability, is what makes the agent's work trustworthy.

### Agents
A table of agents: name, harness, scopes, capabilities, key prefix, last seen, status. "Connect agent" opens a dialog asking for name, harness, scopes, capabilities (knowledge search, external MCP servers), instructions, and runner (built-in or webhook URL). "Edit" reopens the same dialog. The dialog also sets board access: all boards, or only the ones ticked. On phones the table keeps name, scopes, status and actions and drops the rest. On create, show the key once with a copy button, a clear warning that it will not be shown again, and ready-to-paste snippets (curl and an MCP client config). Row actions: rotate key, revoke (both confirm first).
**Decision:** connection snippets are generated with the real base URL and the new key, so going from "connect" to a first successful call is a paste.

### Activity
Each entry links to its board.
A reverse-chronological feed across all boards: actor, summary, board (linked), relative time. Filters: all, people, agents; and by board. Infinite scroll using cursor paging.
**Decision:** activity is a top-level destination, because reviewing what agents did is a routine task.

### Developers
Two parts.
- **API console:** send a real request and see the status and JSON. Controls: act as (yourself, any agent including revoked ones, or an invalid key), a list of worked examples that fill the form, path or MCP tool name, method (GET, POST, PATCH, DELETE, or MCP to call a tool), an optional `Idempotency-Key`, and a JSON body. The examples must include: who am I, list boards, digest, elements, knowledge search, three MCP tool calls, start a run, claim, create a note, a stale update that returns `version_conflict`, and a delete that is refused by the delete rule. Below it, a list of recent agent calls.
- **Reference:** the read, claim, write, release loop, the MCP tool list, the error table, and the limits. Content comes from the contract package so it cannot go stale. Code blocks have copy buttons.
**Decision:** docs and a live console sit inside the app so the base URL and examples match the deployment, and anyone can see how scopes, capabilities and settings change a response without writing code.

### Settings
Workspace name, the knowledge documents (list, add by pasting text, remove), the two agent safety switches from `WorkspaceSettings` with a one-line explanation each, and the signed-in user's profile and sign-out.
**Decision:** safety switches save immediately and say so, with no separate save button.

## 4. Cross-cutting requirements

- **States:** every screen has loading (skeletons), empty, and error states. Errors show the contract's `message` and a retry.
- **Accessibility:** full keyboard use outside the canvas; on the canvas, Tab moves between elements in reading order, arrow keys nudge the selection, Enter edits. Visible focus rings. Colour contrast at WCAG AA. Respect reduced-motion.
- **Responsive:** usable from 360 px wide. On phones, the canvas supports touch pan, pinch zoom, tap to select, and double-tap to edit.
- **Theming:** light and dark through CSS variables, following the system setting.
- **Performance:** a board with 800 elements pans and zooms smoothly; dragging one note re-renders only that note.
- **Security:** board text is always rendered as text, never as HTML. API keys are held in component state only while the dialog is open and never stored.

## 5. Structure

```
apps/web/src/
  app/            # router, shell, providers
  api/            # typed client built from contract types; one function per endpoint
  features/
    boards/  board/  agents/  activity/  developers/  settings/  auth/
  board-engine/   # store, ops queue, websocket client, geometry; no React imports
  ui/             # shared components
  mocks/          # MSW handlers from contract fixtures
```

Keep `board-engine` free of React so it can be unit-tested directly.

## 6. Build order

1. Shell, routing, auth screens, API client, mocks.
2. Boards list.
3. Board canvas read-only: render elements, pan, zoom.
4. Editing with optimistic ops and conflict rollback.
5. Live updates, presence, claims.
6. Agents, Activity, Developers, Settings.
7. Accessibility, responsive pass, dark theme, performance check.

## 7. Tests that must exist

- Engine: applying ops, pending-batch overlay, rollback on conflict, in-order application of live messages, resync.
- Playwright: open the agent chat, ask for ideas, see the steps stream and the notes appear; ask with a read-only agent and see the reply with no board change.
- Playwright: sign in; create a board; add, move, edit, and delete a note; a note added through the API by an agent appears without reload along with its claim frame; connect an agent and copy its key; filter activity by agents; toggle a setting.
- Every nav item reaches its screen on desktop and phone widths.

## 8. Acceptance checks

- `pnpm --filter web build` and `pnpm --filter web test` pass; Playwright flows pass against mocks and against the real backend.
- Every screen in the prototype exists and is reachable from the nav.
- No type is declared locally that the contract already exports.
- Final report lists what was built per screen, any contract gaps found (report them; do not work around them), and a "Proposed, not built" list.
