# Additional changes prompt: drawing, parity, abilities, context, dotted canvas

You are extending AgentBoard, which is already specified by prompts 01 to 04 and reviewed in 05. This prompt adds one feature and three rules. Everything here is an addition or a replacement that is named as such; where this file and an earlier prompt differ, this file wins.

Open `prototype/index.html` first and try: the Draw tool in the toolbar; asking an agent "Draw a house"; asking the Research agent to draw or delete (it is not allowed to); "Agent view" on a board; the agent dialog on the Agents screen; the two drawing examples in the API console. The prototype has no model, so its agent draws from nine canned line drawings. In the real app the model chooses the strokes itself.

## 1. The four changes

1. **Parity.** An agent never has a way of acting on a board that a person lacks. Every agent action has a manual equivalent in the toolbar or selection bar, and both go through the same operations. Drawing is added for people and for agents together.
2. **Drawing.** A new element, `drawing`, made of pen strokes in black ink. Flat, two-dimensional, no colour, no fill. A person draws with a pen tool; an agent sends strokes. They produce the same element and it is treated the same afterwards.
3. **Full context, limited action.** An agent always sees everything on the boards it can reach: every element including drawings, who made it, what changed recently, and who is working where. What it may do about it is set per agent by a list of abilities.
4. **Dotted canvas.** The board background is a dot grid, not ruled lines.

## 2. Design decisions

| Decision | Why | Rejected |
|---|---|---|
| A drawing is a list of strokes, each a list of points. | It is exactly what a pen produces, so people and agents are equal. It is numbers only, so there is nothing to sanitise and nothing that can run. | Agent-written SVG (needs an allowlist sanitiser, and gives agents shapes, fills and colours that people cannot make by hand). Generated images. |
| Black ink only: one colour, one width, no fill. | Matches the request for plain 2D black and white, keeps drawings legible on a busy board, and keeps the element tiny. The ink follows the theme's text colour, so it stays visible in dark mode. | Colour and width pickers. They can come later for people and agents at once. |
| Strokes made in a row with the pen join one drawing element. | A sketch is one thing to move, resize and delete, not forty loose lines. | One element per stroke. |
| Each stroke is its own batch. | Undo removes one stroke at a time, as people expect from a pen. | One batch per drawing session. |
| Abilities are per agent and per kind of action, not one write switch. | "May add ideas but not delete or rearrange my work" is the permission people actually want. | A single read/write scope. |
| The agent's view of the board is never reduced by its abilities. | An agent that cannot see the whole board gives worse help and cannot explain what it would do. Abilities limit hands, not eyes. | Hiding elements an agent may not edit. |
| When an agent lacks an ability, it says what it would have done and stops. | The person learns what is possible and where to change it; nothing fails silently. | Refusing with no explanation, or silently doing less. |

## 3. Contract changes (apply to `packages/contract`)

### Drawing element

Add to the `Element` union:

```ts
| (ElementBase & {
    type: "drawing";
    w: number; h: number;        // size on the board
    vw: number; vh: number;      // size of the box the strokes were recorded in, 1 to 8,000
    strokes: number[][];         // each stroke is a flat list of points [x0, y0, x1, y1, …] inside the vw by vh box
    text: string;                // a description, 1 to 200 characters. Required.
  })
```

Rules:
- A stroke has at least two points and an even count of numbers. Numbers are finite, between -8,000 and 8,000, stored to one decimal place.
- A drawing is shown by scaling its strokes from `vw` by `vh` to `w` by `h`, so resizing changes only `w` and `h`.
- There is no colour, width or fill field. Unknown fields are ignored.
- People's drawings start with the description "Hand drawing". An agent must write a real description of what it drew.

### Abilities (replaces the `capabilities` type and extends its meaning)

```ts
type Ability = "add" | "draw" | "edit" | "delete" | "knowledge";
// Agent.capabilities: Ability[]
```

