-- Starting an attempt in one transaction. PostgREST cannot span the four writes the attempts
-- service used to make on its own, so a failure after the assignments row left a broken attempt
-- behind. The service keeps the cheap checks (schedule, status, enrolment, one attempt per student)
-- and the session_duration it computes from the questions, and passes the results in.
-- Idempotent: safe to run again.

begin;

create or replace function public.start_attempt(
  param_student_id bigint,
  param_exam_id bigint,
  param_session_duration int,
  param_started_at timestamptz
)
returns json language plpgsql as $$
declare
  new_attempt public.assignments;
begin
  insert into public.assignments (exam_id, session_duration, session_duration_unit, started_at, status)
  values (param_exam_id, param_session_duration, 'seconds', param_started_at, 'in_progress')
  returning * into new_attempt;

  -- student_assignment is unique on (student_id, exam_id): a second start raises 23505 here and
  -- takes the whole call with it, which the service maps to 409
  insert into public.student_assignment (student_id, assignment_id, exam_id)
  values (param_student_id, new_attempt.id, param_exam_id);

  -- exam_question order unless the exam shuffles, and then the order is fixed for the whole attempt;
  -- a question its owner soft deleted is no longer part of the exam
  insert into public.question_assignment (assignment_id, question_id, answer, position)
  select new_attempt.id, ordered.question_id, '', ordered.position
  from (
    select exam_question.question_id,
           row_number() over (
             order by case when exams.shuffle_questions then random() end, exam_question.position
           ) as position
    from public.exam_question
    join public.exams on exams.id = exam_question.exam_id
    join public.questions on questions.id = exam_question.question_id and questions.deleted_at is null
    where exam_question.exam_id = param_exam_id
  ) as ordered;

  insert into public.assignment_permitted_url (assignment_id, permitted_url_id)
  select new_attempt.id, permitted_url_id
  from public.exam_permitted_url
  where exam_id = param_exam_id;

  return to_json(new_attempt);
end
$$;

commit;

notify pgrst, 'reload schema';
