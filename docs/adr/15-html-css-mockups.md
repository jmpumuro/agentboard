# Sandboxed HTML/CSS mockups with natural-language creation

Decision: store HTML as plain text in a new embed element and render it in a sandboxed frame. Natural-language briefs and refinement requests are the primary product flow; direct code editing is an advanced alternative. Add/Edit abilities and the shared ops service govern both people and agents.

Reason: people can explore real designs beside notes and drawings without learning markup. A stable memoized frame keeps previews alive through canvas updates while the browser isolates untrusted content from the application.

Rejected: inserting HTML into the app document, executing JavaScript, fetching remote preview assets, parsing/sanitizing HTML on write, inventing a separate privileged agent tool, and claiming the native raster renderer can display arbitrary HTML.

Implementation: shared contract and example data; `MockupComposer`, `EmbedEditor`, `EmbedView`; explicit CSP and sandbox boundaries; viewport-based frame mounting; labelled PNG snapshot fallback. Separate-origin hosting and an isolated browser renderer remain prerequisites for future capabilities as documented in EMBED-UPDATE.md.
