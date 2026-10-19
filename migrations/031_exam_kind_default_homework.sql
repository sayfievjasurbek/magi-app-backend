-- Homework is created far more often than a timed exam here, so that's the default now, not
-- 'exam' (matches createExam's own default - see exam.service.ts). Only changes the default for
-- future inserts that omit kind; existing rows are untouched. Idempotent.

begin;

alter table public.exams alter column kind set default 'homework';

commit;

notify pgrst, 'reload schema';
