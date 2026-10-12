-- The camera watcher already counts faces per look (used for camera_away); a count above one
-- means someone else is in view, not just the student missing. Reported as its own incident,
-- not auto-failed - the exam keeps running, a professor decides what it means when grading.
-- Idempotent: safe to run again.

begin;

do $$
begin
  if not exists (select 1 from pg_enum where enumlabel = 'extra_person' and enumtypid = 'public.type_cheating_types'::regtype) then
    alter type public.type_cheating_types add value 'extra_person';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
