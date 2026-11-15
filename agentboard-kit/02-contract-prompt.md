# Contract prompt

You are building `packages/contract` for AgentBoard. This package is the single source of truth for every shape that crosses a boundary: REST, WebSocket, and MCP. Backend and frontend are built against it by other agents, so be exact and do not leave choices open.

Read `01-architecture-prompt.md` first.

## 1. What to produce

- `src/schemas/*.ts`: Zod schemas for everything in this file.
- `src/types.ts`: TypeScript types inferred from the schemas, exported.
- `src/errors.ts`: the error codes and the error body schema.
- `src/limits.ts`: the limits as exported constants.
- `openapi.yaml`: generated from the schemas by a script (`pnpm --filter contract build:openapi`), never edited by hand.
- `src/ws.ts`: schemas for every WebSocket message.
- `src/mcp.ts`: name, description, and input schema of every MCP tool.
- `src/fixtures/`: one valid example of every schema, used by tests on both sides.
- Tests that parse every fixture with its schema.

## 2. Conventions

- Base path `/api/v1`. JSON only. Field names in camelCase.
- IDs are opaque strings. Server-made IDs are prefixed: `usr_`, `agt_`, `brd_`, `clm_`, `evt_`. Element IDs may be supplied by the client (1 to 40 characters from `A-Za-z0-9_-`) or left out for the server to assign (`el_` prefix).
- Timestamps are ISO 8601 strings in UTC.
- Lists use cursor paging: `?limit=` (default 50, maximum 200) and `?cursor=`; responses are `{ items, nextCursor }` with `nextCursor` null at the end.
- Coordinates are numbers in board units; x grows right and y grows down.

## 3. Data model

```ts
type Actor = { kind: "user" | "agent"; id: string; name: string };

type User = { id: string; email: string; name: string; role: "owner" | "member"; createdAt: string };
// The first account is the owner. Later accounts need an invite. Owners manage agents, keys, knowledge, settings, members and the trash; members work on boards and chat with agents.

type Agent = {
  id: string;
  name: string;                       // 1-60 chars
  harness: string;                    // free text, e.g. "claude-code", "langgraph", "custom"
  scopes: ("boards:read" | "boards:write")[];
  capabilities: ("knowledge")[];      // board tools are always available, limited by scopes
  instructions: string;               // the agent's system prompt, up to 2,000 chars; may be empty
  boardIds: string[] | null;          // boards this agent may reach; null means all. Other boards answer not_found.
  mcpServers: { name: string; url: string; hasSecret: boolean }[];   // external MCP servers the built-in runner may call; up to 5. Send `secret` (an Authorization header value) on write; it is stored encrypted and never returned.
  runner: { kind: "builtin" } | { kind: "webhook"; url: string };   // who executes chat runs. Creating or switching to a webhook returns a `webhookSecret` once.
  keyPrefix: string;                  // first 10 chars of the key, for display
  status: "active" | "revoked";
  lastSeenAt: string | null;
  createdAt: string;
};

type Board = {
  id: string;
  title: string;                      // 1-120 chars
  seq: number;                        // increases by 1 with every committed batch
  order: string[];                    // element ids, back to front
  elementCount: number;
  createdBy: Actor;
  createdAt: string;
  updatedAt: string;
};

type Color = "yellow" | "blue" | "green" | "pink" | "purple" | "white";

type ElementBase = {
  id: string;
  version: number;                    // starts at 1, +1 on every update
  x: number; y: number;
  createdBy: Actor;
  updatedBy: Actor;
  updatedAt: string;
};

type Element =
  | (ElementBase & { type: "note";    w: number; h: number; text: string; color: Color })
  | (ElementBase & { type: "shape";   w: number; h: number; text: string; color: Color;
                     kind: "rect" | "rounded" | "ellipse" | "diamond" })
  | (ElementBase & { type: "text";    text: string; size: "small" | "body" | "large" | "title" })
  | (ElementBase & { type: "arrow";   from: string; to: string; label?: string });  // from/to are element ids; x,y ignored

type Claim = {
  id: string;
  boardId: string;
  actor: Actor;
  target: { rect: { x: number; y: number; w: number; h: number } } | { elementIds: string[] };
  note?: string;                      // up to 80 chars, e.g. "Adding risk ideas"
  expiresAt: string;                  // 60 s after creation or last renewal
};

type ActivityEvent = {
  id: string;
  boardId: string;
  boardTitle: string;
  actor: Actor;
  seq: number;
  summary: string;                    // server-written, e.g. "added 3 notes", "moved 1 note"
  counts: { created: number; updated: number; deleted: number };
  at: string;
};

type KnowledgeDoc = { id: string; title: string; text: string; createdAt: string };   // text up to 20,000 chars
type Passage = { docId: string; title: string; passage: string; score: number };

type RunStep = {
  id: string;
  kind: "prompt" | "plan" | "mcp" | "rag" | "tool";   // mcp = a board or external MCP tool, rag = knowledge search
  name: string;                       // e.g. "read_board", "search_knowledge"
  note: string;                       // one short line for the chat
  status: "running" | "done" | "failed" | "skipped";
};
type Run = {
  batches: number[];                  // seq of each batch this run wrote
  touched: string[];                  // ids of elements it created or changed
  reverted: boolean;
  id: string;                         // run_ prefix
  boardId: string;
  agentId: string;
  requestedBy: Actor;                 // the person who asked
  message: string;                    // their words, up to 2,000 chars
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  steps: RunStep[];
  reply: string | null;               // the agent's answer in plain text
  error: { code: string; message: string } | null;
  createdAt: string;
  finishedAt: string | null;
};

type WorkspaceSettings = {
  name: string;
  agentsCanDeleteOthersElements: boolean;   // default false
  requireClaimBeforeAgentWrite: boolean;    // default false
};
```

