-- Lets professors create a "file upload" question: the student submits a file (e.g. a scanned
-- worksheet or project zip) instead of typing an answer. Reuses question_assignment.answer to
-- store the file's public URL - no new column needed, same as every other free-text answer.
-- Idempotent: safe to run again.

begin;

alter type public.type_question_type add value if not exists 'file_upload';

commit;

notify pgrst, 'reload schema';
