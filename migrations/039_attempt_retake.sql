-- Lets a professor reopen a finished attempt for resubmission (PUT /assignments/{id}/allow-retake).
-- A retake attempt has no time limit: lib/deadline.ts's deadline() ignores session_duration and
-- the exam's own scheduled_end for any attempt with unlimited_time set.

begin;

alter table public.assignments add column if not exists unlimited_time boolean not null default false;

commit;

notify pgrst, 'reload schema';
