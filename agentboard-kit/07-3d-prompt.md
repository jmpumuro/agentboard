# 3D prompt: explore the codebase, then add shared human and agent 3D models with breakdown

You implemented AgentBoard from prompts 01 to 06. This prompt adds one feature: **3D models as a native board element that people and agents build, inspect, edit and take apart to explain how something works.**

Do not start coding. Your first response is an assessment of the real codebase and an implementation contract for approval (phases 1 to 3). Implementation is phase 4 and begins only after explicit approval.

The design below is a proposal that has been tried in the prototype. Challenge it where the real code says otherwise, and say why.

## Sources of truth, in order

1. The code as it actually is. Where it differs from the prompts, the code wins and you report the difference.
2. `02-contract-prompt.md` and `06-drawing-prompt.md` for the rules already agreed: free-form boards, operations and versions, per-agent abilities, runs, the agent input in the toolbar, undo of agent work, "people and agents have the same abilities".
3. `prototype/index.html` for behaviour. Open the board "Example: how an engine works (3D)", and try the 3D tool. Its renderer is hand-written and its agent is a rule-based stand-in; copy neither. Copy the behaviour, the data shape and the operation format.

## What the feature is

- A board element, `scene3d`, shown as a card: title strip, a 3D view, and a caption line.
- A model is **data, not code**: a list of named parts. Each part is a simple solid with a position, a size, a colour and a one-line explanation.
- **Breakdown is the point.** Because every part is separate and named, anyone can:
  - pull the model apart with a slider to see inside,
  - tap a part to read its name and what it does,
  - hide a part, or show only one part.
- People and agents edit the **same parts with the same operations**. A person can build a model by hand and ask an agent to change it; an agent can build one and a person can edit any part of it.
- Creation and change by description go through the agent input in the toolbar. No new panel, dialog or chat.

## Phase 1: discovery (read only)

Inspect the repository and report, with file paths and names:

**Frontend:** how elements are rendered and registered; how toolbar tools are registered; the selection bar; pointer and keyboard handling on the canvas (pan, zoom, drag, marquee, touch); the board store, pending batches and conflict handling; undo and redo; how designs (`embed`) keep heavy content alive across repaints.

**Backend and agent runner:** the element schema and validation; `applyOps`, versions, the undo record and revert; abilities and scopes; claims; the digest; the runner's tool loop and what language and framework it is actually written in; MCP tools; `view_board` rendering if it exists.

**Reuse:** list what already exists that this feature should use (operation dispatch, live updates, the ask input and its design target, the response card, limits, fixtures, seed data). Propose no duplicate infrastructure.

## Phase 2: evaluate the approach

Proposed stack, to be confirmed against the code:

| Layer | Proposal | Evaluate |
|---|---|---|
| 3D rendering | Three.js | Bundle size; load it only when a board has a model |
| React integration | React Three Fiber, with Drei for orbit controls | Whether it fits the existing element renderer, or whether a plain Three.js view in one component is simpler |
| Scene data | The structured parts list below | Fit with the element schema and `props` storage |
| Agent | The existing runner and its tools | No second agent path |
| CAD geometry (build123d or similar) | **Not in this version** | Say whether any explanation use case really needs it |

Answer specifically:

1. **Live views.** Browsers allow only a limited number of live 3D contexts per page. Propose how many models are live at once (default: the one being used, plus those in view up to a small cap) and what the others show (a still image taken when they last rendered).
2. **Pointer rules.** In the prototype, dragging on the 3D view turns the model, dragging the title strip moves the card, tapping a part selects it, pinch on the view zooms the board. Confirm this coexists with pan, marquee and touch, or propose better.
3. **Nesting.** Whether parts need groups in this version (default: no; flat list, with an optional `group` label later).
4. **Simpler alternative.** Whether anything lighter than the proposed stack would serve an explanation-focused tool.

## Phase 3: the implementation contract (present this for approval)

### A. Data

