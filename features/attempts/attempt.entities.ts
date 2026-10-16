// Attempts domain: one type per table it owns, field for field from migrations/003_exam_schema.sql
// and 007_attempt_extras.sql (position, marks_awarded, feedback). An "assignment" is one student's
// exam attempt.
import { type TimeUnit } from '../../lib/deadline.js';

export type AttemptStatus = 'pending' | 'in_progress' | 'submitted' | 'auto_submitted' | 'graded' | 'flagged';

// one sample of "characters typed so far" at a point in the attempt, taken every few seconds on
// the student's own client - the raw material for a WPM-over-time chart (chars / 5 is the
// standard word-length convention), never a word count or the answer text itself
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
