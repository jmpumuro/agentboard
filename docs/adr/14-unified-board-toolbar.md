# One movable toolbar for tools and agents

Decision: use a draggable dock containing tools or an agent request form, with a response card attached above or below. Store dock placement per person in browser storage as a fractional horizontal position and distance from the bottom. Run history remains server data; only the latest hidden-response marker is stored locally per person and board.

Reason: people should act on one canvas without a separate chat panel. Keeping the dock and response within one positioned parent makes their attachment structural. Browser-only preference storage avoids adding UI state to the board contract.

Rejected: copying the single-file prototype, rebuilding the entire board when the toolbar changes, storing model output only in local storage, and retaining a separate chat panel. A stable back button saves active edits before navigation.

Components: `BoardPage` coordinates the board, `BoardToolbar` owns mode/placement/draft state, `ResponseCard` presents durable runs, `SelectionBar` sends ordinary operations, `DrawingView` renders trusted numeric geometry, and shared controls live in `ui/`. `AbilityPicker` is independent of the board. Pure drawing and placement functions are tested without React. Theme preference and semantic colors remain shared across all components.
