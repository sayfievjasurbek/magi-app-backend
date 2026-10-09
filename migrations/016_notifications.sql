-- In-app notifications for things sent to a user from the professor/admin side: assigned an
-- exam, enrolled in a module, an attempt graded. Best-effort writes (see lib/notifications.ts) -
-- a failure here never blocks the action that triggered it.
-- Idempotent: safe to run again.

begin;

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  related_id bigint,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

commit;

notify pgrst, 'reload schema';
