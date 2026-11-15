# Backend prompt

You are building `apps/api`, the backend of AgentBoard. Read `01-architecture-prompt.md` and `02-contract-prompt.md` first. The contract package already exists; import its schemas and types and never redefine them. Open `prototype/index.html` to see what the frontend will ask of you.

## 1. Suggested stack

| Concern | Choice | Why |
|---|---|---|
| Language and runtime | TypeScript on the current Node.js LTS | One language across contract, backend, and frontend |
| HTTP framework | Fastify | Fast, schema-first, mature plugin system, good WebSocket support |
| Validation | Zod schemas from `packages/contract`, wired with a Fastify Zod type provider | Requests and responses are checked against the contract itself |
| Database | PostgreSQL | Transactions for atomic batches, JSON columns for element props, LISTEN/NOTIFY for fan-out |
| Data access | Drizzle ORM with its migration kit | Typed SQL without hiding it; plain SQL migrations |
| Realtime | `@fastify/websocket` | Same process and same auth as REST |
| MCP | The official MCP TypeScript SDK, Streamable HTTP transport, mounted at `/mcp` | Same service layer, no second service |
| Password hashing | Argon2id | Current standard for passwords |
| API key storage | SHA-256 of the key, plus the display prefix | Keys are long random strings, so a fast hash is safe and lookup is one indexed query |
| Logging | Pino (Fastify's default) | Structured logs with request ids |
| Tests | Vitest, with a real PostgreSQL started by Testcontainers or docker compose | Concurrency rules cannot be tested against a mock |
| Packaging | One Dockerfile, multi-stage | One deployable |

If the team prefers Python, the equivalent is FastAPI, Pydantic, SQLAlchemy with Alembic, and the official MCP Python SDK. In that case generate Pydantic models from `openapi.yaml` and keep everything else in this prompt the same. Do not mix the two.

Read the current documentation of each library before using it, the MCP SDK in particular, since its API changes between releases.

## 2. Structure

```
apps/api/src/
  server.ts            # builds the Fastify app
  config.ts            # env parsing (DATABASE_URL, SESSION_SECRET, PORT, WEB_ORIGIN)
  db/                  # schema.ts, migrations/, client.ts
  auth/                # sessions, api keys, resolveActor()
  services/            # boards, ops, digest, claims, agents, activity, settings
  routes/              # one file per resource; thin, call services only
  live/                # websocket hub, NOTIFY listener
  mcp/                 # tool definitions that call services
  lib/                 # errors, rate limit, ids, idempotency
```

Rule: routes, the WebSocket handler, and MCP tools contain no business logic. They parse input, call a service with an `Actor`, and shape the output. Every rule lives in `services/`.

## 3. Database tables

- `users` (id, email unique, name, password_hash, created_at)
- `sessions` (id, user_id, expires_at)
- `invites` (token_hash, email, role, expires_at, used_at); `users` also has `role`; `boards` also has `deleted_at`; `board_batches` also has `undo jsonb` and `reverted_by`; `runs` also has `batches int[]`, `touched text[]`, `reverted`
- `agents` (id, name, harness, scopes text[], capabilities text[], instructions, mcp_servers jsonb (secrets encrypted), runner jsonb, webhook_secret (encrypted), board_ids text[] null, key_hash unique, key_prefix, status, last_seen_at, created_at)
- `boards` (id, title, seq bigint, order text[], created_by jsonb, created_at, updated_at)
- `elements` (board_id, id, type, version int, x, y, w, h, text, props jsonb, created_by jsonb, updated_by jsonb, updated_at; primary key (board_id, id))
- `board_batches` (board_id, seq, actor jsonb, applied jsonb, at; primary key (board_id, seq)), used to replay missed batches; keep the latest 1,000 per board
- `claims` (id, board_id, actor jsonb, target jsonb, note, expires_at)
- `knowledge_docs` (id, title, text, created_at) and `knowledge_passages` (id, doc_id, text, embedding vector)
- `runs` (id, board_id, agent_id, requested_by jsonb, message, status, steps jsonb, reply, error jsonb, created_at, finished_at)
- `activity` (id, board_id, actor jsonb, seq, summary, counts jsonb, at), indexed on (at desc) and (board_id, at desc)
- `idempotency` (key, actor_id, response jsonb, created_at), rows older than 24 hours deleted
- `settings` (single row)

v1 has one workspace per deployment, so there is no workspace table.

## 4. Build stages and the decision at each

### Stage A: Server skeleton and errors
Build the Fastify app, config, health check (`GET /healthz`), and one error handler that turns every thrown `AppError(code, message, details)` into the contract's error body and status.
**Decision:** errors are thrown as typed `AppError`s from services and translated in one place, so REST and MCP report the same codes.

### Stage B: Auth and actors
Signup, login, logout with an httpOnly, SameSite=Lax, Secure session cookie. The first account becomes the owner and closes open signup; later accounts need a single-use invite. Sessions expire after 30 days idle and are rotated on sign-in. Throttle sign-in attempts per email and IP, and compare secrets in constant time. Every state-changing request made with a cookie must carry an `Origin` that matches `WEB_ORIGIN` (CSRF defence beyond SameSite); the WebSocket upgrade makes the same check. API keys are accepted only in the `Authorization` header, never in a URL. Owner-only actions are enforced in services by role. Password reset by email is out of scope; give the owner a CLI command to reset a password. API key check from the bearer header. One `resolveActor(request)` that returns `{ actor, scopes }` or throws `unauthorized`. Sessions get both scopes plus management rights; keys get only their scopes. Update `last_seen_at` for agents at most once a minute.
**Decision:** authorization is checked in services by scope, never in routes, so MCP and REST cannot disagree.

### Stage C: Boards and agents CRUD
Everything in the contract table outside ops, digest, claims, and live. Creating or rotating an agent returns the key once.
**Decision:** deleting an agent revokes it and keeps the row, so past activity still shows its name.

### Stage D: The ops service (the core)
`applyOps(actor, boardId, request)` in one transaction:
1. `SELECT ... FOR UPDATE` the board row. This serialises writers per board. Refuse a trashed board with `not_found`, and an agent without access to the board the same way.
2. Check limits and settings (`agentsCanDeleteOthersElements`, `requireClaimBeforeAgentWrite`).
3. Apply each operation; any `ifVersion` mismatch throws `version_conflict` and rolls back everything.
4. Cascade-delete arrows of deleted elements. Reject arrows whose `from` or `to` does not exist after the batch.
5. Apply `restack` operations to `order`, bump `seq`, insert the `board_batches` row (including the undo record: prior values of changed fields and whole deleted elements) and the `activity` row.
   `revertBatch(user, boardId, seq)` builds the inverse operations from that record and applies them through `applyOps` as a normal batch, after checking that every element the batch touched is still at the version it left. `revertRun` does the same for each of a run's batches, newest first, in one transaction.
6. `NOTIFY board_ops` with `{ boardId, seq }` (payload stays small; listeners load the batch by key).
**Decision:** a row lock on the board, held for a short transaction, is the concurrency control. It is simple and correct, and write volume per board is low. Do not introduce queues or advisory-lock schemes.

Support `Idempotency-Key`: store the key with a hash of the request body under a unique constraint. Same key and same body returns the stored response without applying again; same key with a different body is refused; two simultaneous requests with one key apply once.

### Stage E: Digest
Produce the exact text format in the contract. Pure function from `(board, elements, claims)` to string, with unit tests against fixtures.
**Decision:** the digest is computed on read, not stored. Boards are small and it must never be stale.

### Stage F: Live hub
On upgrade: authenticate, replay missed batches or send `resync`, send `hello`, register the socket. One dedicated PostgreSQL connection listens on `board_ops` and pushes each batch to that board's sockets. If the dedicated LISTEN connection drops, reconnect and send `resync` to every socket on that instance, because notifications sent meanwhile are lost. Drop a socket whose send buffer grows past 1 MB and let it resync. Agents that use only REST have no socket, so their presence is derived from their live claims and running runs. Presence and cursors are held in memory per instance and broadcast at most 10 times a second per client. Send claim start and end events. Ping every 30 seconds and drop dead sockets.
**Decision:** cursors are best-effort and in memory; only committed batches are durable and ordered.

### Stage G: Claims
Create, renew, release, list. A sweeper removes expired claims every 5 seconds and emits `claimEnd`. Claims never block people. When `requireClaimBeforeAgentWrite` is on, an agent write must fall inside one of its own live claims or it gets `claim_required`.
**Decision:** claims are advisory signals with expiry, not locks.

### Stage H: MCP endpoint
Mount the MCP server at `/mcp`. Each tool in the contract resolves the actor from the API key and calls the same service function as REST. `get_guide` returns a short static text.
**Decision:** MCP tool results for errors carry the same `code` and `message` as REST, so an agent's recovery logic is the same on both doors.

### Stage K: Knowledge and chat runs (build after stage H)
**Knowledge.** Store documents, split them into passages of a few sentences, embed each passage, and store the vectors in PostgreSQL with the pgvector extension. `searchKnowledge(actor, query, limit)` embeds the query and returns the nearest passages; it checks the `knowledge` capability. Put the embedding provider behind one small interface (`embed(texts) -> vectors`) chosen by environment variable.
**Decision:** pgvector in the existing database, no separate vector store; v1 volumes are small and one database keeps operations simple. Store the embedding model's name with each passage and re-embed when it changes. When no embedding provider is configured, fall back to PostgreSQL full-text search so knowledge search still works.

**Runs.** `createRun(user, boardId, agentId, message)` stores a queued run. A worker loop in the same image claims queued runs with `SELECT ... FOR UPDATE SKIP LOCKED`, so runs survive a web process restart, never run twice, and scale by adding workers. On start-up, a run left `running` by a dead worker is marked failed with code `interrupted` and its claims are released. The request handler never runs the model loop itself.
- *Built-in runner:* a loop around a chat model with tool use. System prompt = a short fixed preamble (how boards work, the read, claim, write, release loop, the limits) plus the agent's `instructions`. Tools offered = the board tools from `mcp/` (only those the key's scopes allow), `search_knowledge` if the agent has the capability, and the tools of each configured external MCP server. Each model turn: record a step, execute the tool through the service layer **as the agent's actor** (the runner has no API key; keys are stored only as hashes), feed the result back. The preamble also states the placement rule: boards are free-form, so put new elements in open space beside related ones, using the positions in the digest, and never on top of an existing element. Stop on a final text answer, on the run limits, or on cancel. Always release any claim the run still holds.
- *Webhook runner:* POST the signed payload; mark the run failed if the harness has not finished within the run time limit.
- Put the model provider behind one interface (`complete(messages, tools) -> message`) chosen by environment variable, with one concrete implementation to start. Read the provider's current tool-use documentation before writing it.
- Broadcast `{ t: "run", run }` on every change. One run per agent per board at a time (`run_in_progress`).
**Decision:** the runner is a client of the service layer, never a shortcut around it. It gets no privileges an outside agent with the same key would lack.
**Decision:** tool results from external MCP servers and retrieved passages are untrusted text. The preamble tells the model to treat them as data, and the runner never lets them change which tools are available.

