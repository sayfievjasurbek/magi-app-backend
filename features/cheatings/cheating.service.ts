import { database } from '../../lib/db.js';
import { attemptExpired, type TimeUnit } from '../../lib/deadline.js';
import { HttpError } from '../../lib/errors.js';
import { type Caller, findVisibleExam } from '../../lib/exam-access.js';
import { activeOnly, parseId, softDelete } from '../../lib/utils.js';
import { type Role } from '../../lib/types.js';

type Attempt = {
  id: number;
  exam_id: number;
  status: string;
  submitted_at: string | null;
  session_duration: number;
  session_duration_unit: TimeUnit;
  started_at: string | null;
};
type Cheating = { id: number; name: string; explanation: string; created_at: string };

const ATTEMPT_COLUMNS = 'id, exam_id, status, submitted_at, session_duration, session_duration_unit, started_at';

// an earlier incident turns in_progress into flagged in the same column, so the attempt is
// still running as long as it has not been submitted
const isRunning = (attempt: Attempt) =>
  (attempt.status === 'in_progress' || attempt.status === 'flagged') && !attempt.submitted_at;

// type_cheating_types: manual_review is the only one a client cannot report by itself
const cheatingTypes = [
  'tab_switch_limit', 'copy_paste', 'devtools', 'multiple_monitors',
  'face_mismatch', 'screen_share', 'unauthorized_app', 'manual_review',
  'phone_seen', 'camera_away', 'link_blocked', 'app_closed', 'extra_person',
];
const automaticTypes = cheatingTypes.filter((name) => name !== 'manual_review');

// a flagged attempt can still be graded, a graded one is never flagged again
const flaggableStatuses = ['in_progress', 'submitted', 'auto_submitted'];

// reads are not paginated: an attempt answers with its newest incidents, a summary counts up to this many rows per step
const INCIDENT_LIMIT = 200;
const SUMMARY_LIMIT = 1000;
const MAX_TEXT = 1000;

const parseText = (value: unknown, field: string): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new HttpError(400, `${field} is required`);
  if (text.length > MAX_TEXT) throw new HttpError(400, `${field} must be at most ${MAX_TEXT} characters`);
  return text;
};

const parseName = (value: unknown, role: Role): string => {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!cheatingTypes.includes(name)) throw new HttpError(400, `name must be one of ${cheatingTypes.join(', ')}`);
  if (role === 'student' && !automaticTypes.includes(name)) {
    throw new HttpError(403, 'Only professors and examiners can record a manual review');
  };
  return name;
};

const findAttempt = async (attemptId: number, missing = 'Attempt not found'): Promise<Attempt> => {
  const { data, error } = await activeOnly(
    database.from('assignments').select(ATTEMPT_COLUMNS).eq('id', attemptId)
  ).maybeSingle<Attempt>();

  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, missing);

  return data;
};

const ownsAttempt = async (attemptId: number, studentId: number): Promise<boolean> => {
  const { data, error } = await database
    .from('student_assignment')
    .select('assignment_id')
    .eq('assignment_id', attemptId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data);
};

// an attempt the caller cannot see is a 404, so an incident never leaks the attempt behind it
const findStaffAttempt = async (attemptId: number, user: Caller, missing: string): Promise<Attempt> => {
  const attempt = await findAttempt(attemptId, missing);
  if (!(await findVisibleExam(attempt.exam_id, user))) throw new HttpError(404, missing);
  return attempt;
};

const incidentIds = async (attemptId: number, limit: number): Promise<number[]> => {
  const { data, error } = await database
    .from('cheating_reason')
    .select('cheating_id')
    .eq('assignment_id', attemptId)
    .order('cheating_id', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.cheating_id);
};

export const createIncident = async (attemptIdParam: string, user: Caller, name: unknown, explanation: unknown): Promise<Cheating> => {
  const attemptId = parseId(attemptIdParam);
  if (!attemptId) throw new HttpError(404, 'Attempt not found');
  const cheatingName = parseName(name, user.role);
  const cheatingExplanation = parseText(explanation, 'explanation');

  const attempt = await findAttempt(attemptId);

  if (user.role === 'student') {
    if (!(await ownsAttempt(attemptId, user.id))) throw new HttpError(404, 'Attempt not found');
    if (!isRunning(attempt)) throw new HttpError(409, 'Incidents can only be reported while the attempt is in progress');
    // the attempt is only auto submitted by the attempts domain, so the clock is checked here as well
    if (await attemptExpired(attempt)) throw new HttpError(409, 'Time is up: this attempt is over');
  } else if (!(await findVisibleExam(attempt.exam_id, user))) {
    throw new HttpError(404, 'Attempt not found');
  };

  const { data: incident, error } = await database
    .from('cheatings')
    .insert({ name: cheatingName, explanation: cheatingExplanation })
    .select('id, name, explanation, created_at')
    .single<Cheating>();

  if (error) throw new Error(error.message);
  if (!incident) throw new Error('Cheating row is null after insertion');

  // PostgREST has no transaction over these writes: cheating_reason cascades from cheatings,
  // so dropping the incident again undoes the whole thing
  const { error: linkError } = await database
    .from('cheating_reason')
    .insert({ assignment_id: attemptId, cheating_id: incident.id });

  if (linkError) {
    await database.from('cheatings').delete().eq('id', incident.id);
    throw new Error(linkError.message);
  };

  // one conditional update, so a concurrently graded attempt is never flagged afterwards;
  // the incident is already recorded at this point, so a hiccup here must not undo it
  const { error: statusError } = await database
    .from('assignments')
    .update({ status: 'flagged' })
    .eq('id', attemptId)
    .in('status', flaggableStatuses);

  if (statusError) console.error('Error flagging attempt after recording a cheating incident:', statusError.message);

  return incident;
};