## 4. Operations

Every change to a board's elements is a batch of operations.

```ts
type Op =
  | { op: "create"; id?: string; data: ElementInput }             // ElementInput = Element without base fields other than x, y
  | { op: "update"; id: string; ifVersion: number; data: Partial<ElementInput> }   // type cannot change
  | { op: "delete"; id: string; ifVersion: number }
  | { op: "restack"; ids: string[]; to: "front" | "back" };       // z-order as a relative move; needs no version and cannot clash with new elements

type OpsRequest  = { ops: Op[] };                                 // 1 to 50 operations
type OpsResponse = { seq: number; results: { id: string; version: number | null }[] };   // version null for deletes
```

Rules:
- A batch is atomic: all operations commit or none do.
- Boards are free-form: there is no grouping element, and `x`, `y` are the only structure.
- Created elements are appended to the top of `order` unless `order` is sent.
- Bring-to-front and send-to-back are `restack` operations. A client never sends the whole `order`, because a full list written from a stale read would drop elements someone else just added. `restack` adds one result per id with its unchanged version.
- Every committed batch stores what is needed to undo it (the previous values of changed fields, and whole deleted elements) for the latest 100 batches per board.
- An `Idempotency-Key` reused with a different body is refused with `validation_failed`.
- `x` and `y` must be within 100,000 of the origin; `w` and `h` between 20 and 4,000.
- An arrow must join two different existing elements, neither of which is an arrow; a batch that leaves a broken arrow is refused with `validation_failed`.
- Deleting an element also deletes arrows attached to it; these are included in `results`.
- An `Idempotency-Key` header (16 to 128 characters) makes a retry return the first result.

## 5. REST endpoints

