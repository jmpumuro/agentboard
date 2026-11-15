# AgentBoard build kit

AgentBoard is a shared whiteboard that people and AI agents work on together. Any agent or harness can read a board, add ideas, and build on what is there through a small REST API, a WebSocket feed, or MCP tools. "AgentBoard" is a working name; rename freely.

This kit is written for a coding agent (or several) to implement the app.

## What is in the kit

| File | Purpose |
|---|---|
| `01-architecture-prompt.md` | System shape, build stages, and the design decision made at each stage |
| `02-contract-prompt.md` | The single source of truth: data model, REST, WebSocket, MCP tools, errors, limits |
| `03-backend-prompt.md` | Backend build prompt with the suggested stack and framework |
| `04-frontend-prompt.md` | Frontend build prompt with the suggested stack and screen-by-screen spec |
| `05-review.md` | Review of backend gaps and frontend flow: each finding, why it matters, and where it was fixed |
| `prototype/index.html` | Working prototype with full navigation. Open it in a browser. |

## What the prototype does

Everything in the prototype works, and every function in it is specified in the prompts (see the table further down). It is one HTML file with three parts, marked in its source:

1. **An in-page backend** that follows `02-contract-prompt.md`: the same paths, operation format, versions, claims, scopes, settings, error codes and limits. Data is kept in the browser's local storage where allowed.
2. **The chat agent.** Tap Agent on a board, pick an agent, and ask in plain words. There is no model in the prototype: a small rule-based planner stands in for it and understands a limited set of requests (ideas, questions, next steps, summary, tidy, recolour, clear). After planning, every step is a real call made with the agent's own key and shown in the chat by kind: PROMPT (its instructions), MCP (board tools), RAG (knowledge search). Scopes, capabilities, revoked keys and workspace settings therefore apply. In the real app a model runs this loop; see stage 10 in the architecture prompt and stage K in the backend prompt.
3. **The app**, which talks to the backend only through the same API a real frontend would use.

Boards are free-form: no sections or frames, anything goes anywhere, and agents place new notes in open space beside related ones.

Things to try: sign up, sign out and sign in; hover the side rail to expand it; add, move, resize, recolour, edit, reorder and delete notes, shapes, text and arrows; undo and redo; pan and zoom; the Agent chat on a board (try the same request with each agent to see capabilities change the steps); "Digest" to see what an agent reads; connect, edit, rotate and revoke agents; add a knowledge document under Settings and ask about its topic; the API console under Developers (including a version conflict and the delete rule); the two safety switches under Settings.

Where the prototype stands in for something a single HTML file cannot hold:

| The real app has | The prototype uses |
|---|---|
| A model running the tool loop | A rule-based planner that understands a fixed set of requests |
| HTTP, WebSocket and MCP transports | Direct function calls to the in-page backend; a second browser tab receives changes live |
| Embedding search with pgvector | Keyword matching over the knowledge documents |
| External MCP servers at real URLs | One simulated server, "Idea library" |
| An outside harness behind a webhook | A simulated harness that reports steps through the same run endpoints |
| Many users with owner and member roles, invites, Argon2id password hashes | One account kept in the browser; do not use a real password |
| A worker queue for runs, outbound-request filtering, encrypted secrets, CSRF and Origin checks | Not applicable inside one page; specified in the backend prompt |

## Where each function is specified

| Function in the prototype | Contract (02) | Backend (03) | Frontend (04) |
|---|---|---|---|
| Sign up, sign in, sign out | `/auth/*`, `/me` | Stage B | Routes, Settings |
| Collapsing side nav, bottom tabs on phones, not-found | | | Shell |
| Boards: list with miniatures, create, rename, delete | `/boards` | Stage C | Boards, Board canvas |
| Free-form canvas: note, shape, text, arrow; move, resize, edit, recolour, kind, size, front and back, delete, multi-select | Elements, Operations | Stage D | Board canvas |
| Undo and redo, pan, zoom, fit | | | Board canvas |
| Live updates, presence, claim frames | WebSocket, Claims | Stages F, G | Board canvas |
| Digest view | The digest | Stage E | Board canvas |
| Version conflicts, atomic batches, idempotent retries | Operations, Errors | Stage D | Board canvas (writes) |
| Agent chat with streamed steps and Stop | Runs | Stage K | Agent chat |
| Agent capabilities: instructions, board tools, knowledge search, external MCP servers, built-in or webhook runner | Agent, MCP tools, Runs | Stages C, H, K | Agents, Agent chat |
| Agents: connect, edit, rotate key, revoke | `/agents` | Stage C | Agents |
| Knowledge documents and search | `/knowledge` | Stage K | Settings |
| Activity feed with filters | `/activity` | Stage D | Activity |
| API console and reference | all | all | Developers |
| Safety switches: delete rule, claim required | WorkspaceSettings, Errors | Stages D, G | Settings |
| Rate limits and size limits | Limits | Stage I | Developers |
| Undo an agent's run or a single change; "Show on board" | Runs, `batches/{seq}/revert` | Stage D | Board canvas |
| Trash and restore for boards | `/boards` | Stage C | Boards |
| Per-agent board access | Agent | Stages B, D | Agents |
| Selection box, shortcuts, constant-size handles, empty-board hint | | | Board canvas |

## How to use it

1. Give the agent `01-architecture-prompt.md` first, with `prototype/index.html` attached, so it has the full picture.
2. Run `02-contract-prompt.md` next. Its output (the `packages/contract` package) must exist before backend or frontend work starts.
3. Run `03-backend-prompt.md` and `04-frontend-prompt.md`. These can go to two agents in parallel, because both build against the contract only.
4. Each prompt ends with acceptance checks. An agent is done with a prompt only when those pass.

If you use one agent, paste the prompts in order in one session. If you use several, give every agent files 01 and 02 as context in addition to its own prompt.

## Rules that apply to every prompt

- The contract wins. If a prompt and the contract disagree, follow the contract and report the mismatch.
- The prototype shows layout, navigation, and behaviour, and its in-page backend is a worked example of the contract's rules. It is not production code; do not copy its code. Its data is fake and its keys work only inside the page.
- Do not add features outside the listed scope. List ideas under "Proposed, not built" in your final report.
- Use the current stable release of every dependency, and read its current documentation before using it. No versions are pinned here on purpose.
