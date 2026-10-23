# Real Estate CRM — working notes for Claude Code

Scope, rules and milestones: **docs/phase-1-brief.md** (source of truth). Read it and this file
before every task. If code and brief disagree, stop and ask.

## Layout (Better-T-Stack — don't restructure)

- `apps/web` — Next.js 16 UI only (:3001). Auth client `src/lib/auth-client.ts`, tRPC client
  `src/utils/trpc.ts`. Route groups: `(site)` public pages, `(dashboard)` sidebar shell.
  Read `apps/web/AGENTS.md`: check `node_modules/next/dist/docs/` before writing Next code.
- `apps/server` — Hono on Bun (:3000): CORS, `/api/auth/*`, `/trpc/*`, webhooks, push, scheduled jobs.
- `packages/api` — tRPC (`src/index.ts`: `orgProcedure` injects `ctx.tenant`, `requirePermission`),
  routers (`src/routers/`), services (`src/services/`, business logic, take `tenant` first).
- `packages/auth` — Better Auth (`createAuth`), roles/permissions (`permissions.ts`, shared with web),
  email senders. `packages/db` — schema (`src/schema/`), migrations, `audit.ts`, test helpers
  (`testing.ts`). `packages/ui` — shared shadcn/ui primitives and hooks.
- Server tests use `apps/server/src/test-support.ts` (seed orgs/members, sign in, tRPC callers).
- Env: varlock `.env.schema` per app is the source of truth (`.env.example` lists keys only);
  `bun run env:generate` after editing a schema. Tests load `apps/server/.env.test`.

## Commands

- `bun install` · `bun run dev` (web + server) · `bun run dev:web` · `bun run dev:server`
- `bun run db:start` / `db:stop` — Docker Postgres (dev DB + `_test` DB)
- `bun run db:generate` — create a migration from schema changes; commit it
- `bun run db:migrate` — apply migrations · `bun run db:studio`
- `bun run auth:generate` — regenerate `packages/db/src/schema/auth.ts`, then re-apply the MANUAL
  edits listed at its top and generate a migration
- `bun run org:create --name "…" --owner-email …` — operator: new company + owner (no self sign-up)
- `bun run lint` (no writes) · `bun run check` (Biome fix) · `bun run check-types`
- `bun run test` — `bun test` against the Docker test DB · `bun run test:e2e` — Playwright

## Stack conventions (brief §3)

- All business logic, tRPC, auth, webhooks, push and jobs run on the server. Web = UI via tRPC + auth client.
- Mutations: check permission → validate with Zod → DB transaction → audit entry if sensitive.
  Business logic lives in service functions, never in React components or router bodies.
- Tenancy: every tenant table has `organization_id`, taken **only** from the session's active
  organization on the server; every query filters by it; children reference `(organization_id, id)`.
- Cross-origin auth: CORS with credentials + `trustedOrigins`; URLs/origins only from env.
  Cookies are `SameSite=Lax`; set `COOKIE_DOMAIN` in production for `app.`/`api.` subdomains.
- Money = integer satang (`bigint`). Time = UTC `timestamptz`; working days computed in the
  project's time zone (default `Asia/Bangkok`). Phones normalised to E.164 before store/match.
- i18n: all strings via `next-intl` (`th` default, `en`; keys in `apps/web/messages/*.json`, locale in a
  cookie); Buddhist-era display in Thai, store Gregorian. Emails are bilingual.
- UI: shadcn/ui + Tailwind; mobile-first for salesperson screens, desktop-first for manager/exec.
- Tests: every service has ≥1 cross-tenant test (org B can't read/change org A). Playwright for
  milestone journeys.
- Scheduled work: in-process scheduler every 5 min with a Postgres advisory lock + lazy checks.
- Driver: `pg` (interactive transactions, row locks). Files: storage interface (S3/R2; local folder in dev).

## Working agreement (brief §13)

- One milestone per branch. Before coding, list files to create/change and schema changes; wait
  for approval.
- Never accept organization IDs, roles or member IDs from client input.
- Never edit an applied migration. Never use `db:push` (the script is removed) — use generate + migrate.
- Don't add dependencies without asking. Don't silence type or lint errors.
- After each milestone: `bun run lint`, `bun run check-types`, `bun run test`, `bun run test:e2e`;
  summarise what changed, what was tested, anything uncertain. Stop; don't start the next milestone.
- If a rule is ambiguous or seems wrong, ask instead of guessing.