| Ability | Lets the agent |
|---|---|
| (always) | Read every element, digest, claim and recent activity on the boards it can reach |
| `add` | Create notes, shapes, text and arrows |
| `draw` | Create drawings, and add strokes to a drawing |
| `edit` | Change, move, resize or restack existing elements, whoever made them |
| `delete` | Delete elements. The workspace rule about deleting other people's elements still applies on top. |
| `knowledge` | Search workspace documents |

- The `boards:write` scope on the key is still required for any change. Abilities narrow it; they never widen it.
- A refused action returns `forbidden` with `details: { ability: "<name>" }`.
- New agents default to `add`, `draw`, `edit`, `knowledge`. `delete` is off until someone turns it on.
- People have every ability. Member and owner roles are unchanged.

### Digest

A drawing is listed with its description and stroke count, never its points:

```
- [<id> v<version>] drawing/ink @<x>,<y> <w>x<h>: <description> (<n> strokes)  (by <actor name>)
```

Add a section after the arrows, with up to six entries, so an agent knows what it is stepping into:

```
## Recent activity (newest first)
- <actor name> <summary>  (<time>)
```

### Reading

- `GET /boards/{id}/elements` accepts `?omit=strokes`, which leaves `strokes` out of drawings. The MCP tool `read_board` with `format: "json"` omits strokes by default and takes `includeStrokes: true`.
- New MCP tool `view_board({ boardId, region? })`: returns a PNG of the board, or of a region, rendered by the server. This is how a model actually sees drawings and layout. It needs no ability; it is part of reading.

### Limits and errors

Add: 300 strokes and 10,000 points per drawing; 200 drawings per board. Over a limit is `limit_exceeded`; malformed strokes are `validation_failed`. No new error codes.

### Fixtures

One valid drawing; one refusal for each rule above; one `forbidden` for each ability.

## 4. Backend changes (`apps/api`)

1. **Validation.** A `drawing` needs `x`, `y`, `w`, `h`, `vw`, `vh`, `strokes`, `text`. Validate strokes as numbers only. Round to one decimal. There is no SVG and no sanitiser anywhere in this feature.
2. **Abilities.** In `applyOps`, when the actor is an agent, check per operation: create needs `add`, or `draw` for a drawing; update needs `edit`, or `draw` when it changes a drawing's `strokes`; delete needs `delete`; restack needs `edit`. Do this in the service, so REST, MCP and runs agree. Migrate existing agents: those with `boards:write` get `add`, `draw`, `edit`; keep `knowledge` where it was set.
3. **Digest.** Add the drawing line and the recent activity section.
4. **Reads.** Implement `omit=strokes`.
5. **Rendering for `view_board`.** Render elements to a PNG on the server with a plain 2D drawing library: boxes for notes and shapes with their text, lines for arrows, polylines for drawings. No browser, no network, time and memory caps, at most 2,000 pixels on the long side. Cache by board `seq` and region.
6. **Runner.** Offer the model only the tools its abilities allow: leave `write_board` out entirely for an agent with none of `add`, `draw`, `edit`, `delete`, and tell it in the preamble which abilities it has. Add to the preamble:
   - You can see everything on the board. Use `view_board` when layout or drawings matter.
   - To draw, create a `drawing` element with strokes. Draw the way a person would with a pen: outlines first, then details; a few dozen strokes at most; black line only.
   - Work in a box of about 180 by 180 units and place it in open space near what it illustrates.
   - Always describe what you drew in `text`. Put any words in a separate text element.
   - If you are asked for something you are not allowed to do, say what you would have done and that the ability can be turned on for you. Do not try another route.
7. **Undo.** The batch undo record already covers drawings: reverting a stroke restores the previous `strokes`, `x`, `y`, `w`, `h`, `vw`, `vh`. Confirm with a test.

**Tests that must exist**

