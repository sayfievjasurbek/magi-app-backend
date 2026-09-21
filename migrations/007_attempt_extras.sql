-- Columns the attempts domain needs on top of 003_exam_schema.sql. Idempotent.
--   * question_assignment.position: the question order of one attempt, shuffled per attempt when
--     exams.shuffle_questions is true, so a resumed session keeps showing the same order
--   * question_assignment.marks_awarded: marks of that answer (auto graded at submit, or set by a professor)
--   * assignments.feedback: the professor's note written while grading

begin;

alter table public.question_assignment add column if not exists position int not null default 0;
alter table public.question_assignment add column if not exists marks_awarded int not null default 0;

create index if not exists question_assignment_assignment_position_idx
  on public.question_assignment (assignment_id, position);

alter table public.assignments add column if not exists feedback text;

commit;

notify pgrst, 'reload schema';
