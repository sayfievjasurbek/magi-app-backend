-- A short label alongside a monitoring photo's url (e.g. "ID number 12", "Phone seen at
-- 05:32") - without this there was no way to say what a stored photo actually shows.
-- Idempotent: safe to run again.

begin;

alter table public.face_snapshots add column if not exists label text;
alter table public.snapshots add column if not exists label text;
alter table public.panoramic_view add column if not exists label text;
alter table public.video_recordings add column if not exists label text;

commit;

notify pgrst, 'reload schema';
