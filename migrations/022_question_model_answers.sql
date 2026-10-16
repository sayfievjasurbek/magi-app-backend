-- A short_answer/essay question could have more than one acceptable correct answer - switch
-- model_answer (one string) to model_answers (an array), so the AI reviewer can compare a
-- student's response against any of them instead of a single fixed answer. Idempotent.

begin;

alter table public.questions add column if not exists model_answers text[];

update public.questions
set model_answers = array[model_answer]
where model_answer is not null and model_answers is null;

alter table public.questions drop column if exists model_answer;

commit;

notify pgrst, 'reload schema';