The prototype's `parseAsk` and `buildWork` functions are a rule-based stand-in for this model loop. Do not port them.

### Stage I: Limits and hardening
**Outbound requests.** Webhook URLs and external MCP server URLs are supplied by users, so every outbound call is a server-side request forgery risk. Require https, resolve the host yourself and refuse loopback, link-local and private ranges, connect to the address you checked (so a DNS change cannot redirect it), do not follow redirects, and cap time (10 s) and response size (1 MB). Store MCP server secrets and webhook secrets encrypted with a key from the environment; never return them.
**Spend.** Enforce the run limits in the contract (tool calls, seconds, tokens, concurrent runs, runs per agent per day) in the runner, not in the route, so they hold for webhook runs too.
**Operations.** Take a PostgreSQL advisory lock around start-up migrations so two instances cannot run them at once. Expose `/healthz` (process up) and `/readyz` (database reachable, migrations applied).
Per-key rate limits from the contract (in-memory token bucket is fine for one instance; note in the README that it must move to PostgreSQL or Redis for several). Body size limit. CORS allowing only `WEB_ORIGIN` with credentials. Security headers. Never log keys, cookies, or passwords.

### Stage J: Packaging
Dockerfile, migrations on start-up, serving the built web app's static files when `SERVE_WEB=true`, and a seed script that creates a demo user, a demo agent, and the free-form starter board shown in the prototype (a title, a one-line takeaway, loose notes in four colours and one arrow).