export const listIncidents = async (attemptIdParam: string, user: Caller): Promise<Cheating[]> => {
  const attemptId = parseId(attemptIdParam);
  if (!attemptId) throw new HttpError(404, 'Attempt not found');

  await findStaffAttempt(attemptId, user, 'Attempt not found');

  const ids = await incidentIds(attemptId, INCIDENT_LIMIT);
  if (!ids.length) return [];

  const { data, error } = await activeOnly(
    database.from('cheatings').select('id, name, explanation, created_at').in('id', ids)
  ).order('created_at', { ascending: false }).limit(INCIDENT_LIMIT);

  if (error) throw new Error(error.message);
  return (data ?? []) as Cheating[];
};

export const getIncident = async (cheatingIdParam: string, user: Caller) => {
  const cheatingId = parseId(cheatingIdParam);
  if (!cheatingId) throw new HttpError(404, 'Cheating not found');

  const { data: link, error: linkError } = await database
    .from('cheating_reason')
    .select('assignment_id')
    .eq('cheating_id', cheatingId)
    .maybeSingle<{ assignment_id: number }>();

  if (linkError) throw new Error(linkError.message);
  if (!link) throw new HttpError(404, 'Cheating not found');

  await findStaffAttempt(link.assignment_id, user, 'Cheating not found');

  const { data, error } = await activeOnly(
    database.from('cheatings').select('id, name, explanation, created_at, updated_at').eq('id', cheatingId)
  ).maybeSingle<Cheating & { updated_at: string }>();

  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, 'Cheating not found');

  return { ...data, assignment_id: link.assignment_id };
};

// dismissing an incident does not give the attempt its previous status back: it stays flagged
export const dismissIncident = async (cheatingIdParam: string, professorId: number, reason: unknown) => {
  const cheatingId = parseId(cheatingIdParam);
  if (!cheatingId) throw new HttpError(404, 'Cheating not found');
  const deleteReason = parseText(reason, 'reason');

  const { data: link, error: linkError } = await database
    .from('cheating_reason')
    .select('assignment_id')
    .eq('cheating_id', cheatingId)
    .maybeSingle<{ assignment_id: number }>();

  if (linkError) throw new Error(linkError.message);
  if (!link) throw new HttpError(404, 'Cheating not found');

  const attempt = await findAttempt(link.assignment_id, 'Cheating not found');
  if (!(await findVisibleExam(attempt.exam_id, { id: professorId, role: 'professor' }))) throw new HttpError(404, 'Cheating not found');

  const { data, error } = await activeOnly(
    database.from('cheatings').update(softDelete(deleteReason)).eq('id', cheatingId)
  ).select('id, name, deleted_at, reason').maybeSingle<{ id: number; name: string; deleted_at: string; reason: string }>();

  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, 'Cheating not found');

  return data;
};

export const examSummary = async (examIdParam: unknown, user: Caller) => {
  const examId = parseId(examIdParam);
  if (!examId) throw new HttpError(400, 'examId is required');

  if (!(await findVisibleExam(examId, user))) throw new HttpError(404, 'Exam not found');

  const { data: attempts, error: attemptError } = await activeOnly(
    database.from('assignments').select('id').eq('exam_id', examId)
  ).limit(SUMMARY_LIMIT);

  if (attemptError) throw new Error(attemptError.message);
  if (!attempts?.length) return [];

  const { data: links, error: linkError } = await database
    .from('cheating_reason')
    .select('cheating_id')
    .in('assignment_id', attempts.map((row: { id: number }) => row.id))
    .limit(SUMMARY_LIMIT);

  if (linkError) throw new Error(linkError.message);
  if (!links?.length) return [];

  const { data, error } = await activeOnly(
    database.from('cheatings').select('name').in('id', links.map((row) => row.cheating_id))
  ).limit(SUMMARY_LIMIT);

  if (error) throw new Error(error.message);

  const counts = new Map<string, number>();
  for (const row of data ?? []) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};
