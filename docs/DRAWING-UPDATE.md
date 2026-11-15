# Drawing and toolbar update (prompt 06)

Inputs: `agentboard-kit/06-drawing-prompt.md` and the visual reference `agentboard-kit/prototype/drawing-reference.html`. The prototype is retained as a reference and was not copied into the implementation.

## Architecture and behavior

- Shared Zod drawing/stroke schemas, one-decimal normalization, descriptions, three drawing limits, five abilities, default permissions and one-time legacy-agent migration.
- A central operation authorizer is used by all service writes. Drawing stroke updates require Draw; other updates require Edit, following prompt 06. Scope and workspace deletion rules remain additional restrictions.
- People and agents create the same drawing element. Pen gestures are sampled in screen pixels and refitted in pure board-engine functions. Stroke writes are queued by drawing session; each stroke creates its own batch. Unknown fields never become executable content.
- Separated board controller, numeric SVG drawing view, selection bar, movable toolbar, durable response card, ability picker, shared UI primitives and query client.
- A real back button remains mounted while title/edit state changes. It saves active edits before navigation.
- Tool and ask modes share the same dock. Drafts survive mode changes. Dock placement is clamped, stored per user and resettable by grip double-click. Cards attach above/below, page older runs, collapse completed steps and remember hiding per user and board. New runs reveal their response.
- Dot spacing is 24 board units, increasing to 48 below 50% zoom. The existing tested light/dark palette and explicit theme controls are preserved.
- Agent dialog, table, toolbar context and developer examples/reference use the shared ability definitions. New agents default to add/draw/edit/knowledge; Delete defaults off. No abilities are needed for board reads or snapshots.
- Manual parity: board creation/listing, digest/snapshot, numeric drawings and other element edits, knowledge search in the developer console, and a flag control for claiming/releasing working space. All mutations use the same service operations as agents.

## How `view_board` renders

`apps/api/src/render/board-png.ts` uses `@napi-rs/canvas`, a native 2D raster library. Notes/shapes are filled paths with plain text, arrows are line segments, and drawings are numeric polylines with round caps/joins and three-board-unit ink. Stored points are scaled into board geometry, so resizing does not rewrite strokes. Snapshots use white paper and black ink for consistent model input regardless of the viewer’s theme.

No browser, network fetch, HTML parser, SVG parser or uploaded image is involved. Regions are validated; the long side is capped at 2,000 pixels (at most 16 MB raw RGBA). Drawing work checks a 1.5-second deadline. The image cache uses board ID, sequence and region, capped at eight entries and 16 MB of encoded data.

## Verification and limits

The latest results are in `reports/drawing-verification.log`. Tests cover malformed strokes and limits, person/agent data parity, every ability denied and allowed over REST/MCP/injected-model runs, scope restrictions, migration, full read context and omitted stroke payloads, stroke undo, pure gesture geometry, toolbar constraints, response/draft persistence, actual React route flow, theme contrast and server PNG pixel comparison against a stored fixture.

Desktop/phone Playwright flows cover freehand grouping/undo, new sessions, resizing/describing/deleting, toolbar drag/reset/reload, ask-mode drafts, response history/hiding, agent ability edits, injected-model drawing/refusal and dot-grid screenshots in both themes. They are authored but cannot be marked passed here: the session previously denied localhost listeners and Chromium startup. The browser server’s model is explicitly a test-only fixture; production still calls the configured real provider. A real-model lighthouse recognition test requires `OPENAI_API_KEY` and has not been executed.

Existing production limitations in `IMPLEMENTATION.md` still apply, notably normalized PostgreSQL, multi-instance behavior and live external interoperability. This update does not claim those prior requirements have been completed.
