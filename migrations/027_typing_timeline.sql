-- A coarse typing-speed-over-time timeline for the whole attempt (characters typed so far,
-- sampled every few seconds on the student's own machine), so staff can see a WPM curve instead
-- of just the aggregate writing-forensics counts. Best-effort: only present when the student's
-- own client supplied one at submit time. Idempotent.

begin;

alter table public.assignments add column if not exists typing_timeline jsonb not null default '[]'::jsonb;

commit;

notify pgrst, 'reload schema';