Auth column: **S** = session cookie, **K** = API key with the scope shown. Where both are listed, either works.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /auth/signup` | none | `{ email, name, password, invite? }` | `User`, sets cookie. Open only while the workspace has no account; afterwards `invite` is required. |
| `POST /auth/login` | none | `{ email, password }` | `User`, sets cookie |
| `POST /auth/logout` | S | none | 204 |
| `GET /me` | S, K | none | `{ actor: Actor, scopes: string[] }` |
| `GET /boards` | S, K read | paging | page of `Board` |
| `POST /boards` | S, K write | `{ title }` | `Board` |
| `GET /boards/{id}` | S, K read | none | `Board` |
| `PATCH /boards/{id}` | S, K write | `{ title }` | `Board` |
| `DELETE /boards/{id}` | S owner | none | 204. Moves the board to the trash; it is purged after 30 days. Stops its runs. |
| `GET /boards?trashed=true` | S owner | paging | page of trashed `Board` (each has `deletedAt`) |
| `POST /boards/{id}/restore` | S owner | none | `Board` |
| `POST /boards/{id}/batches/{seq}/revert` | S | none | `OpsResponse`. Undoes one batch as a new batch. Refused with `version_conflict` (`details.ids`) if any element it touched has changed since. |
| `POST /auth/invites` | S owner | `{ email, role }` | `{ inviteUrl }` (single use, expires in 7 days) |
| `GET /members`, `PATCH /members/{id}`, `DELETE /members/{id}` | S owner | role change or removal | `User[]`, `User`, 204 |
| `GET /boards/{id}/elements` | S, K read | none | `{ seq, order, elements: Element[] }` |
| `POST /boards/{id}/ops` | S, K write | `OpsRequest` | `OpsResponse` |
| `GET /boards/{id}/digest` | S, K read | none | `{ seq, text }` |
| `GET /boards/{id}/claims` | S, K read | none | `{ items: Claim[] }` |
| `POST /boards/{id}/claims` | S, K write | `{ target, note? }` | `Claim` |
| `POST /boards/{id}/claims/{claimId}/renew` | S, K write | none | `Claim` |
| `DELETE /boards/{id}/claims/{claimId}` | S, K write | none | 204 |
| `GET /activity` | S | paging, `?boardId=`, `?actorKind=` | page of `ActivityEvent` |
| `GET /agents` | S | none | `{ items: Agent[] }` |
| `POST /agents` | S | `{ name, harness, scopes, capabilities?, instructions?, mcpServers?, runner? }` | `{ agent: Agent, key: string }` (key shown only here) |
| `PATCH /agents/{id}` | S | any of `name, scopes, capabilities, instructions, mcpServers, runner` | `Agent` |
| `GET /knowledge` | S | none | `{ items: KnowledgeDoc[] }` |
| `POST /knowledge` | S | `{ title, text }` | `KnowledgeDoc` |
| `DELETE /knowledge/{id}` | S | none | 204 |
| `GET /knowledge/search?q=&limit=` | S, K with the `knowledge` capability | none | `{ items: Passage[] }` (limit default 3, maximum 10) |
| `POST /boards/{id}/runs` | S | `{ agentId, message }` | `Run` with status `queued` (HTTP 202) |
| `GET /boards/{id}/runs` | S | paging | page of `Run`, newest first |
| `GET /runs/{runId}` | S | none | `Run` |
| `POST /runs/{runId}/cancel` | S | none | `Run` |
| `POST /runs/{runId}/revert` | S | none | `Run` with `reverted: true`. Undoes every batch the run wrote, newest first, all or nothing. |
| `POST /runs/{runId}/steps` | K (the run's agent, webhook runner only) | `{ kind, name, note, status, id? }` (send `id` to update a step) | `RunStep` |
| `POST /runs/{runId}/finish` | K (the run's agent, webhook runner only) | `{ reply }` or `{ error }` | `Run` |
| `POST /agents/{id}/rotate-key` | S | none | `{ agent: Agent, key: string }` |
| `DELETE /agents/{id}` | S owner | none | 204 (sets status to revoked, cancels its runs, closes its sockets) |
| `GET /settings` | S | none | `WorkspaceSettings` |
| `PATCH /settings` | S | partial `WorkspaceSettings` | `WorkspaceSettings` |

API keys look like `ab_live_` followed by 40 random characters and are sent as `Authorization: Bearer <key>`.

### The digest

`GET /boards/{id}/digest` returns plain text for a model to read. Format, exactly:

```
# <board title>  (seq <n>, <count> elements)

