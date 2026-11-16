// an "assignment" is one student's attempt at an exam
import { type TimeUnit } from '../../lib/deadline.js';

export type AttemptStatus = 'pending' | 'in_progress' | 'submitted' | 'auto_submitted' | 'graded' | 'flagged';

// chars typed so far, sampled every few seconds (for the wpm chart)
export type TypingTimelinePoint = { t: number; chars: number };

export type Assignment = {
  id: number;
  exam_id: number;
  session_duration: number;
  session_duration_unit: TimeUnit;
  started_at: string | null;
  submitted_at: string | null;
  auto_submitted: boolean;
  status: AttemptStatus;
  score: number;
  feedback: string | null;
  cheating_disclosed: boolean;
  typing_timeline: TypingTimelinePoint[];
  unlimited_time: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  reason: string | null;
};

// the columns of an assignment the service works with (ATTEMPT_COLUMNS)
export type Attempt = Omit<Assignment, 'created_at' | 'updated_at' | 'deleted_at' | 'reason'>;

export type StudentAssignment = { student_id: number; assignment_id: number; exam_id: number };

export type QuestionAssignment = {
  assignment_id: number;
  question_id: number;
  answer: string;
  typing_duration: number;
  typing_duration_unit: TimeUnit;
  text_typed: number;
  text_edited: number;
  text_pasted: number;
  last_synced_at: string | null;
  started_at: string | null;
  answered_at: string | null;
  position: number;
  marks_awarded: number;
};

export type QuestionAssignmentOption = { assignment_id: number; question_id: number; option_id: number };

export type AssignmentPermittedUrl = { assignment_id: number; permitted_url_id: number };
export type AssignmentPermittedApp = { assignment_id: number; permitted_app_id: number };