- Strokes: non-numbers, an odd count, a single point, out-of-range values, over 300 strokes and over 10,000 points are each refused with the documented code.
- A person and an agent with `draw` each create a drawing; the stored elements have the same fields.
- Each ability: an agent without it gets `forbidden` with the ability named, over REST, MCP and in a run; with it, the same call succeeds.
- An agent with no abilities can still read the digest, the elements and `view_board`.
- The digest shows a drawing's description and stroke count, no points, and the recent activity section.
- Adding a stroke to a drawing and reverting that batch restores it exactly.
- `view_board` returns a PNG in which a known drawing's strokes are visible (compare against a stored image).

## 5. Frontend changes (`apps/web`)

1. **Dotted canvas.** Replace the ruled grid with a dot grid: one small dot every 24 board units, in a muted colour for each theme. The dots move and scale with pan and zoom; when zoomed far out, double the spacing so they never crowd.
2. **Draw tool.** Add "Draw" (a pencil icon, shortcut D) to the floating toolbar after Arrow.
   - Press and drag draws a stroke, shown live. Release commits it. A tap makes a dot.
   - Strokes made in a row join one drawing. Picking another tool, pressing Escape, or re-selecting Draw starts a new drawing next time.
   - The tool stays active after a stroke. With touch, one finger draws and two fingers pinch-zoom; Space and drag or the middle button pans.
   - After each stroke, refit the drawing's box around all its strokes and send one batch: a create for the first stroke, an update of `x`, `y`, `w`, `h`, `vw`, `vh`, `strokes` after that.
   - Drop points closer than about 2.5 screen pixels to the last one, and cap a stroke at 2,000 points.
3. **Rendering.** A drawing is a transparent box holding polylines built by the app from the stored numbers, in the theme's text colour, round caps and joins, width 3 board units. Give it the description as its accessible name.
4. **Interaction.** Select, move, resize, restack, delete, multi-select and undo work as for a note. Double-click and Enter do nothing. The selection bar shows "Describe" in place of "Edit" and no colour swatches.
5. **Agent dialog.** Replace the capabilities block with "What this agent may do": a fixed, always-on line "See everything on its boards", then one checkbox per ability with the wording in the table in section 3. The key's write scope is on whenever any of add, draw, edit or delete is ticked.
6. **Agents table and chat.** Show abilities as tags. Under the agent picker in the chat, say "Sees everything on this board. May: …" listing its abilities. Add "Draw a rocket" to the example chips.
7. **When an agent is not allowed.** No special handling: the run shows the write step as skipped with the reason, and the agent's reply says what it would have done.
8. **Parity check.** For every tool a run can use, confirm there is a manual control that sends the same operation. Add none for agents only.
9. **Developers.** Add two console examples: a valid drawing, and one with malformed strokes that is refused. Document the abilities and the drawing element in the reference.

**Tests that must exist**

- Playwright: draw two strokes and see one drawing with two strokes; undo removes one stroke; re-select the tool and draw again to get a second drawing; resize, describe, delete and undo a drawing.
- Playwright: ask an agent with `draw` to draw and see a drawing appear; ask an agent without it and see the skipped step and the explanation, with no change to the board.
- Playwright: untick an ability in the agent dialog and see the tag and the chat line change.
- Visual: the canvas shows dots at 100%, 50% and 200% zoom in both themes.

## 5b. Toolbar, agent input and responses (frontend only; replaces the "Agent chat" section of prompt 04)

There is no separate chat panel. The floating toolbar is the one control surface for both tools and agents.

1. **Draggable toolbar.** A grip at the toolbar's left edge drags it anywhere on the canvas. Keep it inside the canvas. Store the position per person as a fraction across and a distance from the bottom, so it survives window resizing, and restore it on the next visit. Double-click the grip to return it to bottom centre. Dragging the grip never draws, selects or pans.
2. **Two modes in one bar.**
   - *Tools mode:* grip, the tools, then the Agent button.
   - *Ask mode* (tap Agent): the same bar becomes one line: grip, a Tools button, the agent picker, a text input, Send. The tools are hidden, and the Tools button or Escape brings them back at once. Text typed but not sent is kept when switching modes.
   - Enter or Send starts a run. While a run is in progress, Send reads Stop and cancels it.
   - If no agent can work on this board, the bar says so with a link to the Agents screen.
