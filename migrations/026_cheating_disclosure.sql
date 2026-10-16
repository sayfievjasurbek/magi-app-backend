-- A professor-controlled flag: a student never sees cheating incidents by default (flagged is
-- staff business), but a professor who fails an attempt for cheating can choose to show that
-- student exactly what was recorded against them. Idempotent.

begin;

alter table public.assignments add column if not exists cheating_disclosed boolean not null default false;

commit;

notify pgrst, 'reload schema';
