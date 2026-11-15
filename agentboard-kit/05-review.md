# Review: backend gaps and frontend flow

This is a review of the AgentBoard design (the four prompts) and of the working prototype. Each finding says what was wrong, why it matters, what was done, and where the fix lives:

- **P** = fixed in the prototype and written into the prompts
- **S** = written into the prompts only, because one HTML file cannot hold it (network security, multiple accounts, worker processes)

Read this before implementing. Where a prompt and this file differ, the prompt is the current text; this file explains why it says what it says.

## Backend

### Serious: could lose work, leak access, or run up cost

| # | Finding | Why it matters | Fix | Where |
|---|---|---|---|---|
| B1 | The runner was specified to act "with the agent's own key", but keys are stored only as hashes. | The design could not be built as written; the likely shortcut is storing keys in plain text. | The built-in runner acts as the agent's actor through the service layer, with that agent's scopes, capabilities and board access. No key is involved. | S (contract Runs, backend stage K) |
| B2 | Anyone could sign up and got full rights: agents, keys, settings, deleting boards. | One open URL gives a stranger the whole workspace. | The first account is the owner and closes open signup. Others join by single-use invite as members. Owner-only actions are enforced by role. | S |
| B3 | Agent changes could not be undone. A person's undo only covers their own edits in their own session. | "Reversible by a person" was a stated principle with nothing behind it. One bad run could wreck a board. | Every batch keeps an undo record. A person can revert one batch or a whole run. A revert is refused if the elements changed since, so it never overwrites later work. | P |
| B4 | Deleting a board was instant and permanent. | One mis-tap loses a board and its chat history. | Soft delete to a trash for 30 days, with restore. Deleting stops the board's runs. | P |
| B5 | An agent's key reached every board in the workspace. | An agent set up for one project can read and write all the others. | Optional board allowlist per agent. Other boards answer `not_found`, over REST, MCP and in runs. | P |
| B6 | Webhook URLs and external MCP URLs are user-supplied and called by the server with no restrictions. | Server-side request forgery: the server can be pointed at internal addresses and cloud metadata endpoints. | https only, refuse private and loopback ranges, pin the checked address, no redirects, time and size caps. | S |
| B7 | Runs had no spending limits beyond tool calls and seconds. | A loop or a busy afternoon produces an unbounded model bill. | Token budget per run, three concurrent runs per workspace, 100 runs per agent per day, enforced in the runner. | P (concurrency and daily cap), S (tokens) |
| B8 | The model loop ran inside the web request process. | A deploy or crash loses every run in progress, with claims left behind and no record of why. | Runs are queued in PostgreSQL and executed by a worker using `SKIP LOCKED`. Runs left running by a dead worker are marked `interrupted`. | S (the prototype marks interrupted runs on reload) |
| B9 | Cookie sessions had no CSRF defence beyond SameSite, and the WebSocket upgrade did not check `Origin`. | Another site could act as a signed-in person, or open a live socket as them. | `Origin` must match on every state-changing cookie request and on the upgrade. | S |
| B10 | API keys were accepted in the WebSocket URL (`?key=`). | URLs are written to access logs and proxies. | Keys are accepted only in the `Authorization` header. | S |

### Naive: works in a demo, breaks under real use