## 5. Tests that must exist

- Two concurrent batches updating the same element with the same `ifVersion`: exactly one succeeds, the other gets `version_conflict`, and no partial write remains.
- A batch with one bad operation changes nothing.
- A retried batch with the same `Idempotency-Key` applies once.
- A key with only `boards:read` cannot write through REST or MCP.
- A revoked key gets `forbidden` on every door.
- With `agentsCanDeleteOthersElements` off, an agent cannot delete a person's note but can delete its own.
- A WebSocket client that reconnects with `sinceSeq` receives exactly the missed batches in order.
- Claims expire and emit `claimEnd`.
- Digest output matches the fixture byte for byte, including a clipped long text and the "more elements not shown" line.
- Reverting an agent's batch restores the board exactly; reverting after one of its elements changed is refused and changes nothing.
- A trashed board is hidden from lists, refuses reads and writes, and comes back whole on restore.
- An agent limited to board A gets `not_found` for board B on REST, MCP and in a run.
- A second account cannot sign up without an invite; a member cannot create an agent or change settings.
- A cookie request with a foreign `Origin` is refused, for REST and for the WebSocket upgrade.
- A webhook or MCP URL that resolves to a private address is refused.
- A queued run is picked up after the worker restarts; a run left running is marked `interrupted`.
- A batch with no operations and a new `order` reorders the board and bumps `seq`; an `order` that is not a full permutation is refused.
- Creating an element of type `section` is refused with `validation_failed`.
- A run with a fake model that asks for `read_board`, `search_knowledge`, `claim`, `write_board`, `release_claim` produces those five steps in order, the board change, one activity event attributed to the agent, and no leftover claim.
- A run for an agent without `boards:write` finishes with a reply and changes nothing.
- A run whose model requests a tool the agent may not use gets `forbidden` back as the tool result and can continue.
- Cancelling a run stops further tool calls and releases its claim.
- Every response in the route tests parses with its contract schema.
- For each row of the contract's "Pages and the endpoints behind them" table, one test walks that page's endpoints in order as a signed-in person and gets the data the page needs.

## 6. Acceptance checks

- `pnpm --filter api test` passes against a real PostgreSQL.
- `docker compose up` gives a working API on one port, and the seed script succeeds.
- With `curl` and the seeded agent key you can: list boards, read the digest, create a note with `POST /ops`, and see it arrive on an open WebSocket.
- An MCP client connected to `/mcp` with the same key can do the same through tools.
- Final report lists what was built per stage, anything that deviates from the contract (there should be nothing), and a "Proposed, not built" list.
