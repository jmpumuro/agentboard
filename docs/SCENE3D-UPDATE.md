# Prompt 07 implementation

The implementation contract was approved in the conversation before source edits began. References: `agentboard-kit/07-3d-prompt.md` and `agentboard-kit/prototype/scene3d-reference.html`. The prototype renderer and rule-based agent were not copied into production.

## Architecture

- Shared Zod contract adds scene3d, Part/PartInput, three part operations, extended operation results, prompt and structured run design targets.
- Core applyOps remains authoritative for human, REST/MCP, webhook and built-in writes. It enforces versions, claims, limits and capabilities. A part mutation increments its own version and its element version. Different-part updates do not require the element version.
- Server-owned per-model version ledgers persist deleted IDs, prevent reuse, and keep versions increasing during full replacements and undo. Part-only undo guards only touched parts and preserves unrelated edits. A conflicting revert changes nothing. Content comparisons allow sequential undo after earlier reverts incremented metadata versions.
- A design-targeted run cannot create duplicates or modify other elements, including through external REST/MCP writes during that run. A placement run becomes an element target after its successful create. Existing tools and response cards are reused.
- BoardPage serializes manual commits; part controls disable during pending writes. Part conflicts are never automatically overwritten. Geometry-only moves retain the existing bounded retry.
- Scene3DCard owns its cached still; Scene3DView lazily imports Three.js, builds solid geometry, picks parts, and uses official OrbitControls. Resize preserves the renderer and geometry. Scenes/materials/edge geometry and controls are disposed when released. Rendering is on demand, device pixel ratio capped at 1.5.
- At most two visible models have live contexts; active/selected visible models take priority. Offscreen models release their context. Inactive models use their last still or authenticated server-rendered saved defaults. Context loss keeps the still and accessible controls; context restore redraws.
- Shared geometry helpers define y-up orientation, camera fitting, explosion offsets and explanatory colours. Four primitives and eight colours only. Edges keep light parts distinguishable on the neutral view surface.
- Server images use official Three.js SVGRenderer, a server-only DOM, and native Canvas Path2D for trusted generated paths. No user SVG/HTML, browser execution or network is used. The existing board image pixel/time/cache bounds remain in force. Rendering is synchronous within the existing bounded image service; it is not an isolated browser renderer.

## Behaviour and defaults

Design creation/refinement now uses the toolbar input. The old code editor/composer modules remain unreferenced by product flows; sandbox unit tests still exercise their underlying embed protections. Agent-generated HTML remains supported through shared operations.

A 3D tool places one starter block and targets it. Agent guidance explicitly reuses the starter ID, supplies explanations and out offsets, and describes primitive approximations honestly. A human-created model is still subject to the workspace destructive-deletion restriction: an agent may edit its parts, but may not delete them while that restriction is enabled. Full-list replacement cannot bypass this rule.

Orbit, explosion exploration, selection, hide and only state are local. Saved camera/explode fields are changed only by an explicit edit. Rename edits name/info in one batch. Manual changes use toolbar undo; run changes use response-card undo. A view's accessible name lists the title and part names, and a native part selector provides keyboard access to explanations/actions.

The engine fixture uses nine explicitly separated parts. No groups, CAD, imported models, physics, animation, textures, transparency, floating labels or per-part rotation controls were added.

## Validation

Tests cover service/schema limits, permissions, claims, idempotent existing paths, stale same-part conflicts, independent part edits, atomic failure, full replacement and monotonic versions, deletion restrictions, disk reload, digest/JSON, actual PNG rendering, human/agent interoperability, guarded run undo, targeted duplicate prevention, placement target adoption, engine separation, axis/picking, renderer lifecycle/context fallback, and the existing app flow extended with model editing and undo.

Browser tests include desktop and phone creation/refinement, local exploration and persistent editing. They require a functioning local browser environment. In this sandbox Chromium cannot launch (macOS MachPort permission denial), so browser tests are discoverable but are not claimed as executed. Real-provider testing is a separate `npm run test:openai:3d`; DNS to api.openai.com is blocked here, so the bicycle integration is not claimed as passed or visually reviewed.

Stage and final check outputs are retained under `reports/scene3d-*`. No live workspace data was edited offline and the user's running server was not terminated.
