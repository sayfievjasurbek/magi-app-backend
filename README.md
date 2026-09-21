# MAGI API

Backend of the MAGI exam-proctoring platform: Express 5, TypeScript, Supabase (Postgres via PostgREST), JWT in an httpOnly cookie. Roles: student, professor, examiner.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in. `DATABASE_KEY` must be the Supabase `service_role` (or secret) key, `DATABASE_DIRECT_URL` is the Postgres connection string and is only used by the migrations.
3. `npm run migrate` applies `migrations/*.sql` in order (needs `psql`).
4. `npm run dev` starts the server on `PORT`. The API docs are served at `/docs`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | server with reload |
| `npm run migrate` | apply the SQL migrations |
| `npm test` | unit and route tests (vitest, database mocked) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run e2e` | drives the real server against the database in `.env`, creates and removes its own test data (use a throwaway project) |

## Layout

Routes wire the endpoints, controllers are thin, services hold the logic, `lib/` has the shared helpers. Domains: modules, questions, exams, attempts (`/api/assignments`), monitoring, cheatings.

- `docs/conventions.md`: how to add a resource
- `docs/database.dbml`: the database design
- `legacy/`: the earlier academic design, not loaded at runtime
