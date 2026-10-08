-- student_code: a random, unique 5-digit identifier for admin-created students (shown on
-- proctoring photos, meant to double as a login identifier later) - separate from the users.id
-- primary key, which stays a plain auto-increment and isn't meant to be shown to anyone.
-- recovery_secret: an encrypted copy of the current password for accounts a professor created
-- directly (self-signup accounts never get one), so the professor can look it up if the student
-- forgets it - see lib/recovery.ts.
-- Idempotent: safe to run again.

begin;

alter table public.students add column if not exists student_code text unique;
alter table public.students add column if not exists recovery_secret text;

commit;

notify pgrst, 'reload schema';
