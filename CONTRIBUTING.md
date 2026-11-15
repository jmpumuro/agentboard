# Contributing

Use Node 22.12 or newer and `npm ci`. Copy `.env.example` to `.env`, build with
`npm run build`, then run `npm run dev`. Use a disposable workspace for tests.

Keep browser components in `apps/web`, authoritative mutations and permissions
in `apps/api`, and shared schemas in `packages/contract`. New agent tools must
use the same validated operations as human edits. Preserve optimistic version
checks, capability checks, and atomic rollback.

Before a pull request, run `npm run verify` and `npm run test:e2e`. Install
Chromium with `npx playwright install chromium`. A reachable disposable
PostgreSQL database in `DATABASE_URL` enables the database integration test.
`npm run test:live` additionally uses a real OpenAI key and incurs provider
usage; it is intentionally excluded from public CI.

Include a focused regression test for behavior changes and describe the user
impact and validation. Never commit keys, `.env`, workspace data, browser auth
state, or traces containing private prompts. Contributions use the MIT license.
