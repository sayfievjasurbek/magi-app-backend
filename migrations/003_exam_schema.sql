-- Exam proctoring schema, from docs/database.dbml (replaces the academic schema, now in legacy/migrations).
-- Idempotent: safe to run again. The backend uses the Supabase service_role key (RLS is enabled, no policies).
-- Deliberate deviations from the DBML:
--   * every timestamp is timestamptz (the DBML uses plain timestamp in the four monitoring tables)
--   * extra table exam_question: which questions an exam asks, in which order, for how many marks
--   * one attempt per student per exam: student_assignment carries exam_id, checked by a composite FK
--   * one updated_at trigger function on every table that has updated_at

begin;

-- the previous design used uuid ids; it has to be dropped by hand before this runs
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name = 'id' and data_type <> 'bigint'
  ) then
    raise exception 'public.users.id is not bigint: drop the old uuid tables (legacy/migrations) before applying this migration';
  end if;
end $$;

-- ========== ENUMS ==========

do $$
begin
  if to_regtype('public.type_question_type') is null then
    create type public.type_question_type as enum ('multiple_choice', 'true_false', 'short_answer', 'essay');
  end if;
  if to_regtype('public.type_time_unit') is null then
    create type public.type_time_unit as enum ('seconds', 'minutes', 'hours', 'days');
  end if;
  if to_regtype('public.type_user_active_status') is null then
    create type public.type_user_active_status as enum ('pending', 'active', 'suspended', 'banned', 'deleted', 'inactive');
  end if;
  if to_regtype('public.type_assignment_status') is null then
    create type public.type_assignment_status as enum ('pending', 'in_progress', 'submitted', 'auto_submitted', 'graded', 'flagged');
  end if;
  if to_regtype('public.type_email_usage_case') is null then
    create type public.type_email_usage_case as enum ('reset_password_account_email', 'update_password_account_email', 'verify_account_email', 'welcome_user_email');
  end if;
  if to_regtype('public.type_cheating_types') is null then
    create type public.type_cheating_types as enum ('tab_switch_limit', 'copy_paste', 'devtools', 'multiple_monitors', 'face_mismatch', 'screen_share', 'unauthorized_app', 'manual_review');
  end if;
  if to_regtype('public.type_exam_event') is null then
    create type public.type_exam_event as enum ('browser_version', 'active_app', 'menu_bar_icon', 'open_window', 'monitor_count', 'monitor_hotplug', 'chrome_extension', 'tab_switch', 'app_switch', 'screen_mirror', 'devtools_opened', 'copy_paste', 'url_access');
  end if;
  if to_regtype('public.type_exam_status') is null then
    create type public.type_exam_status as enum ('demo', 'scheduled', 'ongoing', 'completed', 'delayed', 'cancelled');
  end if;
  if to_regtype('public.type_token_type') is null then
    create type public.type_token_type as enum ('verify_account_email', 'update_account_password', 'cookie_token_login');
  end if;
end $$;

-- ========== USERS & ROLES ==========

create table if not exists public.users (
  id bigint generated always as identity primary key,
  first_name varchar(100) not null,
  last_name varchar(100),
  email text not null unique,
  password text not null,
  is_verified boolean not null default false,
  active_status public.type_user_active_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  reason text
);

create table if not exists public.professors (
  user_id bigint primary key references public.users(id) on delete cascade
);

create table if not exists public.students (
  user_id bigint primary key references public.users(id) on delete cascade
);

create table if not exists public.examiners (
  user_id bigint primary key references public.users(id) on delete cascade
);

-- ========== MODULES ==========

create table if not exists public.modules (
  id bigint generated always as identity primary key,
  name varchar(100) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  reason text
);

create table if not exists public.module_student (
  module_id bigint not null references public.modules(id) on delete cascade,
  student_id bigint not null references public.students(user_id) on delete cascade,
  primary key (module_id, student_id)
);
create index if not exists module_student_student_idx on public.module_student (student_id);

create table if not exists public.module_professor (
  module_id bigint not null references public.modules(id) on delete cascade,
  professor_id bigint not null references public.professors(user_id) on delete cascade,
  primary key (module_id, professor_id)
);
create index if not exists module_professor_professor_idx on public.module_professor (professor_id);

-- ========== EXAMS ==========

create table if not exists public.exams (
  id bigint generated always as identity primary key,
  name varchar(100) not null,
  shuffle_questions boolean not null default true,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  status public.type_exam_status not null default 'scheduled',
  max_marks int not null default 100,
  passing_marks int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  reason text
);

create table if not exists public.exam_examiner (
  exam_id bigint not null references public.exams(id) on delete cascade,
  examiner_id bigint not null references public.examiners(user_id) on delete cascade,
  primary key (exam_id, examiner_id)
);
create index if not exists exam_examiner_examiner_idx on public.exam_examiner (examiner_id);

create table if not exists public.exam_module (
  exam_id bigint not null references public.exams(id) on delete cascade,
  module_id bigint not null references public.modules(id) on delete cascade,
  primary key (exam_id, module_id)
);
create index if not exists exam_module_module_idx on public.exam_module (module_id);