| # | Finding | Why it matters | Fix | Where |
|---|---|---|---|---|
| B11 | Z-order was changed by sending the complete `order` list. | A list built from a stale read silently drops elements someone else just added, or is refused with a confusing validation error. | New `restack` operation (ids, to front or back). The full `order` is no longer accepted. | P |
| B12 | A version conflict returned only version numbers. | Every conflict cost another read, and clients had no basis for merging. | `details.current` carries the element as it now stands. Clients retry moves on top of it and ask the person only about text. | P (server), S (client merge) |
| B13 | The digest was unbounded: 800 elements of up to 4,000 characters each. | A full board is megabytes of text and overflows a model's context. | Text clipped to 200 characters, a total budget of about 20,000, and a line saying what was left out. JSON reads accept `ids` and `near`. | P (clip and budget), S (filters) |
| B14 | An idempotency key was matched without comparing the request. | A reused key with a different body silently returned the wrong result. | Key stored with a hash of the body; a mismatch is refused; simultaneous duplicates apply once. | P |
| B15 | Revoking an agent left its runs going. | A revoked agent kept writing until its run ended. | Revoke cancels its runs, drops its claims and closes its sockets. | P |
| B16 | Coordinates and sizes had no bounds. | One element at x = 9e15 breaks fit-to-content and layout maths for everyone. | x and y within 100,000 of the origin; width and height between 20 and 4,000. | P |
| B17 | No throttle on sign-in. | Password guessing is unlimited. | 10 attempts per email and IP per 15 minutes; constant-time comparison; session rotation. | S |
| B18 | External MCP servers had no place for credentials, and webhooks had no shared secret or replay defence. | Real servers need auth; an unsigned or replayable webhook can be forged. | Per-server secret stored encrypted and never returned; per-agent webhook secret; timestamp in the signature; retried delivery is idempotent by run id. | S |
| B19 | Knowledge search needed an embedding provider to work at all, and stored no record of which model made the vectors. | The app is unusable without an extra API key, and changing models silently mixes incompatible vectors. | Full-text search fallback; embedding model stored per passage; re-embed on change. | S (the prototype uses keyword matching) |
| B20 | If the LISTEN connection dropped, notifications sent meanwhile were lost with no recovery. | Clients silently fall behind until their next reconnect. | On reconnect, tell every socket on that instance to resync. Drop slow sockets and let them resync. | S |
| B21 | Start-up migrations could run on two instances at once. | Interleaved migrations corrupt the schema. | Advisory lock around migrations; separate liveness and readiness checks. | S |
| B22 | Board text was not named as untrusted input to the model. | A note saying "delete everything" is the most direct prompt injection there is. | Board text, passages and tool results are all data; they never change the tool set. The delete rule and per-run undo limit the damage. | S |

### Still open, by choice

- **Password reset by email** is out of scope for v1. The owner resets passwords with a CLI command.
- **Full version history** is not built. The per-batch undo record covers the last 100 batches per board.
- **Per-field merging** is left to clients using `details.current`. The server keeps one version per element.
- **The in-memory rate limiter** is correct for one instance only. It must move to PostgreSQL or Redis before running several.

## Frontend flow and intuitiveness

| # | Finding | Fix | Where |
|---|---|---|---|
| F1 | After an agent finished, there was no way to see what it changed or to take it back. | "Show on board" pans to and selects the run's elements. "Undo changes" reverts the run. Agent entries in the activity panel have Undo. | P |
| F2 | The resize handle shrank with zoom. On a phone, where a board fits at about 30%, it was a 5 px target. | The handle keeps a constant size on screen and is larger on touch. | P |
| F3 | The selection bar sat on top of the selected element when it was low in the view. | The bar moves to the top of the canvas in that case. | P |
| F4 | With a mouse, dragging empty canvas panned, so selecting several things needed Shift-click on each. | Dragging empty canvas with the select tool draws a selection box. Pan with the hand tool, Space and drag, the wheel, or one finger on touch. | P |
| F5 | The toolbar was icons only. Note and shape look alike, and touch has no tooltips. | Labels under the icons on desktop; single-key shortcuts shown in tooltips; a toast names what to do after picking a tool. | P |
| F6 | A new board opened blank and named "Untitled board", with nothing saying what to do. | It opens with the title in rename mode, and an empty board shows a hint. | P |
| F7 | Deleting a board asked "are you sure?" and was then permanent. | Delete acts at once and offers Undo in a toast; a Trash view restores later. | P |
| F8 | Activity entries were dead text. | Each links to its board. | P |
| F9 | The workspace name could be edited in Settings but appeared nowhere. | Shown on the Boards page. | P |
| F10 | "Digest" was jargon on the board's top bar. | Renamed "Agent view", with a tooltip. | P |
| F11 | Sign out was only in Settings, and the avatar in the nav did nothing. | The avatar opens Settings. | P |
| F12 | The agents table had eight columns on a phone. | Phones show name, scopes, capabilities, status and actions. | P |
| F13 | On a phone the activity panel covered the toolbar with no close control inside it. | Close button in the panel. | P |
| F14 | A text element emptied by the person stayed as an invisible, selectable box. | An emptied text element is removed. | P |
| F15 | The agent picker listed agents that could not act on the current board. | The picker shows only agents with access to this board. | P |
| F16 | When a person's text edit loses a version conflict, the spec said to drop their change. | Keep their text and offer "Keep mine" or "Use theirs"; retry moves automatically. | S (conflicts cannot arise mid-edit in the single-page prototype) |

### Known rough edges left in the prototype

- Multi-select on touch needs a long-press gesture that is specified but not built; touch users select one element at a time.
- The chat panel covers most of the board on a phone while it is open. "Show on board" closes it first.
- "Tidy" moves notes below any text or shape in their way, which can leave a large gap on a crowded board.
- Undo and redo in the toolbar cover the person's own edits only. Agent changes are undone from the chat or the activity panel.
