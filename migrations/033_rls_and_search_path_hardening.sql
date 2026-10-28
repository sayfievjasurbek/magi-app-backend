-- Security Advisor flagged a few tables added after 003_exam_schema.sql's own RLS sweep
-- (notifications: 016_notifications.sql, the two ai_review tables: 021_ai_review.sql), and four
-- functions with a mutable search_path. Same reasoning as 003: the backend connects with the
-- service_role key, so RLS without policies simply closes the public API; none of these functions
-- are security definer, so pinning search_path is routine hardening, not a live exploit fix.
-- Idempotent: safe to run again.

begin;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'notifications', 'assignment_ai_review', 'question_ai_review',
    -- not created by any migration in this repo - orphaned leftovers from the deleted Chrome
    -- extension's own auth system (magi_extension); unused by this stack, kept rather than
    -- dropped in case they still hold real data, just closed off like everything else
    'magi_ext_users', 'magi_ext_refresh_tokens', 'magi_ext_sessions'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create or replace function public.get_user_role(param_user_id bigint)
returns text language sql stable
set search_path = public
as $$
  select case
    when exists (select 1 from public.professors where user_id = param_user_id) then 'professor'
    when exists (select 1 from public.examiners where user_id = param_user_id) then 'examiner'
    when exists (select 1 from public.students where user_id = param_user_id) then 'student'
  end;
$$;

create or replace function public.can_send_email(param_user_id bigint, param_email_type text, param_email text)
returns boolean language plpgsql
set search_path = public
as $$
declare
  email_rule public.email_rules%rowtype;
  cooldown interval;
begin
  select * into email_rule from public.email_rules where email_usage_case::text = param_email_type;

  -- an unknown email type has no limit to enforce, so refuse rather than send unmetered mail
  if not found then return false; end if;

  cooldown := email_rule.cooldown_duration * case email_rule.cooldown_unit
    when 'seconds' then interval '1 second'
    when 'minutes' then interval '1 minute'
    when 'hours' then interval '1 hour'
    when 'days' then interval '1 day'
  end;

  if exists (
    select 1 from public.email_usage
    where user_id = param_user_id and email_usage_case = email_rule.id
      and last_sent > now() - cooldown
  ) then
    return false;
  end if;

  if (
    select count(*) from public.email_logs
    where user_id = param_user_id and email_usage_case = email_rule.id
      and sent_at > now() - interval '24 hours'
  ) >= email_rule.max_per_day then
    return false;
  end if;

  insert into public.email_usage (user_id, email_usage_case, last_sent)
  values (param_user_id, email_rule.id, now())
  on conflict (user_id, email_usage_case) do update set last_sent = excluded.last_sent;

  insert into public.email_logs (user_id, email_usage_case)
  values (param_user_id, email_rule.id);

  return true;
end
$$;

create or replace function public.start_attempt(
  param_student_id bigint,
  param_exam_id bigint,
  param_session_duration int,
  param_started_at timestamptz
)
returns json language plpgsql
set search_path = public
as $$
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
