# Architecture prompt

You are the lead engineer for AgentBoard. Read this whole file and open `prototype/index.html` before writing anything. Your job in this prompt is to scaffold the repository and record the architecture so that the contract, backend, and frontend prompts can be carried out without further design work.

## 1. Product in one paragraph

AgentBoard is a web app where people and AI agents share whiteboards. A board is a free-form canvas: notes, shapes, text and arrows placed anywhere. There are no sections, frames, columns or any required structure; people and agents arrange things however they like. People edit in the browser. Agents edit through an API key using REST, or through MCP tools, and every harness (Claude Code, LangGraph, a cron script, anything that can make an HTTP call) is treated the same. Everyone sees changes live, sees who is working where, and can audit what each agent did.

## 2. Principles

1. **One contract, three doors.** Browser, REST clients, and MCP tools all go through the same service layer and the same operation format. No door has powers the others lack.
2. **Agents are first-class actors.** Every write records who made it (user or agent). Agent activity is always visible and reversible by a person.
3. **Readable by a model.** A board can be fetched as a compact text digest, so an agent can understand it without parsing geometry.
4. **Never lose a person's work.** Writes are small, versioned operations. Nothing rewrites a whole board.
5. **Boring technology.** One language, one database, one deployable service in v1.

## 3. System shape

```
 Browser (React SPA) ──HTTP──┐
        │  └────WebSocket────┤
 Agent / harness ───REST─────┤──▶  API service (Node)
 MCP client ────────/mcp─────┘      ├─ routes: REST, WS, MCP
                                    ├─ service layer: boards, ops, claims, agents, activity, knowledge, runs
                                    ├─ runner: model tool loop for chat runs
                                    └─ PostgreSQL (data + LISTEN/NOTIFY fan-out)
```

## 4. Repository layout

```
agentboard/
  packages/contract/   # schemas, types, OpenAPI, generated from prompt 02
  apps/api/            # backend, prompt 03
  apps/web/            # frontend, prompt 04
  docs/adr/            # one short decision record per stage below
  docker-compose.yml   # postgres + api + web for local use
```

Use a pnpm workspace monorepo in TypeScript.

## 5. Stages and the decision at each one

Build in this order. For each stage write `docs/adr/NN-<name>.md` containing the decision, the reason, and the rejected alternative, copied or tightened from below.

### Stage 1: Contract first
- **Decision:** A `packages/contract` package holds Zod schemas as the source of truth. TypeScript types and the OpenAPI file are generated from them. Backend validates with them; frontend imports the types.
- **Why:** Backend and frontend can be built in parallel by different agents and cannot drift.
- **Rejected:** Hand-written OpenAPI plus hand-written types, because they diverge within days.

### Stage 2: Data model
- **Decision:** One row per element, with a `version` integer on each element and a `seq` counter on each board that increases with every committed batch. Type-specific fields live in a JSON `props` column.
- **Why:** Row-level versions give cheap optimistic concurrency. The board `seq` gives clients an ordered feed to resume from.
- **Rejected:** Storing the board as one JSON document (every write conflicts with every other). CRDTs such as Yjs (strong for free-text co-editing, but opaque to agents that write over plain HTTP, and more than v1 needs).

### Stage 3: Write path
- **Decision:** All changes are batches of operations (`create`, `update`, `delete`) sent to one endpoint. A batch is atomic. An operation on an existing element must carry `ifVersion`; a mismatch rejects the whole batch with `version_conflict`.
- **Why:** An agent that worked from a stale read is told so and re-reads, instead of overwriting a person's edit. Atomic batches keep a multi-element change (a note plus its arrow) consistent.
- **Rejected:** Last-write-wins, because agents are slow writers and would routinely clobber people.

### Stage 4: Realtime
- **Decision:** One WebSocket per open board. The server broadcasts each committed batch with its `seq`. Clients resume with `sinceSeq`; if the gap is too large the server tells the client to refetch. Fan-out between API instances uses PostgreSQL LISTEN/NOTIFY.
- **Why:** Server-authoritative ordering is simple to reason about, and LISTEN/NOTIFY avoids a second piece of infrastructure in v1.
- **Rejected:** Redis pub/sub (add it only when one Postgres can no longer carry the fan-out). Polling (too slow for cursors and claims).

### Stage 5: Identity and access
- **Decision:** People sign in with email and password and get an httpOnly session cookie. Agents use workspace-scoped API keys with scopes `boards:read` and `boards:write`, sent as a bearer token. Keys are shown once and stored hashed. Both resolve to one `Actor` type used everywhere downstream.
- **Why:** Cookies suit browsers; bearer keys suit every harness. One actor type keeps authorization and activity logging uniform.
- **Rejected:** OAuth for agents in v1 (heavy for scripts). Sharing a person's session with an agent (no separate audit trail, no separate revocation).

### Stage 6: Agent ergonomics
- **Decision:** Three agent-specific features: a text **digest** of a board, **claims** (an agent marks the region or elements it is about to change; people see a labelled frame; claims expire on their own), and an **MCP endpoint** exposing the same service layer as tools.
- **Why:** The digest keeps an agent's context small. Claims make slow agent work visible, so the board never looks unresponsive. MCP makes the board usable from any MCP-capable harness without custom code.
- **Rejected:** Locks that block people (a stuck agent would freeze the board). A separate MCP service (a second deployable and a second place for rules).

