-- Permitted urls could only be granted per exam. This adds the same grant at module ("group" in
-- the admin panel) and individual-student level, plus an app-whitelist mirroring permitted_urls
-- for both. What's actually in effect for an attempt is still frozen at start - start_attempt()
-- now merges exam + the student's own grants + grants from whichever of the student's modules
-- the exam is actually linked to, instead of reading only exam_permitted_url.
-- Idempotent: safe to run again.

begin;

create table if not exists public.permitted_apps (
  id bigint generated always as identity primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.module_permitted_url (
  module_id bigint not null references public.modules(id) on delete cascade,
  permitted_url_id bigint not null references public.permitted_urls(id) on delete cascade,
  primary key (module_id, permitted_url_id)
);
create index if not exists module_permitted_url_url_idx on public.module_permitted_url (permitted_url_id);

create table if not exists public.module_permitted_app (
  module_id bigint not null references public.modules(id) on delete cascade,
  permitted_app_id bigint not null references public.permitted_apps(id) on delete cascade,
  primary key (module_id, permitted_app_id)
);
create index if not exists module_permitted_app_app_idx on public.module_permitted_app (permitted_app_id);

create table if not exists public.student_permitted_url (
  student_id bigint not null references public.students(user_id) on delete cascade,
  permitted_url_id bigint not null references public.permitted_urls(id) on delete cascade,
  primary key (student_id, permitted_url_id)
);
create index if not exists student_permitted_url_url_idx on public.student_permitted_url (permitted_url_id);

create table if not exists public.student_permitted_app (
  student_id bigint not null references public.students(user_id) on delete cascade,
  permitted_app_id bigint not null references public.permitted_apps(id) on delete cascade,
  primary key (student_id, permitted_app_id)
);
create index if not exists student_permitted_app_app_idx on public.student_permitted_app (permitted_app_id);

create table if not exists public.exam_permitted_app (
  exam_id bigint not null references public.exams(id) on delete cascade,
  permitted_app_id bigint not null references public.permitted_apps(id) on delete cascade,
  primary key (exam_id, permitted_app_id)
);
create index if not exists exam_permitted_app_app_idx on public.exam_permitted_app (permitted_app_id);

create table if not exists public.assignment_permitted_app (
  assignment_id bigint not null references public.assignments(id) on delete cascade,
  permitted_app_id bigint not null references public.permitted_apps(id) on delete cascade,
  primary key (assignment_id, permitted_app_id)
);
create index if not exists assignment_permitted_app_app_idx on public.assignment_permitted_app (permitted_app_id);

-- same reasoning as 003/033: the backend connects with the service_role key, so RLS without
-- policies simply closes the public API
alter table public.permitted_apps enable row level security;
alter table public.module_permitted_url enable row level security;
alter table public.module_permitted_app enable row level security;
alter table public.student_permitted_url enable row level security;
alter table public.student_permitted_app enable row level security;
alter table public.exam_permitted_app enable row level security;
alter table public.assignment_permitted_app enable row level security;

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

  -- frozen for this attempt: the exam's own grants, the student's individual grants, and the
  -- grants of whichever of the student's modules this exam is actually linked to - not every
  -- module the student happens to be in
  insert into public.assignment_permitted_url (assignment_id, permitted_url_id)
  select distinct new_attempt.id, permitted_url_id from (
    select permitted_url_id from public.exam_permitted_url where exam_id = param_exam_id
    union
    select permitted_url_id from public.student_permitted_url where student_id = param_student_id
    union
    select permitted_url_id from public.module_permitted_url
    where module_id in (
      select module_id from public.module_student where student_id = param_student_id
      intersect
      select module_id from public.exam_module where exam_id = param_exam_id
    )
  ) as merged_urls;

  insert into public.assignment_permitted_app (assignment_id, permitted_app_id)
  select distinct new_attempt.id, permitted_app_id from (
    select permitted_app_id from public.exam_permitted_app where exam_id = param_exam_id
    union
    select permitted_app_id from public.student_permitted_app where student_id = param_student_id
    union
    select permitted_app_id from public.module_permitted_app
    where module_id in (
      select module_id from public.module_student where student_id = param_student_id
      intersect
      select module_id from public.exam_module where exam_id = param_exam_id
    )
  ) as merged_apps;

  return to_json(new_attempt);
end
$$;

commit;

notify pgrst, 'reload schema';