3. **Responses live on the page.** The agent's response is a card that sits directly above the toolbar, attached to it: when the toolbar is dragged, the card moves with it. If there is not enough room above (the toolbar is near the top), the card appears below instead. The card is visible in both modes.
   - Contents: agent name and status, the person's request, the steps while the run is in progress, then the reply. After the run, steps fold behind "Show the N steps it took". "Show on board" and "Undo changes" appear when the run changed the board.
   - Earlier responses are reached with previous and next arrows on the card.
   - A close button hides the card. In ask mode with nothing showing, the same spot shows what the chosen agent may do, a few example requests, and "Show the last response".
4. **Remembered.** Responses are rebuilt from the stored runs (`GET /boards/{id}/runs`), so the latest one is on the page again after a reload or a return to the board, for everyone on the board. Whether a person has hidden the latest response is remembered per person and per board; a new run shows the card again.
5. **Keeps out of the way.** The selection bar moves to the top of the canvas whenever a response card or ask mode is showing. The canvas stays fully usable behind and around the card.
6. **Back button.** "Back to boards" is a real button with a chevron, at least 40 px wide on touch, rendered once and never rebuilt while the board is open. Pressing it while the title or a note is being edited saves the edit and still navigates.

**Tests that must exist**

- Playwright: on a new board whose title is in rename mode, Back returns to Boards.
- Playwright: drag the toolbar; reload; it is where it was left. Double-click the grip; it is back at bottom centre.
- Playwright: tap Agent, type, switch to tools and back; the text is still there. Send; steps stream in a card directly above the toolbar; drag the toolbar and the card stays attached; drag it to the top and the card shows below.
- Playwright: reload after a run; the reply is on the page. Hide it; reload; it stays hidden; "Show the last response" brings it back. A second run shows "2 / 2" and the arrows reach the first.

## 5c. HTML and CSS embeds for design brainstorming

A new element, `embed`, shows a piece of HTML and CSS live on the board, so people and agents can put real mockups beside notes and sketches. Try it in the prototype: the HTML tool in the toolbar, "Mock up a pricing page" in the agent input, and the two example boards.

### Decisions

| Decision | Why | Rejected |
|---|---|---|
| The browser is the sandbox: each embed is an `iframe` with an empty `sandbox` attribute. | That switches off scripts, forms, pop-ups and navigation, and cuts the content off from the app's cookies, storage and page. No server-side sandbox is needed to show HTML and CSS. | Inserting the HTML into the board's own page (it could restyle or read the app). Sanitising HTML on the server (large attack surface, breaks legitimate CSS). |
| A content security policy on every embed blocks all network loading. | A design must not pull in outside images, fonts or trackers, or leak that someone viewed the board. Inline CSS and `data:` images still work. | Allowing remote assets. |
| HTML and CSS only in v1; no JavaScript. | It covers layout and visual design, and keeps the isolation simple. | Scripts now. They can be allowed later by adding `allow-scripts` and serving embeds from a separate origin. |
| The server stores the HTML as text and never renders or changes it. | Nothing runs on the server, so there is nothing to exploit there. | Server-side rendering on write. |
| Same tool for people and agents; covered by the `add` ability. | Parity. An agent may add a mockup exactly when it may add a note. | An agent-only tool. |

### Contract

```ts
| (ElementBase & { type: "embed"; w: number; h: number; html: string; text: string })
// html: HTML with CSS in <style> blocks, up to 20,000 characters, stored as sent
// text: a title, 1 to 200 characters. Required. It is what the digest shows.
```