### Stage 7: Frontend shell and navigation
- **Decision:** A single-page React app. On desktop the side nav is a narrow icon rail that expands over the page on hover or keyboard focus and collapses when the pointer leaves, so the canvas keeps its width. On phones it is a bottom tab bar. Routes: Boards, Board canvas, Agents, Activity, Developers, Settings. The prototype is the reference for layout and flow.
- **Why:** The same five destinations are needed on every screen, and agents need visible, first-class places (Agents, Activity, Developers) instead of being hidden in settings.
- **Rejected:** A canvas-only app with modals for everything, because managing agents and reviewing activity are tasks of their own.

### Stage 8: Canvas rendering
- **Decision (free-form):** The board has no grouping element. The element types are note, shape, text and arrow, and position is the only structure. Agents place new elements in open space beside related ones (for example next to notes of the same colour) and must never cover an existing element. The digest gives every element's position and size so a model can reason about layout.
- **Why:** Sections forced a template on every board and made agents depend on it. Free placement suits any kind of thinking, and a text label does the job of a heading when someone wants one.
- **Rejected:** Sections or frames as an element type, and any agent logic that needs them.
- **Decision:** Render elements as positioned DOM nodes with an SVG layer for arrows, inside one container moved by a CSS transform for pan and zoom. Own the element model; do not adopt a whiteboard library's document format.
- **Why:** Boards are capped at 800 elements, which the DOM handles well, and text editing, accessibility, and styling come free. Owning the model keeps the contract ours.
- **Rejected:** tldraw or React Flow as the core (their document model would become our API). A `<canvas>` or WebGL renderer (needed only at tens of thousands of elements).

### Stage 9: Activity and safety
- **Decision:** Every committed batch writes an activity event with the actor and a short summary. Per-key rate limits and per-board size limits are enforced in the service layer. A workspace setting can forbid agents from deleting elements they did not create.
- **Why:** Trust in agents on a shared surface depends on being able to see and bound what they do.
- **Rejected:** Logging only at the HTTP layer, because MCP and WebSocket writes would be missed.

### Stage 9b: Reversibility and access (part of stages 3, 5 and 9)
- **Decision:** Every batch keeps an undo record, and a person can revert any single batch or a whole agent run. Boards are soft-deleted to a trash for 30 days. Each agent can be limited to chosen boards. The first account owns the workspace; others join by invite as members, and only owners manage agents, keys, knowledge and settings.
- **Why:** The principle "agent activity is always visible and reversible" needs a real mechanism, not just a log. Open signup with full rights for everyone, keys that reach every board, and instant hard deletes were the three places where one mistake was unrecoverable.
- **Rejected:** Relying on each person's in-session undo (it cannot undo an agent). Full board version history (more than v1 needs; the per-batch undo record gives most of the value).

### Stage 10: Agent chat and runs
- **Decision:** On a board, the Agent button opens a floating chat. The person picks an agent and asks in plain words. The backend creates a **run**: a built-in runner drives a model in a tool loop, and the model decides which of the agent's capabilities to use. Capabilities are set per agent: its **instructions** (system prompt), the **board tools** (the same MCP tools external agents get, limited by the key's scopes), **knowledge search** (retrieval over workspace documents), and optional **external MCP servers**. Every step of a run is recorded and streamed to the chat as it happens. An agent whose harness lives elsewhere can take runs through a webhook instead and report steps back.
- **Why:** People should not need to know tool names. Routing the runner through the agent's own key and the same service layer means scopes, claims, limits and the activity log apply to chat-driven work exactly as they do to outside agents. Showing steps keeps the agent's work inspectable.
- **Decision (execution):** runs are queued in PostgreSQL and executed by a worker loop, not inside the web request, so a restart or deploy does not lose them and model spend is capped per run, per agent and per workspace.
- **Rejected:** A separate "assistant" with its own privileged write path (two sets of rules). Letting the browser call the model directly (leaks keys, no audit). Hard-coded task buttons (the prototype's first version; too rigid).

### Stage 11: Delivery
- **Decision:** One Docker image for the API (which also serves the built web app in production), one PostgreSQL database, configuration by environment variables, migrations run on start-up.
- **Why:** One container and one database can be hosted anywhere and run locally with one command.
- **Rejected:** Separate services per concern, and serverless functions (long-lived WebSockets fit poorly).

## 6. Out of scope for v1

Sections, frames or any other grouping element, freehand drawing, images and file uploads (knowledge documents are pasted text in v1), comments and threads, multiple workspaces per user, SSO, board templates, version history and undo across sessions, public share links. Do not build these. Leave room for them only where it costs nothing.

## 7. What to produce from this prompt

1. The monorepo scaffold in section 4, with linting, formatting, type-checking, and a test runner wired at the root.
2. `docs/adr/01` to `11`, one per stage.
3. `docker-compose.yml` that starts PostgreSQL.
4. A root `README.md` with setup and run commands.

## 8. Acceptance checks

- `pnpm install` and `pnpm -r typecheck` succeed on a clean clone.
- `docker compose up` starts PostgreSQL and it accepts connections.
- Twelve ADR files exist (stage 9b has its own) and each states decision, reason, and rejected alternative.
- No application logic has been written yet beyond placeholders.
