# Verification report

Reviewed November 14, 2026 with Node 22.23.4. This report distinguishes local
checks, earlier user-host browser results, and checks still awaiting execution.

| Check | Evidence |
| --- | --- |
| TypeScript | Passed `npm run typecheck` |
| Shared contracts | Passed `npm run contract:generate` |
| Unit and service integration tests | 305 passed; 1 PostgreSQL check skipped because no database was reachable |
| Production bundle | Passed `npm run build`; lazy Three.js bundle remains above Vite's 500 kB advisory threshold |
| Desktop and phone Playwright | Earlier user-host run passed all 11 fixture checks; current restricted environment cannot bind the test server |
| Live OpenAI browser flow | Latest supplied run failed on generated 3D part versions and exhausted its budget; subsequent fixes have deterministic regression coverage, but a successful live rerun has not been recorded |
| PostgreSQL and multi-process behavior | Tests exist; not verified against live infrastructure in this review |
| Public source review | Credential-pattern scan of all 165 existing history blobs found no matches; private environment, workspace and report files are excluded |

The final review added regressions for live authorization expiry/removal/key
rotation/scope loss and for a human edit arriving between an agent's read and
write. Missing agent versions are inferred only from observed reads and write
receipts, preserving optimistic concurrency. Socket messages have a small
payload cap and heartbeat; outbound service addresses reject reserved ranges.
These checks are useful evidence, not a claim of a comprehensive security audit.

CI runs clean dependency installation, contract checks, the test suite against
a disposable PostgreSQL service, a production build, and desktop/phone browser
fixtures. CI has been added; its remote result must be checked after publication.
It never receives a provider key. Live provider tests require an explicit local
key and incur usage.

To reproduce on an unrestricted host:

```sh
npm ci
npm run verify
npx playwright install chromium
npm run test:e2e
npm run test:live # optional, requires an OpenAI key
```

Set `DATABASE_URL` to a disposable PostgreSQL database to enable database tests.
Local logs, auth state, screenshots and traces remain under ignored directories;
they are not public release artifacts. See `SECURITY.md` for deployment limits.