## Elements
- [<id> v<version>] note/<color> @<x>,<y> <w>x<h>: <text on one line>  (by <actor name>)
- [<id> v<version>] shape/<kind>/<color> @<x>,<y> <w>x<h>: <text on one line>  (by <actor name>)
- [<id> v<version>] text/<size> @<x>,<y>: <text on one line>  (by <actor name>)

## Arrows
- [<id> v<version>] <from id> -> <to id>: <label or "">

## Active claims
- <actor name>: <note or "working">  (expires <time>)
```

Text longer than 200 characters is clipped and marked `… [clipped, <n> chars]`. When the size budget runs out, the list ends with `- … <n> more elements not shown. Read the board as JSON for the rest.` `GET /boards/{id}/elements` accepts `?ids=` and `?near=x,y,w,h` to read part of a large board.

Elements are listed top to bottom, then left to right. Each heading is left out when it would be empty. The actor shown is the one who last changed the element.

## 6. WebSocket

`GET /api/v1/boards/{id}/live?sinceSeq=<n>` upgrades to a WebSocket. It accepts the session cookie, or an API key with `boards:read` sent in the `Authorization` header. Keys never go in a URL, where they would end up in logs. For cookie connections the server checks the `Origin` header against the web origin and refuses anything else.

Server to client:

```ts
type ServerMsg =
  | { t: "hello"; seq: number; presence: Presence[]; claims: Claim[] }
  | { t: "ops"; seq: number; actor: Actor; ops: AppliedOp[]; order: string[] }   // AppliedOp: { op, element } or { op: "delete", id }
  | { t: "resync" }                                    // gap too large; client must refetch elements
  | { t: "presence"; presence: Presence[] }
  | { t: "claim"; claim: Claim }
  | { t: "claimEnd"; claimId: string }
  | { t: "board"; board: Board }                       // title changed
  | { t: "run"; run: Run };                            // sent on every change to a run on this board

