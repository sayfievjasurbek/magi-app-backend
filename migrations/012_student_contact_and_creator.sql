-- created_by: which professor made this account directly (createStudent), so the professor can
-- see it in their own student list right away, before it's linked to any module.
-- phone / parent_phone: optional contact numbers, not required (email is also optional on its
-- own merit now, but the login itself is always generated - see auth.controller.ts).
-- Idempotent: safe to run again.

begin;

alter table public.students add column if not exists created_by bigint references public.users(id);
alter table public.students add column if not exists phone text;
alter table public.students add column if not exists parent_phone text;

commit;

notify pgrst, 'reload schema';
