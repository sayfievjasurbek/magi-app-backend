-- New auto-detected cheating types the desktop app's camera/window watchers can now report
-- directly (previously only recorded in the student's local activity log, never synced).
-- Idempotent: safe to run again. ALTER TYPE ... ADD VALUE cannot run inside the same
-- transaction as a statement that uses the new value, but is itself transactional since PG12.

begin;

do $$
begin
  if not exists (select 1 from pg_enum where enumlabel = 'phone_seen' and enumtypid = 'public.type_cheating_types'::regtype) then
    alter type public.type_cheating_types add value 'phone_seen';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'camera_away' and enumtypid = 'public.type_cheating_types'::regtype) then
    alter type public.type_cheating_types add value 'camera_away';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'link_blocked' and enumtypid = 'public.type_cheating_types'::regtype) then
    alter type public.type_cheating_types add value 'link_blocked';
  end if;
  if not exists (select 1 from pg_enum where enumlabel = 'app_closed' and enumtypid = 'public.type_cheating_types'::regtype) then
    alter type public.type_cheating_types add value 'app_closed';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
