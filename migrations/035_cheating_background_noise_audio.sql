-- The microphone now also watches for a sustained run of sound from outside the exam (not
-- paired with a second face, unlike talking) and records a short clip of it as evidence - a new
-- cheating type plus a media table to hold the clip, same shape as video_recordings. Idempotent:
-- safe to run again.

begin;

do $$
begin
  if not exists (select 1 from pg_enum where enumlabel = 'background_noise' and enumtypid = 'public.type_cheating_types'::regtype) then
    alter type public.type_cheating_types add value 'background_noise';
  end if;
end $$;

create table if not exists public.audio_recordings (
  id bigint generated always as identity primary key,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  reason text
);
alter table public.audio_recordings enable row level security;

create table if not exists public.assignment_audio_recording (
  assignment_id bigint not null references public.assignments(id) on delete cascade,
  audio_recording_id bigint not null references public.audio_recordings(id) on delete cascade,
  primary key (assignment_id, audio_recording_id)
);
create index if not exists assignment_audio_recording_media_idx on public.assignment_audio_recording (audio_recording_id);
alter table public.assignment_audio_recording enable row level security;

commit;

notify pgrst, 'reload schema';