create table if not exists public.exam_student (
  exam_id bigint not null references public.exams(id) on delete cascade,
  student_id bigint not null references public.students(user_id) on delete cascade,
  primary key (exam_id, student_id)
);
create index if not exists exam_student_student_idx on public.exam_student (student_id);

-- ========== EVENTS ==========

create table if not exists public.events (
  id bigint generated always as identity primary key,
  name public.type_exam_event not null,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  reason text
);

create table if not exists public.exam_events (
  exam_id bigint not null references public.exams(id) on delete cascade,
  event_id bigint not null references public.events(id) on delete cascade,
  primary key (exam_id, event_id)
);
create index if not exists exam_events_event_idx on public.exam_events (event_id);

-- ========== QUESTIONS ==========

create table if not exists public.questions (
  id bigint generated always as identity primary key,
  title varchar(100) not null,
  question_type public.type_question_type not null default 'multiple_choice',
  question text not null default '',
  expected_duration int not null default 0,
  expected_duration_unit public.type_time_unit not null default 'seconds',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  reason text
);

create table if not exists public.question_options (
  id bigint generated always as identity primary key,
  question_id bigint not null references public.questions(id) on delete cascade,
  option_text text not null,
  is_correct boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  reason text
);
create index if not exists question_options_question_idx on public.question_options (question_id);

-- not in the DBML: the questions an exam asks, their order and their marks
create table if not exists public.exam_question (
  exam_id bigint not null references public.exams(id) on delete cascade,
  question_id bigint not null references public.questions(id) on delete cascade,
  position int not null default 0,
  marks int not null default 1,
  primary key (exam_id, question_id),
  -- deferrable so a whole reordering can be written in one transaction
  constraint exam_question_position_key unique (exam_id, position) deferrable initially immediate
);
create index if not exists exam_question_question_idx on public.exam_question (question_id);

