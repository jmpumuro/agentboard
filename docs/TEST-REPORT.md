# Staged verification

Build session: 2026-11-14, macOS restricted workspace. Commands use Node 22.23.4. Results distinguish executed tests from authored tests that could not run.

| Gate | Checks | Result |
| --- | --- | --- |
| 1 — Scaffold and contract | Boundary schemas, four element types, bounds, unsupported sections/order, agent defaults, fixtures | Passed |
| 2 — Core service | Rollback, simultaneous stale writers, idempotent retry/body mismatch, arrow cascade/integrity, restacking, guarded undo, scopes, allowlists, digest clipping/budget | Passed against serialized local adapter; not PostgreSQL |
| 3 — HTTP service routes | Signup/invites/member permissions, Origin checks, board create/rename/trash/restore, hashed/revoked keys, REST/MCP permissions, claims, knowledge, settings, activity | Passed via direct transport dispatcher; no network socket |
| 4 — Board engine | Immutable optimistic overlay, duplicate/gap handling, explicit resync | Passed |
| 5 — Worker | Ordered injected-model tool loop, agent attribution, claim cleanup, read-only behavior, forbidden tool results, interrupted/queued recovery, multi-batch run undo | Passed with fake model, not a live provider |
| 6 — Security/integrations | Public address filtering, scheme/credential rejection, salted password checks, persistence rollback/restart, AES-GCM, preserving/rotating secrets, signed webhook callbacks and run undo | Passed; outbound calls mocked for integration tests |
| 7 — React DOM integration | Create account, connect agent/one-time key UI, all five routes against actual service dispatcher, new board, open/close chat | Passed in jsdom; not visual browser verification |
| 8 — Static checks/delivery | TypeScript, contract generation, production Vite build | Passed |
| 9 — Real browser | Auth/navigation/board edit/color/delete/undo/trash/restore on desktop and phone | Playwright suite authored; blocked, not passed |
| 10 — Real infrastructure | Docker/PostgreSQL, live network/WS and provider/external service checks | Blocked, not passed |

The latest executable test count is recorded in `reports/verification.log` after `npm run verify`.

## Observed environment blockers

- Registry access: `Could not resolve host: registry.npmjs.org` / `ENOTFOUND`. Dependencies were recovered from existing installed packages and the local npm cache. Fresh networked installation was not verified.
- Docker: permission denied accessing `/Users/jmpumuro/.docker/run/docker.sock`.
- Native PostgreSQL: `initdb` failed at `shmget`: “Operation not permitted.” No actual PostgreSQL test was passed.
- Local server: `listen EPERM 127.0.0.1:4173`. No running localhost preview could be provided from this sandbox.
- Chromium: process startup failed at macOS `bootstrap_check_in ... MachPortRendezvousServer: Permission denied`. Screenshots and Playwright assertions did not run.

## Follow-up commands on an unrestricted host

```sh
nvm use
npm install
npm run verify
npx playwright install chromium
npm run test:e2e
docker compose up --build
```

The production architecture gaps in `IMPLEMENTATION.md` must be addressed before claiming all kit acceptance checks pass. Docker definitions and the PostgreSQL adapter are supplied but not validated in this session.
