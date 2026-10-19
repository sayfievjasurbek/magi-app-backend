-- The camera watcher now also flags a sharp, sustained head turn away from the camera (not just
-- nobody-in-view or a second person) - same pattern as 019/029. Idempotent: safe to run again.

begin;

do $$
begin
  if not exists (select 1 from pg_enum where enumlabel = 'looking_away' and enumtypid = 'public.type_cheating_types'::regtype) then
    alter type public.type_cheating_types add value 'looking_away';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