- Limits: 20,000 characters per embed; 30 embeds per board. Over a limit is `limit_exceeded`.
- Digest line: `- [<id> v<version>] embed/html @<x>,<y> <w>x<h>: <title> (<n> characters of HTML and CSS)  (by <actor name>)`. The HTML itself is not in the digest.
- `GET /boards/{id}/elements` accepts `?omit=html`. MCP `read_board` in JSON omits `html` by default and takes `includeHtml: true`, so an agent can read and revise an existing mockup when it needs to.
- Creating an embed needs `add`; changing its `html` or title needs `edit`.

### Backend

1. Validate type, size, title and length. Do not parse, sanitise or rewrite the HTML.
2. Serve the embed frame's document from a dedicated endpoint on a **separate origin** (for example `embeds.<domain>`), with these response headers: `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox` and `X-Content-Type-Options: nosniff`. Using `srcdoc` with the same policy in a `<meta>` tag, as the prototype does, is acceptable to start; the separate origin is required before scripts are ever allowed.
3. `view_board` (the image an agent looks at) must draw embeds as they appear. Render them with a headless browser that has no network access, with time and memory caps, in an isolated process. This is the one new piece of infrastructure in this section. Until it exists, draw an embed in `view_board` as a labelled box with its title.
4. Runner preamble additions: you can add an `embed` with HTML and inline CSS to show a design; no scripts and no outside files work, so write self-contained CSS; give it a clear title; size it to its content (about 300 to 480 wide); to revise a mockup, read its `html` and update the same element, do not add a second copy.

**Tests:** a valid embed round-trips unchanged; over 20,000 characters and the 31st embed are refused; an agent without `add` is refused; the digest shows the title and length only; `omit=html` drops the field; the embed endpoint returns the policy headers.

### Frontend

1. **Render.** The element is a bordered card with a title strip. Below the strip is the sandboxed frame. The frame ignores pointer input, so the card selects, drags and resizes like any element.
2. **Keep frames alive.** Do not recreate a frame when the board repaints; only when its `html` changes. Create frames for embeds near the viewport and drop those far outside it.
3. **HTML tool.** A toolbar tool (code icon, shortcut E) places a starter embed and opens the editor.
4. **Editor.** Title, a code box for HTML and CSS, and a live sandboxed preview. Opened by double-click or "Edit code" in the selection bar. Saving is one update operation, so undo restores the previous code.
5. **Tests.** Playwright: place an embed, edit its code, see the preview and the board change; a `<script>` in the HTML does not run; an outside image is not requested; drag and resize keep the frame attached; ask an agent for a mockup and see it appear.

### Example boards

The prototype seeds two boards that combine every tool. Ship them as the seed data, and use them as acceptance fixtures: each must render exactly as in the prototype.

- **Landing page redesign:** idea notes, a question note, a pen wireframe sketch, two live hero mockups (dark and light), arrows from idea to sketch to mockup, a decision diamond, and a risk note.
- **Onboarding flow:** a four-step flow in shapes and labelled arrows, a sign-up form mockup linked to its step, a pen funnel sketch with text labels, and a problem note leading to a next-step note.

## 6. Out of scope

JavaScript inside embeds, remote assets in embeds, colour, stroke width, fills, an eraser that removes part of a stroke, shape recognition, handwriting recognition, pressure sensitivity, and importing images or SVG. If any is added later, add it for people and agents at the same time.

## 7. Acceptance checks

- Every test in sections 4 and 5 passes.
- With a real model configured, "draw a lighthouse on a cliff" produces a recognisable black line drawing in open space, with a description, in one run.
- An agent with every ability switched off can still describe the whole board accurately, including its drawings, and changes nothing.
- Nothing an agent can do on a board is missing from the manual tools.
- Final report lists what was built, any deviation from this file, and how `view_board` renders drawings.
