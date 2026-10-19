-- The camera watcher now also listens for voice activity while a second face is in view (not
-- just presence) - sustained concurrent talking-with-someone is reported as its own incident,
-- same as extra_person was. Idempotent: safe to run again.

begin;

do $$
begin
  if not exists (select 1 from pg_enum where enumlabel = 'talking' and enumtypid = 'public.type_cheating_types'::regtype) then
    alter type public.type_cheating_types add value 'talking';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
