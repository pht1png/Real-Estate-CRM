# Real-Estate-CRM

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Hono, TRPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **tRPC** - End-to-end type-safe APIs
- **Bun** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Biome** - Linting and formatting
- **Husky** - Git hooks for code quality
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Local Setup

1. Copy the env examples and set a secret (`openssl rand -base64 32`) in `apps/server/.env`:

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

2. Start PostgreSQL in Docker (Docker Desktop must be running) and apply the migrations:

```bash
bun run db:start
bun run db:migrate
```

Schema changes: edit `packages/db/src/schema/`, run `bun run db:generate`, review and commit the
generated migration, then `bun run db:migrate`. Never edit an applied migration; `db:push` is not used.

Next, create a company and its owner. There is no public sign-up; everyone else is invited from Settings → Members. With `EMAIL_PROVIDER=log`, emails are printed to the console:

```bash
bun run org:create --name "My Company" --owner-email you@example.com
```

The owner gets a link to choose a password. If that email already has an account, they sign in
(sign out and in again to land in the new company).

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.
- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@Real-Estate-CRM/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `bun run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Uploads (floor plan images) go to `apps/server/.storage/` by default (`STORAGE_DRIVER=local`). In production set `STORAGE_DRIVER=s3` with `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (e.g. a Cloudflare R2 bucket). Files are only served through signed, expiring URLs.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Git Hooks and Formatting

- Initialize hooks: `bun run prepare`
- Run checks: `bun run check`

## Project Structure

```
Real-Estate-CRM/
├── apps/
│   ├── web/         # Frontend application (Next.js)
│   └── server/      # Backend API (Hono, TRPC)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:start` / `db:stop`: Start / stop PostgreSQL in Docker
- `bun run db:generate`: Generate a migration from schema changes (commit it)
- `bun run db:migrate`: Apply migrations
- `bun run db:studio`: Open database studio UI
- `bun run lint`: Biome lint and format check (no writes; used in CI)
- `bun run check`: Biome fix (format, organise imports, safe fixes)
- `bun run test`: `bun test` suites against the Docker test DB (`Real-Estate-CRM_test`, created
  automatically; settings in `apps/server/.env.test`)
- `bun run test:e2e`: Playwright (Chromium + WebKit). Starts its own API on :3100 and a production
  build of the web app on :3101. First run: `cd apps/web && bunx playwright install chromium webkit`

## Better Auth Schema Generation

After changing auth plugins or schema options, run `bun run auth:generate` from the project root. The script runs the Better Auth CLI through `varlock run` from the owning app directory, loading the auth instance from `src/services.ts`. Review the schema changes, re-apply `{ withTimezone: true }` to its timestamp columns, then run `bun run db:generate` and `bun run db:migrate`.
