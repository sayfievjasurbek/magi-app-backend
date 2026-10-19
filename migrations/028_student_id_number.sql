-- The ID card number a student is expected to show (and type) during the pre-exam identity
-- check - set by the professor/admin at creation time, or auto-generated the same way as
-- student_code if left blank. The desktop app checks what the student types against this instead
-- of accepting anything. Idempotent.

begin;

alter table public.students add column if not exists id_number text unique;

commit;

notify pgrst, 'reload schema';
