-- Exams are rare (monthly/yearly); professors also need frequent, lighter homework assignments.
-- Rather than a separate system, homework is the same exam machinery (questions, scheduling,
-- grading, desktop-app submission with the same proctoring) with a `kind` to tell them apart.
-- Idempotent: safe to run again.

begin;

do $$ begin
  if to_regtype('public.type_exam_kind') is null then
    create type public.type_exam_kind as enum ('exam', 'homework');
  end if;
end $$;

alter table public.exams add column if not exists kind public.type_exam_kind not null default 'exam';

commit;

notify pgrst, 'reload schema';
