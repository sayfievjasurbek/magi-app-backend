-- When a student joined a group - lets the admin panel's group roster sort/filter by enrollment
-- date (today / last few days / last few weeks / all). Existing rows backfill to the time this
-- migration runs, since the real join date was never recorded before. Idempotent.

begin;

alter table public.module_student add column if not exists created_at timestamptz not null default now();

commit;

notify pgrst, 'reload schema';
