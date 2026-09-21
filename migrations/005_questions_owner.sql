-- Owner of a question: the professor who created it (not in the DBML).
-- Idempotent: safe to run again.

begin;

alter table public.questions add column if not exists created_by bigint references public.users(id);
create index if not exists questions_created_by_idx on public.questions (created_by);

commit;

notify pgrst, 'reload schema';
