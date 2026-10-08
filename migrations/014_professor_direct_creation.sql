-- Mirrors migrations 011/012 for students: lets a professor create another professor account
-- directly, with the same generated-login / recoverable-password pattern. No parent_phone here -
-- that was specific to students.
-- Idempotent: safe to run again.

begin;

alter table public.professors add column if not exists professor_code text unique;
alter table public.professors add column if not exists recovery_secret text;
alter table public.professors add column if not exists created_by bigint references public.users(id);
alter table public.professors add column if not exists phone text;

commit;

notify pgrst, 'reload schema';
