-- The admin panel shows this section as "Employees" rather than "Professors" - this is their
-- job title for display (e.g. "Teacher", "IT specialist"), not an auth role. Still a professor
-- account underneath; position is purely descriptive.
-- Idempotent: safe to run again.

begin;

alter table public.professors add column if not exists position text;

commit;

notify pgrst, 'reload schema';
