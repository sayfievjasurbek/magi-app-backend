-- Persists the Magi AI chat so it survives closing the panel or reloading the page - one row per
-- message, scoped to the professor who sent/received it.

begin;

create table if not exists public.ai_chat_messages (
  id bigint generated always as identity primary key,
  professor_id bigint not null references public.professors(user_id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  actions jsonb,
  file_name text,
  created_at timestamptz not null default now()
);
create index if not exists ai_chat_messages_professor_created_idx on public.ai_chat_messages (professor_id, created_at);
alter table public.ai_chat_messages enable row level security;

commit;

notify pgrst, 'reload schema';
