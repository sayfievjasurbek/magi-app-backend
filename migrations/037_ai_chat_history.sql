-- Persists the Magi AI chat as separate conversations, same shape as ChatGPT/Claude.ai - a
-- sidebar of past conversations a professor can switch between, each its own list of messages.

begin;

create table if not exists public.ai_chat_conversations (
  id bigint generated always as identity primary key,
  professor_id bigint not null references public.professors(user_id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  -- bumped on every new message so the sidebar can sort "most recently active" first
  updated_at timestamptz not null default now()
);
create index if not exists ai_chat_conversations_professor_updated_idx on public.ai_chat_conversations (professor_id, updated_at desc);
alter table public.ai_chat_conversations enable row level security;

create table if not exists public.ai_chat_messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references public.ai_chat_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  actions jsonb,
  file_name text,
  created_at timestamptz not null default now()
);
create index if not exists ai_chat_messages_conversation_created_idx on public.ai_chat_messages (conversation_id, created_at);
alter table public.ai_chat_messages enable row level security;

commit;

notify pgrst, 'reload schema';
