-- Academic schema: professors, classes, enrollments, assignments, submissions (with forensic dossier).
-- Requires 001_auth_schema.sql. Idempotent except get_user_role, which is replaced so that
-- it also recognises professors (professor wins if a user somehow has both roles).

begin;

create table if not exists public.professors (
  user_id uuid primary key references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.get_user_role(param_user_id uuid)
returns text language sql stable as $$
  select case
    when exists (select 1 from public.professors where user_id = param_user_id) then 'professor'
    when exists (select 1 from public.students where user_id = param_user_id) then 'student'
  end;
$$;

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  cycle text,
  credits smallint check (credits is null or credits > 0),
  status text not null default 'draft' check (status in ('draft', 'synced', 'audited', 'pending_update')),
  professor_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (professor_id, code)
);

create table if not exists public.enrollments (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.users(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (class_id, student_id)
);
create index if not exists enrollments_student_idx on public.enrollments (student_id);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  title text not null,
  description text not null,
  monitoring_level smallint not null default 1 check (monitoring_level between 1 and 3),
  allowed_sources text[] not null default '{}',
  due_date timestamptz not null,
  weight numeric(5,2) not null default 0 check (weight between 0 and 100),
  behavioral_audit boolean not null default true,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assignments_class_idx on public.assignments (class_id);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  content_hash text not null,
  receipt_id text not null unique,
  submitted_at timestamptz not null default now(),
  status text not null default 'pending_review' check (status in ('pending_review', 'graded')),
  grade numeric(5,2) check (grade between 0 and 100),
  feedback text,
  graded_at timestamptz,
  graded_by uuid references public.users(id),

  -- forensic dossier (sent by the MAGI desktop app together with the work)
  human_typing_score numeric(5,2) check (human_typing_score between 0 and 100),
  volume_score numeric(5,2) check (volume_score between 0 and 100),
  rhythm_score numeric(5,2) check (rhythm_score between 0 and 100),
  editing_score numeric(5,2) check (editing_score between 0 and 100),
  ai_probability numeric(5,2) check (ai_probability between 0 and 100),
  session_duration_seconds integer check (session_duration_seconds >= 0),
  active_typing_seconds integer check (active_typing_seconds >= 0),
  pausing_seconds integer check (pausing_seconds >= 0),
  editing_seconds integer check (editing_seconds >= 0),
  edit_cycles integer check (edit_cycles >= 0),
  characters_typed integer check (characters_typed >= 0),
  paste_events integer check (paste_events >= 0),
  characters_pasted integer check (characters_pasted >= 0),
  correction_keystrokes integer check (correction_keystrokes >= 0),
  research_log jsonb not null default '[]',
  verdict text,
  integrity_risk text check (integrity_risk in ('low', 'medium', 'high')),

  unique (assignment_id, student_id)
);
create index if not exists submissions_student_idx on public.submissions (student_id);

alter table public.professors enable row level security;
alter table public.classes enable row level security;
alter table public.enrollments enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;

commit;

notify pgrst, 'reload schema';
