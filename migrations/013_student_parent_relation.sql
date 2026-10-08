-- Who the parent_phone number actually belongs to (mother, father, older sibling, etc.) - the
-- number itself can belong to whichever relative actually has a working phone.
-- Idempotent: safe to run again.

begin;

alter table public.students add column if not exists parent_relation text;

commit;

notify pgrst, 'reload schema';
