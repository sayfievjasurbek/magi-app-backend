-- Separates what a chat message shows the professor (content - the plain typed text) from what a
-- later turn hands back to the model (model_content - the same text plus whatever was extracted
-- from an attached file, or an <attached_image url="..."> marker pointing at a persisted copy of
-- an attached image). Null whenever no file was attached - the message persists exactly as typed.

begin;

alter table public.ai_chat_messages add column if not exists model_content text;

commit;

notify pgrst, 'reload schema';
