-- A per-class, per-day attendance record: whether each enrolled student was present. Separate
-- from exams/homework entirely - a professor marks it directly on the class roster.

begin;

create table if not exists public.attendance (
  id bigint generated always as identity primary key,
  module_id bigint not null references public.modules(id) on delete cascade,
  student_id bigint not null references public.students(user_id) on delete cascade,
  date date not null,
  present boolean not null,
  recorded_by bigint not null references public.professors(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module_id, student_id, date)
);
create index if not exists attendance_module_date_idx on public.attendance (module_id, date);
alter table public.attendance enable row level security;

commit;

notify pgrst, 'reload schema';
