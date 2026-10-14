-- age: optional, set at creation (createStudent) - shown on the class detail page alongside the
-- roster, and averaged per class. Idempotent: safe to run again.

begin;

alter table public.students add column if not exists age smallint;

commit;

notify pgrst, 'reload schema';
