-- AI-assisted grading support: an optional model answer for short_answer/essay questions, and a
-- cached per-attempt AI review (per-question percent match plus an overall AI-authorship
-- suspicion level) so the expensive AI call only runs once unless a professor asks to refresh it.
-- The professor's own grade (assignments/question_assignment) is untouched by any of this - the
-- AI only ever suggests. Idempotent: safe to run again.

begin;

alter table public.questions add column if not exists model_answer text;

do $$ begin
  if to_regtype('public.type_ai_likelihood') is null then
    create type public.type_ai_likelihood as enum ('low', 'medium', 'high');
  end if;
end $$;

create table if not exists public.assignment_ai_review (
  assignment_id bigint primary key references public.assignments(id) on delete cascade,
  cheating_likelihood public.type_ai_likelihood not null,
  cheating_reasoning text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.question_ai_review (
  assignment_id bigint not null references public.assignments(id) on delete cascade,
  question_id bigint not null references public.questions(id) on delete cascade,
  percent_correct smallint not null check (percent_correct between 0 and 100),
  reasoning text not null,
  created_at timestamptz not null default now(),
  primary key (assignment_id, question_id)
);

commit;

notify pgrst, 'reload schema';
