import { database } from '../../lib/db.js';
import { attemptExpired, type TimeUnit } from '../../lib/deadline.js';
import { HttpError } from '../../lib/errors.js';
import { type Caller, findVisibleExam } from '../../lib/exam-access.js';
import { uploadPhoto } from '../../lib/storage.js';
import { activeOnly, parseId, softDelete } from '../../lib/utils.js';

type Attempt = {
  id: number;
  exam_id: number;
  status: string;
  submitted_at: string | null;
  session_duration: number;
  session_duration_unit: TimeUnit;
  started_at: string | null;
};
type Media = { id: number; url: string; label: string | null; created_at: string };

const ATTEMPT_COLUMNS = 'id, exam_id, status, submitted_at, session_duration, session_duration_unit, started_at';

// a cheating incident turns in_progress into flagged in the same column, so the attempt is
// still running as long as it has not been submitted
const isRunning = (attempt: Attempt) =>
  (attempt.status === 'in_progress' || attempt.status === 'flagged') && !attempt.submitted_at;

// the four media kinds, each with its own table and the join table carrying the attempt
const kinds = {
  'panoramic-views': { table: 'panoramic_view', join: 'assignment_panoramic_view', column: 'panoramic_view_id' },
  'video-recordings': { table: 'video_recordings', join: 'assignment_video_recording', column: 'video_recording_id' },
  'face-snapshots': { table: 'face_snapshots', join: 'assignment_face_snapshot', column: 'face_snapshot_id' },
  'snapshots': { table: 'snapshots', join: 'assignment_snapshot', column: 'snapshot_id' },
} as const;

// reads are not paginated: an attempt answers with its newest media only
const MEDIA_LIMIT = 100;
const MAX_REASON = 1000;
const MAX_LABEL = 200;

// an unknown kind is a path segment that cannot exist, like an id that does not parse
const kindOf = (kind: string) => {
  const media = kinds[kind as keyof typeof kinds];
  if (!media) throw new HttpError(404, 'Media not found');
  return media;
};

const parseLabel = (value: unknown): string | null => {
  const label = typeof value === 'string' ? value.trim() : '';
  if (!label) return null;
  if (label.length > MAX_LABEL) throw new HttpError(400, `label must be at most ${MAX_LABEL} characters`);
  return label;
};

const parseReason = (value: unknown): string => {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (!reason) throw new HttpError(400, 'reason is required');
  if (reason.length > MAX_REASON) throw new HttpError(400, `reason must be at most ${MAX_REASON} characters`);
  return reason;
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

// an attempt the caller cannot see is a 404, so media never leaks the attempt behind it
const findStaffAttempt = async (attemptId: number, user: Caller, missing: string): Promise<Attempt> => {
  const attempt = await findAttempt(attemptId, missing);
  if (!(await findVisibleExam(attempt.exam_id, user))) throw new HttpError(404, missing);
  return attempt;
};

export const addMedia = async (kind: string, attemptIdParam: string, studentId: number, image: unknown, label: unknown): Promise<Media> => {
  const media = kindOf(kind);
  const attemptId = parseId(attemptIdParam);
  if (!attemptId) throw new HttpError(404, 'Attempt not found');
  const mediaLabel = parseLabel(label);

  const attempt = await findAttempt(attemptId);
  if (!(await ownsAttempt(attemptId, studentId))) throw new HttpError(404, 'Attempt not found');
  if (!isRunning(attempt)) throw new HttpError(409, 'Media can only be added while the attempt is in progress');
  // the attempt is only auto submitted by the attempts domain, so the clock is checked here as well
  if (await attemptExpired(attempt)) throw new HttpError(409, 'Time is up: this attempt is over');

  const mediaUrl = await uploadPhoto(attemptId, kind, image);

  const { data: row, error } = await database
    .from(media.table)
    .insert({ url: mediaUrl, label: mediaLabel })
    .select('id, url, label, created_at')
    .single<Media>();

  if (error) throw new Error(error.message);
  if (!row) throw new Error('Media row is null after insertion');

  const { error: linkError } = await database
    .from(media.join)
    .insert({ assignment_id: attemptId, [media.column]: row.id });

  // PostgREST has no transaction over two inserts: drop the media row again so a failed add leaves nothing behind
  if (linkError) {
    await database.from(media.table).delete().eq('id', row.id);
    throw new Error(linkError.message);
  };

  return row;
};

export const listMedia = async (kind: string, attemptIdParam: string, user: Caller): Promise<Media[]> => {
  const media = kindOf(kind);
  const attemptId = parseId(attemptIdParam);
  if (!attemptId) throw new HttpError(404, 'Attempt not found');

  await findStaffAttempt(attemptId, user, 'Attempt not found');

  // ids grow with the inserts, so the newest rows of the attempt are the highest ones
  const { data: links, error: linkError } = await database
    .from(media.join)
    .select(media.column)
    .eq('assignment_id', attemptId)
    .order(media.column, { ascending: false })
    .limit(MEDIA_LIMIT);

  if (linkError) throw new Error(linkError.message);
  if (!links?.length) return [];

  const { data, error } = await activeOnly(
    database.from(media.table).select('id, url, label, created_at').in('id', links.map((row: Record<string, number>) => row[media.column]))
  ).order('created_at', { ascending: false }).limit(MEDIA_LIMIT);

  if (error) throw new Error(error.message);
  return (data ?? []) as Media[];
};

export const deleteMedia = async (kind: string, mediaIdParam: string, professorId: number, reason: unknown) => {
  const media = kindOf(kind);
  const mediaId = parseId(mediaIdParam);
  if (!mediaId) throw new HttpError(404, 'Media not found');
  const deleteReason = parseReason(reason);

  const { data: link, error: linkError } = await database
    .from(media.join)
    .select('assignment_id')
    .eq(media.column, mediaId)
    .maybeSingle<{ assignment_id: number }>();

  if (linkError) throw new Error(linkError.message);
  if (!link) throw new HttpError(404, 'Media not found');

  const attempt = await findAttempt(link.assignment_id, 'Media not found');
  if (!(await findVisibleExam(attempt.exam_id, { id: professorId, role: 'professor' }))) throw new HttpError(404, 'Media not found');

  // the join row stays: the attempt keeps the trace of the media it once had
  const { data, error } = await activeOnly(
    database.from(media.table).update(softDelete(deleteReason)).eq('id', mediaId)
  ).select('id, url, deleted_at, reason').maybeSingle<{ id: number; url: string; deleted_at: string; reason: string }>();

  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, 'Media not found');

  return data;
};
