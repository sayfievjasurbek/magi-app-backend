import { database } from './db.js';
import { activeOnly } from './utils.js';

// When one attempt is over: its own session limit, and never later than the exam window.
// The attempts, monitoring and cheatings services share it so a student side write is
// judged by the same clock everywhere.

export type TimeUnit = 'seconds' | 'minutes' | 'hours' | 'days';
type Timed = { exam_id: number; session_duration: number; session_duration_unit: TimeUnit; started_at: string | null };
type Window = { scheduled_start: string; scheduled_end: string };

const SECONDS: Record<TimeUnit, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };

export const TIME_UNITS = Object.keys(SECONDS) as TimeUnit[];

export const toSeconds = (value: number, unit: TimeUnit) => value * (SECONDS[unit] ?? 1);

export const deadline = (attempt: Timed, exam: Window) => {
  const started = attempt.started_at ? Date.parse(attempt.started_at) : Date.parse(exam.scheduled_start);
  return Math.min(started + toSeconds(attempt.session_duration, attempt.session_duration_unit) * 1000, Date.parse(exam.scheduled_end));
};

// for the domains that hold an attempt but not its exam; an exam that is gone leaves nothing running
export const attemptExpired = async (attempt: Timed): Promise<boolean> => {
  const { data: exam, error } = await activeOnly(
    database.from('exams').select('scheduled_start, scheduled_end').eq('id', attempt.exam_id)
  ).maybeSingle<Window>();

  if (error) throw new Error(error.message);
  if (!exam) return true;

  return Date.now() >= deadline(attempt, exam);
};
