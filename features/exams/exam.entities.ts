// Exams domain: one type per table it owns, field for field from migrations/003_exam_schema.sql
// and 006_exam_owner_and_events.sql (exams.created_by).

export type ExamStatus = 'demo' | 'scheduled' | 'ongoing' | 'completed' | 'delayed' | 'cancelled';

export type ExamEventName =
  | 'browser_version'
  | 'active_app'
  | 'menu_bar_icon'
  | 'open_window'
  | 'monitor_count'
  | 'monitor_hotplug'
  | 'chrome_extension'
  | 'tab_switch'
  | 'app_switch'
  | 'screen_mirror'
  | 'devtools_opened'
  | 'copy_paste'
  | 'url_access';

export type Exam = {
  id: number;
  name: string;
  shuffle_questions: boolean;
  scheduled_start: string;
  scheduled_end: string;
  status: ExamStatus;
  max_marks: number;
  passing_marks: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  reason: string | null;
};

export type ExamModule = { exam_id: number; module_id: number };

export type ExamExaminer = { exam_id: number; examiner_id: number };

export type ExamStudent = { exam_id: number; student_id: number };

// not in the DBML: which questions an exam asks, in which order, for how many marks
export type ExamQuestion = { exam_id: number; question_id: number; position: number; marks: number };

export type Event = {
  id: number;
  name: ExamEventName;
  description: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  reason: string | null;
};

export type ExamEvent = { exam_id: number; event_id: number };

export type PermittedUrl = { id: number; url: string; created_at: string };

export type ExamPermittedUrl = { exam_id: number; permitted_url_id: number };
