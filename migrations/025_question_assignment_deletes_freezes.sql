-- Tracks delete keystrokes separately from edits, plus typing-pause ("freeze") behaviour and
-- paste event counts (as opposed to pasted character counts), alongside the existing
-- text_typed/text_edited/text_pasted counters. Idempotent.

begin;

alter table public.question_assignment add column if not exists text_deleted int not null default 0;
alter table public.question_assignment add column if not exists freeze_count int not null default 0;
alter table public.question_assignment add column if not exists longest_freeze int not null default 0;
alter table public.question_assignment add column if not exists paste_events int not null default 0;

commit;

notify pgrst, 'reload schema';
