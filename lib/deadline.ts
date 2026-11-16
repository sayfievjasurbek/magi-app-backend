export type TimeUnit = 'seconds' | 'minutes' | 'hours' | 'days';
type Timed = { exam_id: number; session_duration: number; session_duration_unit: TimeUnit; started_at: string | null; unlimited_time: boolean };
type Window = { scheduled_start: string; scheduled_end: string };

const SECONDS: Record<TimeUnit, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };

export const TIME_UNITS = Object.keys(SECONDS) as TimeUnit[];

export const toSeconds = (value: number, unit: TimeUnit) => value * (SECONDS[unit] ?? 1);

// retakes - far enough out that it never runs out, keeps it a normal number
const FAR_FUTURE = Date.parse('2099-12-31T00:00:00Z');

export const deadline = (attempt: Timed, exam: Window) => {
  if (attempt.unlimited_time) return FAR_FUTURE;
  const started = attempt.started_at ? Date.parse(attempt.started_at) : Date.parse(exam.scheduled_start);
  return Math.min(started + toSeconds(attempt.session_duration, attempt.session_duration_unit) * 1000, Date.parse(exam.scheduled_end));
};