-- ========== ASSIGNMENTS (a student's exam attempt) ==========

create table if not exists public.assignments (
  id bigint generated always as identity primary key,
  exam_id bigint not null references public.exams(id) on delete cascade,
  session_duration int not null default 0,
  session_duration_unit public.type_time_unit not null default 'seconds',
  started_at timestamptz,
  submitted_at timestamptz,
  auto_submitted boolean not null default false,
  status public.type_assignment_status not null default 'pending',
  score int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  reason text,
  -- target of the composite FK in student_assignment
  constraint assignments_id_exam_key unique (id, exam_id)
);
create index if not exists assignments_exam_idx on public.assignments (exam_id);

create table if not exists public.question_assignment (
  assignment_id bigint not null references public.assignments(id) on delete cascade,
  question_id bigint not null references public.questions(id) on delete cascade,
  answer text not null,
  typing_duration int not null default 0,
  typing_duration_unit public.type_time_unit not null default 'seconds',
  text_typed int not null default 0,
  text_edited int not null default 0,
  text_pasted int not null default 0,
  last_synced_at timestamptz,
  started_at timestamptz,
  answered_at timestamptz,
  primary key (assignment_id, question_id)
);
create index if not exists question_assignment_question_idx on public.question_assignment (question_id);

create table if not exists public.question_assignment_option (
  assignment_id bigint not null references public.assignments(id) on delete cascade,
  question_id bigint not null references public.questions(id) on delete cascade,
  option_id bigint not null references public.question_options(id) on delete cascade,
  primary key (assignment_id, question_id, option_id)
);
create index if not exists question_assignment_option_question_idx on public.question_assignment_option (question_id);
create index if not exists question_assignment_option_option_idx on public.question_assignment_option (option_id);

-- exam_id is not in the DBML: with the composite FK below plus unique (student_id, exam_id)
-- it makes a second attempt of the same student at the same exam impossible
create table if not exists public.student_assignment (
  student_id bigint not null references public.students(user_id) on delete cascade,
  assignment_id bigint not null,
  exam_id bigint not null,
  primary key (student_id, assignment_id),
  constraint student_assignment_assignment_fkey foreign key (assignment_id, exam_id)
    references public.assignments(id, exam_id) on update cascade on delete cascade,
  constraint student_assignment_student_exam_key unique (student_id, exam_id)
);
create index if not exists student_assignment_assignment_idx on public.student_assignment (assignment_id);

-- ========== PERMITTED URLs ==========

create table if not exists public.permitted_urls (
  id bigint generated always as identity primary key,
  url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.exam_permitted_url (
  exam_id bigint not null references public.exams(id) on delete cascade,
  permitted_url_id bigint not null references public.permitted_urls(id) on delete cascade,
  primary key (exam_id, permitted_url_id)
);
create index if not exists exam_permitted_url_url_idx on public.exam_permitted_url (permitted_url_id);

create table if not exists public.assignment_permitted_url (
  assignment_id bigint not null references public.assignments(id) on delete cascade,
  permitted_url_id bigint not null references public.permitted_urls(id) on delete cascade,
  primary key (assignment_id, permitted_url_id)
);
create index if not exists assignment_permitted_url_url_idx on public.assignment_permitted_url (permitted_url_id);

-- ========== MONITORING ==========

create table if not exists public.panoramic_view (
  id bigint generated always as identity primary key,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  reason text
);

create table if not exists public.assignment_panoramic_view (
  assignment_id bigint not null references public.assignments(id) on delete cascade,
  panoramic_view_id bigint not null references public.panoramic_view(id) on delete cascade,
  primary key (assignment_id, panoramic_view_id)
);
create index if not exists assignment_panoramic_view_media_idx on public.assignment_panoramic_view (panoramic_view_id);

create table if not exists public.video_recordings (
  id bigint generated always as identity primary key,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  reason text
);

create table if not exists public.assignment_video_recording (
  assignment_id bigint not null references public.assignments(id) on delete cascade,
  video_recording_id bigint not null references public.video_recordings(id) on delete cascade,
  primary key (assignment_id, video_recording_id)
);
create index if not exists assignment_video_recording_media_idx on public.assignment_video_recording (video_recording_id);

create table if not exists public.face_snapshots (
  id bigint generated always as identity primary key,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  reason text
);

create table if not exists public.assignment_face_snapshot (
  assignment_id bigint not null references public.assignments(id) on delete cascade,
  face_snapshot_id bigint not null references public.face_snapshots(id) on delete cascade,
  primary key (assignment_id, face_snapshot_id)
);
create index if not exists assignment_face_snapshot_media_idx on public.assignment_face_snapshot (face_snapshot_id);

create table if not exists public.snapshots (
  id bigint generated always as identity primary key,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  reason text
);

create table if not exists public.assignment_snapshot (
  assignment_id bigint not null references public.assignments(id) on delete cascade,
  snapshot_id bigint not null references public.snapshots(id) on delete cascade,
  primary key (assignment_id, snapshot_id)
);
create index if not exists assignment_snapshot_media_idx on public.assignment_snapshot (snapshot_id);

-- ========== CHEATING ==========

create table if not exists public.cheatings (
  id bigint generated always as identity primary key,
  name public.type_cheating_types not null,
  explanation text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  reason text
);

create table if not exists public.cheating_reason (
  assignment_id bigint not null references public.assignments(id) on delete cascade,
  cheating_id bigint not null references public.cheatings(id) on delete cascade,
  primary key (assignment_id, cheating_id)
);
create index if not exists cheating_reason_cheating_idx on public.cheating_reason (cheating_id);

-- ========== EMAIL SYSTEM ==========

create table if not exists public.email_rules (
  id bigint generated always as identity primary key,
  email_usage_case public.type_email_usage_case not null unique,
  max_per_day int not null default 3,
  cooldown_duration int not null default 60,
  cooldown_unit public.type_time_unit not null default 'minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_usage (
  user_id bigint not null references public.users(id) on delete cascade,
  email_usage_case bigint not null references public.email_rules(id) on delete cascade,
  last_sent timestamptz not null default now(),
  primary key (user_id, email_usage_case)
);
create index if not exists email_usage_rule_idx on public.email_usage (email_usage_case);

create table if not exists public.email_logs (
  user_id bigint not null references public.users(id) on delete cascade,
  email_usage_case bigint not null references public.email_rules(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (user_id, email_usage_case, sent_at)
);
create index if not exists email_logs_rule_sent_idx on public.email_logs (email_usage_case, sent_at desc);

-- ========== TOKENS ==========

create table if not exists public.tokens (
  id bigint generated always as identity primary key,
  token text not null,
  token_type public.type_token_type not null,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tokens_token_type_idx on public.tokens (token, token_type);

create table if not exists public.users_tokens (
  user_id bigint not null references public.users(id) on delete cascade,
  token_id bigint not null references public.tokens(id) on delete cascade,
  primary key (user_id, token_id)
);
create index if not exists users_tokens_token_idx on public.users_tokens (token_id);

-- ========== updated_at & RLS ==========

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users', 'modules', 'exams', 'events', 'questions', 'question_options', 'assignments',
    'panoramic_view', 'video_recordings', 'face_snapshots', 'snapshots', 'cheatings', 'email_rules', 'tokens'
  ] loop
    execute format(
      'create or replace trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;

  -- the backend connects with the service_role key, so RLS without policies simply closes the public API
  foreach table_name in array array[
    'users', 'professors', 'students', 'examiners',
    'modules', 'module_student', 'module_professor',
    'exams', 'exam_examiner', 'exam_module', 'exam_student',
    'events', 'exam_events',
    'questions', 'question_options', 'exam_question',
    'assignments', 'question_assignment', 'question_assignment_option', 'student_assignment',
    'permitted_urls', 'exam_permitted_url', 'assignment_permitted_url',
    'panoramic_view', 'assignment_panoramic_view', 'video_recordings', 'assignment_video_recording',
    'face_snapshots', 'assignment_face_snapshot', 'snapshots', 'assignment_snapshot',
    'cheatings', 'cheating_reason',
    'email_rules', 'email_usage', 'email_logs',
    'tokens', 'users_tokens'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