```ts
type Part = {
  id: string;                 // unique within the model; server-assigned if omitted
  v: number;                  // version of this part, starts at 1, +1 on every change
  kind: "box" | "cylinder" | "sphere" | "cone";
  pos: [number, number, number];    // centre, in model units; y is up; each within -100..100
  size: [number, number, number];   // width, height, depth before orientation; each 0.05..100
  axis?: "x" | "y" | "z";           // which way the solid's height points; default "y"
  color: "gray" | "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "white";
  name: string;               // 1 to 60 characters
  info: string;               // what the part does, up to 300 characters; shown when tapped
  out?: [number, number, number];   // direction and distance the part travels when the model is fully pulled apart
};

// added to the Element union
| (ElementBase & {
    type: "scene3d";
    w: number; h: number;
    text: string;             // title, 1 to 200 characters
    prompt?: string;          // the words it was built from, up to 1,000 characters
    parts: Part[];            // at most 60
    camera: { yaw: number; pitch: number };   // radians; how the model is first shown
    explode: number;          // 0 to 1; how far apart it is first shown
  })
```

Persistent: everything above. **Not persisted, per viewer:** the current view angle, the pull-apart slider position, the selected part, hidden parts and "only this part". Turning a model or pulling it apart to look never writes to the board; an editor who wants the default changed updates `camera` or `explode`.

When a part has no `out`, it moves straight away from the model's centre when pulled apart. An agent should set `out` for parts that sit inside others, so the breakdown reveals them.

### B. Operations (one interface for people and agents)

Add three operations to the existing ops batch. They act on one part and need **that part's version**, not the element's:

```ts
| { op: "part.add";    id: string /* model */; part: PartInput }
| { op: "part.update"; id: string; partId: string; ifPartVersion: number; data: Partial<PartInput> }
| { op: "part.delete"; id: string; partId: string; ifPartVersion: number }
```

- A stale `ifPartVersion` is `version_conflict` with `details: { id, partId, expected, actual, current }`. Two editors changing different parts of one model never conflict.
- Each part operation also bumps the element's `version` and adds a result `{ id, version, partId, partVersion }` (`partVersion` null for a delete).
- The whole model (title, `camera`, `explode`, or a full replacement `parts` list) can still be changed with the ordinary `update` operation and `ifVersion`.
- Abilities: creating a model needs `add`; `part.add`, `part.update`, `part.delete` and `update` need `edit`; deleting the model needs `delete`. Claims, the delete rule, limits and the undo record apply as for any element. Reverting a batch restores the previous parts list.
- Limits: 60 parts per model, 20 models per board.

The React UI and the agent runner both produce these operations and send them through `applyOps`. Neither has another path. Map the conceptual commands in the original request as follows: `createScene` is `create`; `createObject`, `updateObject`, `deleteObject` are the three part operations; `setCamera` is `update` with `camera`; `getScene` and `getObject` are the read paths in C. `groupObjects` is out of scope.

### C. How an agent inspects a model

- **Digest:** the element line, then one indented line per part:

```
- [<id> v<n>] scene3d/3d @<x>,<y> <w>x<h>: <title> (<k> parts, pulled apart <p>%)  (by <actor>)
    · part [<partId> v<n>] <kind>/<color> “<name>” at <x>,<y>,<z> size <w>,<h>,<d>: <info>
```

- **JSON:** `read_board` with `format: "json"` returns the full `parts`.
- **Image:** `view_board` draws models as they are first shown (using `camera` and `explode`).
- An agent must read a model before changing it and use the part versions it read.

### D. Runs

- A run's `design` target may be a `scene3d` element: `{ elementId }`. The runner then gives the model that element's title, `prompt` and `parts`, and the model edits **that** element with part operations. It never adds a second copy.
- Runner preamble additions: models are built from the four solids; give every part a clear `name` and an `info` sentence a newcomer would understand; set `out` so the breakdown separates parts cleanly and reveals what is inside; keep a model under about 25 parts; use colour to tell parts apart, not to decorate; set `prompt` to the person's description.
- If asked for something the solids cannot show, the agent says so and builds the nearest explanatory version.

### E. User experience (as in the prototype)

