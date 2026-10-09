-- A student's own reference photo, set in their Settings page - gives staff something to compare
-- the identity_check photo taken during an exam against, instead of just a typed ID number.
-- Idempotent: safe to run again.

begin;

alter table public.students add column if not exists profile_photo_url text;

commit;

notify pgrst, 'reload schema';
