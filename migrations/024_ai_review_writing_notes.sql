-- The AI review now also comments on spelling and the overall level the answer is written at,
-- alongside the existing correctness percentage. Idempotent.

begin;

alter table public.question_ai_review add column if not exists writing_notes text;

commit;

notify pgrst, 'reload schema';
