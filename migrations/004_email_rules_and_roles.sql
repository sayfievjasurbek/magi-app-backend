-- Email rate limiting rules and the role lookup, on top of 003_exam_schema.sql.
-- Both functions keep the parameter names the backend calls them with (see controllers/auth.controller.ts).

begin;

insert into public.email_rules (email_usage_case)
select unnest(enum_range(null::public.type_email_usage_case))
on conflict (email_usage_case) do nothing;

-- the uuid versions belong to the replaced design and would make the RPC call ambiguous
drop function if exists public.can_send_email(uuid, text, text);
drop function if exists public.get_user_role(uuid);

create or replace function public.get_user_role(param_user_id bigint)
returns text language sql stable as $$
  select case
    when exists (select 1 from public.professors where user_id = param_user_id) then 'professor'
    when exists (select 1 from public.examiners where user_id = param_user_id) then 'examiner'
    when exists (select 1 from public.students where user_id = param_user_id) then 'student'
  end;
$$;

-- Returns true and records the send when the rule for this email type allows it.
-- param_email is only kept for the call signature: email_logs has no email column.
create or replace function public.can_send_email(param_user_id bigint, param_email_type text, param_email text)
returns boolean language plpgsql as $$
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

commit;

notify pgrst, 'reload schema';
