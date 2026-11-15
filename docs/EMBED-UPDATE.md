# HTML/CSS design mockups and drawing capability correction

Inputs: `agentboard-kit/06-drawing-and-embeds-prompt.md` and `prototype/embed-reference.html`. Latest user direction makes natural-language design briefs the primary workflow; the code editor is optional under Advanced.

## Implemented

- Shared `embed` input/element/patch schemas with unchanged HTML storage, required title and geometry, a 20,000-character limit and 30-embed-per-board cap.
- Add permission for creation and Edit for changes; all REST, MCP and run writes use the existing operation service, including version conflicts, activity and guarded undo.
- Digest title/code-length summaries without raw HTML. REST `omit=html` (combinable with `strokes`) and MCP JSON `includeHtml: true` for explicit code reads.
- Authenticated frame-document endpoint `/api/v1/boards/{id}/embeds/{elementId}/frame`, with restrictive CSP, no-sniff and no-referrer headers. Stored HTML is not parsed or sanitized by the server.
- Browser rendering uses an empty `sandbox` attribute and a CSP in a leading srcdoc meta tag. No scripts, external assets, forms or popups are enabled. Inline CSS and data images/fonts are permitted. The frame-document endpoint is currently same-origin; scripts must remain disabled, and a separate origin is required before any future script support.
- Memoized `EmbedView` preserves frame identity when geometry, selection, title or board state changes; changed HTML remounts the frame. Distant frames are removed and recreated near the viewport. Frames ignore pointer input on the canvas.
- HTML tool with shortcut E. `MockupComposer` asks for a design brief and an allowed agent. Refinement reads and updates the same embed. `EmbedEditor` provides optional title/code/live-preview editing as one undoable update.
- Shared example-board data reproduces the reference’s content/layout for landing-page redesign and onboarding: notes, shapes, arrows, pen sketches and live mockups. The seed script includes them; existing workspaces can create copies from Boards. Exact visual equivalence remains a browser acceptance check, not a passed claim.
- Developer console examples for valid and oversized embeds, and reference text for limits, permissions and explicit HTML reads.

## Drawing refusal fix carried forward

The reported agent had Draw enabled but replied with an unsupported inability claim without invoking any board tool. Tool descriptions previously repeated generic collaboration text. They now describe each tool’s actual purpose, explicitly identifying `write_board` as the drawing and embed implementation. The model preamble lists authoritative enabled/disabled permissions and directs action through real tools. Provider calls first request a `read_board` tool call.

If an agent with live Draw/write permissions still gives the specific false drawing denial, the worker makes one bounded corrective retry and records the correction. A repeated denial is a failed run rather than a misleading successful response. This does not change permissions, install a canned drawing planner or bypass service checks. The regression test reproduces the screenshot wording and verifies an actual model-generated stroke write through the service.

## Rendering limit

`view_board` remains a bounded native raster renderer. Embeds appear as explicitly labelled title boxes; HTML is never executed by that renderer. The prompt permits this fallback until an isolated browser renderer with network/time/memory restrictions exists. That renderer is not built, and pixel-accurate HTML in PNG snapshots is not claimed.

## Verification

See `reports/embed-verification.log` for executed typechecks, contract generation, unit/DOM/service/worker tests and production build results. Added tests cover unchanged HTML, limits, Add/Edit permissions, undo, read omissions, endpoint headers, both example fixtures, stable sandbox frame nodes, advanced preview/save, natural-language composition, actual create/refine runs, and the reported drawing refusal.

Six desktop/phone Playwright flows are discovered successfully. Embed browser coverage is authored for natural-language creation/refinement, script blocking, blocked external image requests, and frame identity through drag/resize. Actual Chromium execution remains blocked by the existing sandbox environment, so browser security enforcement and screenshots are not marked passed. A configured real model still needs an unrestricted network check; this session’s OpenAI DNS lookup is blocked.
