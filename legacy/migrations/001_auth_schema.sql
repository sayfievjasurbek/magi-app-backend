-- Auth base schema (users, tokens, students, email rate limiting).
-- Idempotent: safe to run on a database that already has these tables.
-- The backend must use the Supabase service_role key (RLS is enabled, no policies).

begin;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name = 'id' and data_type <> 'uuid'
  ) then
    raise exception 'public.users.id is not uuid - foreign key types in these migrations assume uuid';
  end if;
end $$;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text,
  email text not null unique,
  password text not null,
  is_verified boolean not null default false,
  active_status text not null default 'pending',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tokens (
  id bigint generated always as identity primary key,
  token text not null,
  token_type text not null,
  revoked boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tokens_token_type_idx on public.tokens (token, token_type);

create table if not exists public.users_tokens (
  user_id uuid not null references public.users(id) on delete cascade,
  token_id bigint not null references public.tokens(id) on delete cascade,
  primary key (user_id, token_id)
);

create table if not exists public.students (
  user_id uuid primary key references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.email_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  email_type text not null,
  email text not null,
  sent_at timestamptz not null default now()
);
create index if not exists email_logs_user_type_idx on public.email_logs (user_id, email_type, sent_at desc);

-- Returns true and records the send if allowed: max 1 per 60s and 5 per hour per user+type.
-- Not replaced if a can_send_email already exists.
do $$
begin
  if to_regprocedure('public.can_send_email(uuid,text,text)') is null then
    execute $fn$
      create function public.can_send_email(param_user_id uuid, param_email_type text, param_email text)
      returns boolean language plpgsql as $body$
      begin
        if exists (
          select 1 from public.email_logs
          where user_id = param_user_id and email_type = param_email_type
            and sent_at > now() - interval '60 seconds'
        ) then
          return false;
        end if;

        if (
          select count(*) from public.email_logs
          where user_id = param_user_id and email_type = param_email_type
            and sent_at > now() - interval '1 hour'
        ) >= 5 then
          return false;
        end if;

        insert into public.email_logs (user_id, email_type, email)
        values (param_user_id, param_email_type, param_email);
        return true;
      end
      $body$
    $fn$;
  end if;
end $$;

alter table public.users enable row level security;
alter table public.tokens enable row level security;
alter table public.users_tokens enable row level security;
alter table public.students enable row level security;
alter table public.email_logs enable row level security;

commit;
