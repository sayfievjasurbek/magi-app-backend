-- The professor who created an exam, and the catalog of events an exam can monitor.
-- Idempotent: safe to run again.

begin;

alter table public.exams add column if not exists created_by bigint references public.users(id);
create index if not exists exams_created_by_idx on public.exams (created_by);

-- one catalog row per type_exam_event value; a name that is already there keeps its description
insert into public.events (name, description)
select catalog.name::public.type_exam_event, catalog.description
from (values
  ('browser_version', 'Name and version of the browser running the exam'),
  ('active_app', 'Application in the foreground on the candidate machine'),
  ('menu_bar_icon', 'Icons sitting in the system menu bar or tray'),
  ('open_window', 'Windows left open next to the exam window'),
  ('monitor_count', 'Number of displays connected while the exam runs'),
  ('monitor_hotplug', 'A display was connected or disconnected during the exam'),
  ('chrome_extension', 'Extensions installed in the exam browser'),
  ('tab_switch', 'The candidate moved to another browser tab'),
  ('app_switch', 'The candidate moved to another application'),
  ('screen_mirror', 'The screen is mirrored, shared or cast to another device'),
  ('devtools_opened', 'Developer tools were opened in the exam browser'),
  ('copy_paste', 'Text was copied or pasted inside the exam'),
  ('url_access', 'A page outside the permitted urls was opened')
) as catalog(name, description)
where not exists (
  select 1 from public.events where events.name = catalog.name::public.type_exam_event
);

commit;

notify pgrst, 'reload schema';