type Presence = { actor: Actor; cursor: { x: number; y: number } | null };
```

Client to server:

```ts
type ClientMsg = { t: "cursor"; x: number; y: number } | { t: "ping" };
```

Writes never go over the WebSocket; they go through `POST /ops`. On connect, missed batches after `sinceSeq` are replayed as `ops` messages before `hello`, or `resync` is sent if more than 500 were missed.

## 7. MCP tools

Served at `/mcp` (Streamable HTTP), authenticated with the same API key. Each tool maps to one service call.

| Tool | Input | Returns |
|---|---|---|
| `list_boards` | `{ limit?, cursor? }` | page of boards (id, title, elementCount, updatedAt) |
| `read_board` | `{ boardId, format?: "digest" \| "json" }` | digest text (default) or full elements |
| `write_board` | `{ boardId, ops: Op[], idempotencyKey? }` | `OpsResponse` |
| `create_board` | `{ title }` | `Board` |
| `claim` | `{ boardId, target, note? }` | `Claim` |
| `release_claim` | `{ boardId, claimId }` | `{ ok: true }` |
| `search_knowledge` | `{ query, limit? }` | passages; refused with `forbidden` without the `knowledge` capability |
| `get_guide` | `{}` | short text: how to lay out a board well, the limits, and the read, claim, write, release loop |

Tool descriptions must tell the model to read before writing, to claim before a multi-step change, and to re-read after a `version_conflict`.

### Runs

A run is one request from a person to one agent on one board. Rules:
- The built-in runner acts as the agent's actor, with exactly that agent's scopes, capabilities and board access, through the same service layer as REST and MCP. It does not use the API key, which the server stores only as a hash. A run never has more power than the agent, and never more than the person who asked.
- A run records the `seq` of every batch it writes (`batches`) and the ids it changed (`touched`), so a person can see and undo its work.
- Text on the board, retrieved passages and results from external MCP servers are untrusted data. They never change which tools a run may use.
- A webhook runner receives `POST <url>` with `{ run, boardId, apiBase }`, signed with an HMAC-SHA256 of the timestamp and body using the agent's `webhookSecret`, in `X-AgentBoard-Signature` with `X-AgentBoard-Timestamp`; the harness rejects timestamps older than five minutes. Delivery is retried up to three times, so the harness treats a repeated `run.id` as the same run. It reports back through the `steps` and `finish` endpoints.
- Steps are append-only except for status and note. `reply` is plain text.
- If the agent's key lacks `boards:write`, the run still completes: the reply says what the agent would have done.

## 8. Errors

Every non-2xx response has this body:

```ts
type ErrorBody = { error: { code: ErrorCode; message: string; details?: unknown } };
```

| Code | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | no valid cookie or key |
| `forbidden` | 403 | missing scope, revoked key, or blocked by a workspace setting |
| `not_found` | 404 | no such board, element, claim, or agent |
| `validation_failed` | 422 | body fails its schema; `details` lists the issues |
| `version_conflict` | 409 | an `ifVersion` did not match; `details` is `{ id, expected, actual, current }` where `current` is the element as it now stands, so the caller can rebase without another read |
| `run_in_progress` | 409 | the agent already has a run in progress on this board |
| `claim_required` | 409 | workspace requires a claim and the agent has none covering the change |
| `limit_exceeded` | 422 | a limit in section 9 would be passed; `details` names it |
| `rate_limited` | 429 | too many requests; `Retry-After` header is set |
| `internal` | 500 | anything else |

## Pages and the endpoints behind them

Every screen reached from the side nav is backed by this contract and by nothing else. The prototype shows the same list from a Contract button on each page.

| Page | Endpoints |
|---|---|
| Sign in, sign up | `POST /auth/signup`, `POST /auth/login` |
| Boards | `GET /boards`, `GET /boards/{id}/elements` (card miniatures), `POST /boards`, `DELETE /boards/{id}`, `POST /boards/{id}/restore`, presence from the live feed |
| Board canvas | `GET /boards/{id}`, `PATCH /boards/{id}`, `GET /boards/{id}/elements`, `POST /boards/{id}/ops`, `WS /boards/{id}/live`, `GET /boards/{id}/claims`, `GET /boards/{id}/digest`, `GET /activity?boardId=`, `GET /agents`, `GET /boards/{id}/runs`, `POST /boards/{id}/runs`, `POST /runs/{runId}/cancel`, `POST /runs/{runId}/revert`, `POST /boards/{id}/batches/{seq}/revert` |
| Agents | `GET /agents`, `POST /agents`, `PATCH /agents/{id}`, `POST /agents/{id}/rotate-key`, `DELETE /agents/{id}` |
| Activity | `GET /activity` with `actorKind`, `boardId` and cursor paging; `GET /boards` for the board filter |
| Developers | `GET /agents` for the "act as" list; the console may call any endpoint and any MCP tool |
| Settings | `GET /settings`, `PATCH /settings`, `GET /knowledge`, `POST /knowledge`, `DELETE /knowledge/{id}`, `GET /me`, `POST /auth/logout` |

If a page needs data that is not reachable through its row, change the contract first and record it in the changelog.

## 9. Limits

| Limit | Value |
|---|---|
| Elements per board | 800 |
| Operations per batch | 50 |
| Text per element | 4,000 characters |
| Request body | 256 KB |
| Claim lifetime | 60 seconds, renewable |
| Active claims per actor per board | 3 |
| Run length | 20 tool calls, 120 seconds, or the model token budget set by `RUN_MAX_TOKENS`, whichever comes first |
| Concurrent runs per workspace | 3 (refused with `rate_limited`) |
| Runs per agent per day | 100 |
| Sign-in attempts | 10 per email and IP per 15 minutes |
| Digest size | each text clipped to 200 characters; about 20,000 characters in total, then a line saying how many elements were left out |
| Knowledge documents | 200 per workspace |
| Writes per API key | 120 batches per minute |
| Reads per API key | 600 per minute |

## 10. Acceptance checks

- Every type in sections 3 to 8 has a Zod schema and an exported inferred type.
- `openapi.yaml` is generated, validates as OpenAPI 3.1, and contains every endpoint in section 5.
- Every schema has a fixture and a passing parse test; each error code has a fixture.
- The package builds and has no runtime dependency other than Zod.
- A `CHANGELOG.md` exists. Any later change to this contract is recorded there and both app teams are told.
