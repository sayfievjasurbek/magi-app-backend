# MAGI API

Backend of the MAGI exam-proctoring platform: Express 5, TypeScript, PostgreSQL. Roles: student, professor, examiner.

Used by the professor panel (magi-admin), the student website (magi-frontend) and the desktop exam app (magi_app). Auth is a JWT, sent either as the `jwt` httpOnly cookie (web) or as `Authorization: Bearer <token>` (desktop app).

## Stack

- **Database**: PostgreSQL (Railway), queried directly through `pg` (`lib/db.ts`, `lib/pg-query-builder.ts`)
- **File storage**: Supabase Storage, for proctoring photos, audio clips and homework files (`lib/storage.ts`)
- **Email**: Mailtrap
- **AI** (optional): OpenAI, for AI grading and the Magi AI assistant in the professor panel
- **Deploy**: Railway, built from the `Dockerfile`

## Setup

1. `npm install` (Node 22)
2. Copy `.env.example` to `.env` and fill it in. `DATABASE_DIRECT_URL` is the Postgres connection string, `DATABASE_URL` / `DATABASE_KEY` are the Supabase project URL and service_role key (storage only).
3. `npm run migrate` applies `migrations/*.sql` in order (needs `psql`).
4. `npm run dev` starts the server on `PORT`. The API docs are served at `/docs`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | server with reload |
| `npm start` | server without reload |
| `npm run migrate` | apply the SQL migrations |
| `npm test` | unit and route tests (vitest, database mocked) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run e2e` | drives the real server against the database in `.env`, creates and removes its own test data (use a throwaway database) |

## Layout

One folder per domain under `features/`, holding its route, controller, service, entities and API docs. `lib/` and `middleware/` are the shared infrastructure.

| Domain | What it covers |
|---|---|
| `auth` | sign in, accounts for students/professors/examiners |
| `modules` | classes (groups), their professors and students |
| `questions` | the question bank |
| `exams` | exams and homework, their questions, classes and students |
| `attempts` | taking an exam (`/api/assignments`), grading, retakes |
| `monitoring` | proctoring photos and audio clips |
| `cheatings` | cheating incidents reported by the desktop app |
| `attendance` | class attendance |
| `notifications` | in-app notifications |
| `ai` | AI grading and the Magi AI assistant |

- `docs/database.dbml`: the database diagram, paste it into https://dbdiagram.io
- `docs/conventions.md`: how to add a resource
- `legacy/`: the earlier academic design, not loaded at runtime
