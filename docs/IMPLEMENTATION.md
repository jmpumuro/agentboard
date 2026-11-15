# Implementation status

This is a working local development implementation, with production build output. It is **not a completed production implementation of every requirement in the kit**. Original inputs are retained under `agentboard-kit/`. No prototype implementation code was copied.

## Implemented

| Area | Result |
| --- | --- |
| Scaffold | TypeScript workspace, twelve ADRs, build/typecheck/test scripts, Docker/Compose definitions, setup instructions |
| Contract | Zod domain, operation, error, WS, run and tool schemas; inferred types; fixtures; generated OpenAPI draft |
| Accounts | First owner, invitation-only subsequent signup, owner/member permissions, salted password hashes, hashed sessions, logout, local reset CLI, Origin checks |
| Boards | List, create, rename, thumbnails, 30-day trash, restore, free-form elements, activity |
| Write service | Atomic batches, element versions, conflicts with current element, relative restacking, geometry/text/count limits, idempotency body matching, arrow integrity/cascades, scoped agents, claim-required and delete rules |
| Reversibility | Guarded batch undo, guarded atomic run undo, human-session undo/redo |
| Canvas | DOM elements and SVG arrows, selection, move, resize, text editing, notes/shapes/text/arrows, colors, text sizes, keyboard shortcuts, selection box, pan/zoom, touch pinch handler, fit, agent digest |
| Collaboration | Single-process WS replay/resync, presence/cursor messages, claim events/expiry, run updates; transport integration remains unverified |
| Agents | Create/edit, board allowlist, one-time keys, rotation/revoke, one-time webhook secret, MCP/curl snippets |
| Runs | Durable queue in selected adapter, worker outside request, model interface/OpenAI implementation, scope checks, recorded tool steps, cancellation, interrupted-run recovery, limits, run attribution |
| Integrations | REST/MCP tools use the same service rules; signed webhook delivery/retry and agent-only callbacks; stateless external MCP calls; pinned public-address HTTPS requests, response/time limits; encrypted secrets |
| Knowledge | Pasted-document CRUD and keyword passage search without a provider |
| Other screens | Filterable/paged activity, live developer console, settings/safety switches, member invitations, sign out |
| UI | Responsive CSS, system dark theme, semantic controls, native modal dialogs, reduced-motion CSS, toast feedback |

## Required production work and deviations

These are outstanding requirements, not optional feature proposals:

1. **Persistence architecture:** with `DATABASE_URL`, the workspace is stored in normalized tables and loaded back into the same in-memory `State` object services already mutate. An existing one-row JSONB snapshot is imported once and then kept only as a backup. The local file adapter is still one JSON file and one process; do not run it beside a second writer. Drizzle, versioned SQL migrations, and per-board `FOR UPDATE` as the only write path are still outstanding. The Postgres suite skips unless `DATABASE_URL` points at a reachable database.
2. **Multi-instance realtime/workers:** Postgres claims a queued run with `FOR UPDATE SKIP LOCKED` and holds a session lock until the run finishes. A running row whose lock is gone is marked `interrupted` on startup. A committed board batch sends `NOTIFY board_ops`, and that process tells its sockets to resync. Presence is still in memory on each process. Expired-session socket checks, presence departure, and ping/drop handling are still outstanding. Do not treat this as a finished multi-instance deployment.
3. **Requested backend libraries:** HTTP is still Node’s server and `ws`, not Fastify. Data access is still hand-written SQL, not Drizzle. New passwords are Argon2id (`memoryCost` 19456, `timeCost` 2, `parallelism` 1). Stored scrypt hashes still verify.
4. **MCP compatibility:** the native JSON-RPC endpoint supports legacy protocol `2025-11-25`, tools/list, tools/call and initialize/ping. It has not passed official SDK/Inspector interoperability checks. The outbound client currently supports stateless servers and JSON/SSE responses; session negotiation, SSE resumption and modern protocol support remain. Replace/verify transport with the official SDK when available.
5. **Knowledge:** search results are still keyword passages over the documents held in `State`, which is what `search_knowledge` returns. Postgres also stores a `tsvector` on each knowledge row. Querying that vector, pgvector, and an embedding provider are not wired up.
6. **Contract completeness:** Zod schemas are unchanged and remain the source of truth. Generated OpenAPI now records the success status and JSON envelope each existing route returns, including list and page wrappers. It is still a description of this server, not a schema to generate a second client from.
7. **Frontend depth:** local edits are a queue of pending batches applied on top of the confirmed snapshot. A failed batch drops only itself. Real-browser layout, touch, keyboard and accessibility checks remain. Live presence is shown on the canvas, not board cards. The board store is not yet the specified Zustand store. Memoization/profiling for 800-element dragging remains; touch long-press multi-select is absent. Remaining management pages are still consolidated in App.tsx.
8. **Developer console:** users can act as themselves or supply a real/invalid agent key; agent impersonation without a key is deliberately unavailable because keys are stored only as hashes. Expand the worked request examples. The spec needs an explicit contract for any owner impersonation mode.
9. **Delivery verification:** the production image is a multi-stage build that runs `node server.mjs` on Alpine, with `pg`, `ws`, `@napi-rs/canvas`, `@node-rs/argon2`, and `jsdom` left unbundled. A local `docker build` was reported healthy. Compose against live Postgres, browser flows, WebSocket reconnect, and live model/webhook/MCP delivery still need a full acceptance run before production.
10. **Operational limits:** login and agent rate limits are stored in Postgres when `DATABASE_URL` is set, and in memory for the file store. Presence is in memory either way. The file-store worker still runs one claimed run at a time. Each model call asks for at most the remaining token budget, then usage is checked when the turn returns, so prompt tokens can still carry one turn past the cap.

## Specification conflicts resolved

- Contract operations replace whole-order writes with `restack`; an older backend acceptance check still demands whole-order writes. The contract wins.
- Built-in runs use the agent’s scoped actor through services. Architecture prose still refers to using the agent’s key, which cannot be recovered from its hash. The contract wins.
- Conflicting frontend text-edit guidance is resolved by preserving the local text and offering “Keep mine” / “Use theirs”; geometry retries once on the server’s current version.

## Proposed, not built

No out-of-scope features were added: sections/frames, images/uploads, public sharing, SSO, comments/threads, or multiple workspaces remain excluded as requested by the kit.

Prompt 06 supersedes the original freehand exclusion. Drawing and unified-toolbar architecture and test evidence are documented in DRAWING-UPDATE.md.

HTML/CSS embeds and natural-language design/refinement are now included under prompt 06’s embed extension. See EMBED-UPDATE.md; snapshots use its documented labelled-box fallback.

Prompt 07 adds shared structured 3D models and replaces the ordinary design dialog with toolbar targets. See SCENE3D-UPDATE.md for operations, rendering, restrictions and validation results.
