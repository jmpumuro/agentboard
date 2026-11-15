# Numeric pen drawings and scoped abilities

Decision: extend the shared contract with a drawing element composed only of numeric strokes, a short description, a recording view box and board geometry. People and agents use the same versioned operations. The service checks `add`, `draw`, `edit`, `delete` and `knowledge` independently of the key’s write scope. Reads retain all board context regardless of abilities.

Reason: a sketch is one movable object, with undo per stroke, and agent permissions should narrow actions without hiding context. Numeric-only storage needs no executable markup parser. Existing writers migrate once to add/draw/edit; deletion is never granted by migration.

Rejected: copied prototype planner/drawing presets, agent-supplied SVG, raster uploads, color/width controls, and a separate privileged agent write path. The new prompt explicitly supersedes the original freehand exclusion.

Implementation: shared schemas and limits in `packages/contract`; `services/permissions.ts` authorizes each operation; local and PostgreSQL adapters migrate legacy state; `render/board-png.ts` creates PNG board snapshots with native 2D primitives and a bounded cache. Frontend gesture geometry lives in the React-free board engine; rendering lives in `DrawingView`.
