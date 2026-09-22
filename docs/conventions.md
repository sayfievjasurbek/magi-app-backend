# Backend conventions

Express 5 + TypeScript ESM (run with tsx), Supabase with the service_role key, vitest.
Imports always carry the `.js` extension. `legacy/` is the replaced academic code: never import from it.

## Where files go

Five files per domain in `features/<domain>/`; `lib/` and `middleware/` are shared by every domain and stay at the root, next to the `server.ts` that mounts the routers.

1. `<domain>.route.ts` — wiring only. The router already has `router.use(protectRoute)` and is
   already mounted in `server.ts`. Add `requireRole('professor', 'examiner')` per endpoint.
2. `<domain>.controller.ts` — thin: read `req.params`/`req.body`/`req.user`, call the service, answer
   `{ success: true, ... }`, `catch (error) { return handleControllerError(res, error, "<name> controller"); }`.
3. `<domain>.service.ts` — all business logic and every database call. Expected failures are
   `throw new HttpError(status, message)`; anything else becomes a 500. `auth` has no service,
   its logic sits in the controller.
4. `<domain>.entities.ts` — one exported type per table the domain owns, PascalCase singular after
   the table (`module_professor` → `ModuleProfessor`), fields straight from `migrations/`.
5. `<domain>.docs.ts` — the endpoints and their schemas in one file (`tags`, `paths`, `schemas`), written in
   the same change. `docs/openapi.ts` merges them and **throws** when two domains claim the same schema name
   or path+method, so a shared schema (`Person`, `PermittedUrl`) belongs in `sharedSchemas` of `docs/common.ts`.
   `tests/docs/openapi.test.ts` checks every `$ref` and that the operations documented are the ones wired.

## Ids, validation, errors

- Express 5 leaves `req.body` undefined when a request carries no body; `defaultBody`
  (`middleware/body.middleware.ts`) defaults it to `{}`, so a missing body is a 400, not a 500.
- Ids are bigint. Parse every id with `parseId` (`lib/utils.ts`) before querying. A path id that
  does not parse is a **404** (the row cannot exist), a bad id in a body is a **400**.
- Request bodies are camelCase, response fields snake_case, every response carries `success`;
  errors are `{ success: false, message }`.
- Something that exists but belongs to someone else answers **404**, never 403, so its existence is
  not leaked. 403 is only for the wrong role, which `requireRole` already handles.
- Supabase errors: unique violation (`error.code === '23505'`) maps to 409, anything unexpected is
  rethrown as `new Error(error.message)`. Never trust a role or an id coming from the body.

## Soft delete

Tables with `deleted_at`/`reason` are soft deleted: `users`, `modules`, `exams`, `events`,
`questions`, `question_options`, `assignments`, `cheatings` and the four monitoring media tables.
Read them through `activeOnly(query)` (adds `.is('deleted_at', null)`) and delete with
`.update(softDelete(reason))`. Join tables have no `deleted_at` and are deleted for real.

## Roles and ownership

- Roles are `student | professor | examiner` (`Role` in `lib/types.ts`), taken from the JWT
  (`req.user`), and stored one row per role in `professors` / `examiners` / `students`.
- `requireRole(...roles)` is variadic: `requireRole('professor', 'examiner')`.
- Ownership is a join, checked in the service before anything is returned or changed:
  professor of a module → `module_professor`, examiner of an exam → `exam_examiner`,
  student of an exam → `exam_student`, owner of an attempt → `student_assignment`.
- **Who gets at an exam is decided in `lib/exam-access.ts` only**, by the exams, attempts,
  monitoring and cheatings services alike: a professor manages the exams they created
  (`exams.created_by`) **plus** the exams linked to a module they teach, an examiner is assigned
  through `exam_examiner`, a student through `exam_student`. `findVisibleExam(examId, user, columns)`
  answers `null` when the caller may not see the live exam, a 404 for whatever hangs off it.
- An attempt is over at `min(started_at + session_duration, exams.scheduled_end)` (`deadline`,
  `lib/deadline.ts`). Only the attempts domain auto submits a late attempt; the others ask
  `attemptExpired(attempt)` and answer 409 on a student side write past it. Staff writes are not.
- `assignments.status` `flagged` is staff business: the attempts service answers a student with the
  status the attempt would have without the flag (`in_progress`, `submitted`, `auto_submitted`).
- One attempt per student per exam is enforced by the database (`student_assignment` unique
  `(student_id, exam_id)` plus a composite FK), so a second attempt surfaces as a 23505 → 409.

## Migrations

New numbered, idempotent file in `migrations/` (`005_...sql`), applied in name order by
`npm run migrate`. Never edit an applied migration. Keep RLS enabled on every new table, index every
FK used for lookups, and keep check constraints in sync with the validation in the service.

Writes that have to succeed together are one database function, not a chain of PostgREST calls.
`start_attempt` (`008_start_attempt.sql`) is the one there is: one transaction writing the
`assignments` row, the `student_assignment` link, one `question_assignment` per live exam question
(shuffled when `exams.shuffle_questions`, `exam_question.position` order otherwise) and the copy of
the permitted urls. The service keeps the cheap checks and the session duration, passes them in as
`param_*` arguments, and maps the `23505` the student link raises to the same 409 as before.

## Tests

`tests/features/<domain>/<name>.test.ts`, `tests/lib|middleware|docs/` for what crosses domains, run
with `npm test` (vitest, `legacy/` excluded); `npm run typecheck`
(`tsc --noEmit`, strict, `tsconfig.json`) covers the same files and has to stay clean. Everything that
does not need a database gets a test. `lib/db.ts` throws without env vars, so mock it with a fake:

```ts
const { from, maybeSingle } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ eq, maybeSingle, is: eq }));
  const from = vi.fn(() => ({ select: () => ({ eq, maybeSingle }) }));
  return { from, maybeSingle };
});

vi.mock('../../../lib/db.js', () => ({ database: { from } }));
```

Then set the result per case (`maybeSingle.mockResolvedValue({ data: null, error: null })`) and
assert on the calls (`expect(from).toHaveBeenCalledWith('exams')`). A service that calls a database
function mocks `database.rpc` next to `from`, as `tests/features/attempts/attempt.service.test.ts` does.

`e2e/smoke.ts` (`npm run e2e`) is not part of `npm test`: it starts the real server on port 8011 and drives it over HTTP
against the Supabase project in `.env`. It seeds its own users with the service client (no endpoint that sends mail),
tracks what it creates and deletes it again in a `finally`, then counts the rows of every public table through
`DATABASE_DIRECT_URL` (`psql` has to be installed). Only run it against a sandbox project.