- **3D tool** in the toolbar (cube icon). Tapping the board places a starter model with one block, selects it, and opens the agent input with the placeholder "Describe the 3D model to build, or what to change…". The person can type a description, or leave the input and build by hand.
- **On the card:** drag the view to turn the model; tap a part to select it and see its name and explanation in the caption; drag the title strip to move the card; resize from the corner.
- **Selection bar for a model:** a "Pull apart" slider; "Add part" (box, cylinder, sphere, cone); "Ask agent"; front, back, delete.
- **Selection bar for a selected part:** the eight colours; Hide; Only this / Show all; move left, right, up, down, near, far; Bigger; Smaller; Rename (name and explanation); Delete part.
- **Targeting:** while a model (or a design) is the target, follow-up requests in the agent input keep going to it until the person leaves ask mode. Opening the input with a model selected targets it.
- **Undo:** each manual part edit is one batch and one undo step. An agent's changes are undone from the response card.
- Accessible name for the view: the title and the list of part names. The caption text is the readable explanation.

### F. What you must present

1. **Current architecture:** the relevant files and how they work today.
2. **Recommended integration:** component boundaries and data flow for the 3D card, with the live-view policy.
3. **Technology decisions:** libraries chosen, alternatives considered, required and optional dependencies, bundle impact.
4. **Shared data contract:** schemas in the contract package's language, plus validation and fixtures.
5. **Agent tool contract:** how existing tools carry the new operations; no new tool unless you can show one is needed.
6. **Editing and synchronisation:** how a person's edit and an agent's edit reach the same authoritative state, with versions, conflicts, undo, permissions and live updates.
7. **Scope:** what is built first and what is excluded.
8. **File-level plan:** files to change and modules to create, in order.
9. **Risks and open decisions:** each with a recommended default. Ask only what materially changes the build.
10. **Acceptance tests** (section below).

**Then stop.** Do not install dependencies, change code or schemas, or create modules until the contract is explicitly approved. Silence is not approval. If changes are requested, revise and present again.

## Scope

**In this version**

- The `scene3d` element, the four solids, the eight colours, part names and explanations.
- Turn, pull apart, tap to read, hide, only this.
- Manual part editing with the selection bar controls above (no drag handles in 3D).
- Agent build and change by description, through the agent input.
- Digest, limits, abilities, undo, live updates, seed data for the engine example board.

**Not in this version** (leave no hooks for these): 3D drag handles, rotation of individual parts beyond `axis`, groups and assemblies, animation, labels floating in 3D, imported 3D files, CAD geometry, physics, textures, transparency, cross-sections.

## Phase 4: implementation (only after approval)

1. Build exactly the approved contract, following the codebase's conventions.
2. Add only the approved dependencies, loaded only where a model is shown.
3. Keep every existing tool and test working.
4. If discovery during implementation requires a material change to the contract, stop and ask.
5. Report any deviation. Do not widen scope.

## Acceptance tests

Interoperability, in one flow:

1. A person places a model with the 3D tool.
2. The person adds a box with "Add part".
3. The agent reads the board; the digest lists both parts with their versions.
4. The agent changes the box's size with `part.update` using the version it read.
5. The UI shows the change without reload.
6. The person moves that same part with the selection bar.
7. The agent reads again and sees the new position and version.
8. Everything persists after reload.
9. Toolbar undo steps back the person's edits one at a time; "Undo changes" on the response card reverts the agent's.

Also:

- A `part.update` with a stale `ifPartVersion` is refused with `version_conflict` and `details.current`; updates to two different parts from two actors both succeed.
- An agent without `edit` cannot change a part; without `add` it cannot create a model; each refusal names the ability.
- Pulling apart, turning, hiding and "only this" change nothing on the server and are not seen by other people.
- With the slider at full, every part of the engine example is visible and none overlap from the default angle.
- Tapping a part shows its name and explanation; the accessible name of the view lists the parts.
- A board with twenty models stays responsive, and no more than the agreed number of 3D views are live.
- With a real model configured, "build a 3D model of a bicycle and show how the chain drives the wheel" produces a recognisable model with named, explained parts that separate cleanly when pulled apart.

Finish your first response by asking for approval of the contract.
