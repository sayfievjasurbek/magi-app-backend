import { database } from '../../lib/db.js';
import { deadline, TIME_UNITS, type TimeUnit, toSeconds } from '../../lib/deadline.js';
import { HttpError } from '../../lib/errors.js';
import { uploadSubmissionFile } from '../../lib/storage.js';
import { type Caller, findVisibleExam, managedExamIds, sitsExam } from '../../lib/exam-access.js';
import { activeOnly, parseId } from '../../lib/utils.js';
import { notify } from '../../lib/notifications.js';
import { aiConfigured, reviewAnswers, deepReviewAnswers, type AiReview, type IncidentCount } from '../../lib/ai.js';
import { aiProbabilityOf, computeWritingProfile } from '../../lib/writingProfile.js';
import { incidentsForAttempt } from '../cheatings/cheating.service.js';
import { proctoringPhotosForAttempt } from '../monitoring/monitoring.service.js';
import { type Attempt, type AttemptStatus, type TypingTimelinePoint } from './attempt.entities.js';

// the exam columns an attempt is judged by; the exams table itself belongs to features/exams
type Exam = {
  id: number;
  name: string;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  max_marks: number;
  passing_marks: number;
  created_by: number | null;
};

const ATTEMPT_COLUMNS = 'id, exam_id, session_duration, session_duration_unit, started_at, submitted_at, auto_submitted, status, score, feedback, cheating_disclosed, typing_timeline, unlimited_time';
// a finished attempt a professor can reopen for resubmission - see allowRetake
const RETAKEABLE_STATUSES: AttemptStatus[] = ['submitted', 'auto_submitted', 'graded', 'flagged'];
// created_by is never answered with, it is what says whether a professor manages the exam
const EXAM_COLUMNS = 'id, name, scheduled_start, scheduled_end, status, max_marks, passing_marks, created_by';
const ANSWER_COLUMNS = 'question_id, position, answer, typing_duration, typing_duration_unit, text_typed, text_edited, text_pasted, paste_events, text_deleted, freeze_count, longest_freeze, last_synced_at, started_at, answered_at, marks_awarded';

const ATTEMPT_STATUSES: AttemptStatus[] = ['pending', 'in_progress', 'submitted', 'auto_submitted', 'graded', 'flagged'];
// a student may only sit an exam that is open in the schedule sense
const STARTABLE_EXAM_STATUSES = ['scheduled', 'ongoing', 'demo'];
// the question types a professor has to grade by hand; the rest is graded at submit
const MANUAL_TYPES = ['short_answer', 'essay', 'file_upload'];
// of those, the ones AI review can judge from the text itself - a file_upload has no text to compare against model_answers
const AI_REVIEWABLE_TYPES = ['short_answer', 'essay'];
// reads are not paginated: one exam answers with its first attempts, as the media and incident lists do
const ATTEMPT_LIMIT = 500;

const unwrap = <T>({ data, error }: { data: T | null; error: { message: string } | null }): T | null => {
  if (error) throw new Error(error.message);
  return data;
};

// `flagged` is written by the cheating domain and does not end the session, so an unsubmitted attempt stays open
const isOpen = (attempt: Attempt) =>
  attempt.submitted_at === null && (attempt.status === 'in_progress' || attempt.status === 'flagged');

const remainingSeconds = (attempt: Attempt, exam: Exam) =>
  isOpen(attempt) ? Math.max(0, Math.floor((deadline(attempt, exam) - Date.now()) / 1000)) : 0;

const pasteRatio = (typed: number, pasted: number) =>
  typed + pasted ? Math.round((pasted / (typed + pasted)) * 100) / 100 : null;

const loadExam = async (examId: number): Promise<Exam> => {
  const exam = unwrap(await activeOnly(database.from('exams').select(EXAM_COLUMNS).eq('id', examId)).maybeSingle()) as Exam | null;
  if (!exam) throw new HttpError(404, 'Exam not found');
  return exam;
};

const loadAttempt = async (attemptId: number): Promise<Attempt> => {
  const attempt = unwrap(await activeOnly(database.from('assignments').select(ATTEMPT_COLUMNS).eq('id', attemptId)).maybeSingle()) as Attempt | null;
  if (!attempt) throw new HttpError(404, 'Attempt not found');
  return attempt;
};

const loadOwnAttempt = async (studentId: number, attemptId: number) => {
  const attempt = await loadAttempt(attemptId);

  const owner = unwrap(await database
    .from('student_assignment')
    .select('student_id')
    .eq('assignment_id', attemptId)
    .eq('student_id', studentId)
    .maybeSingle());
  if (!owner) throw new HttpError(404, 'Attempt not found');

  return { attempt, exam: await loadExam(attempt.exam_id) };
};

const loadStaffAttempt = async (caller: Caller, attemptId: number) => {
  const attempt = await loadAttempt(attemptId);
  const exam = await findVisibleExam(attempt.exam_id, caller, EXAM_COLUMNS) as Exam | null;
  if (!exam) throw new HttpError(404, 'Attempt not found');

  const owner = unwrap(await database.from('student_assignment').select('student_id').eq('assignment_id', attemptId).maybeSingle()) as { student_id: number } | null;
  return { attempt, exam, studentId: owner?.student_id ?? null };
};

const loadStudent = async (studentId: number | null) => {
  if (!studentId) return null;
  return unwrap(await activeOnly(database.from('users').select('id, first_name, last_name, email').eq('id', studentId)).maybeSingle());
};

// `flagged` is staff business: a student reads the status the attempt would have without the flag
const studentStatus = (attempt: Attempt): AttemptStatus => {
  if (attempt.status !== 'flagged') return attempt.status;
  if (!attempt.submitted_at) return 'in_progress';
  return attempt.auto_submitted ? 'auto_submitted' : 'submitted';
};

const studentSummary = (attempt: Attempt, exam: Exam) => ({
  id: attempt.id,
  exam_id: attempt.exam_id,
  status: studentStatus(attempt),
  started_at: attempt.started_at,
  submitted_at: attempt.submitted_at,
  auto_submitted: attempt.auto_submitted,
  session_duration: attempt.session_duration,
  session_duration_unit: attempt.session_duration_unit,
  expires_at: new Date(deadline(attempt, exam)).toISOString(),
  remaining_seconds: remainingSeconds(attempt, exam),
  unlimited_time: attempt.unlimited_time,
  exam: {
    id: exam.id,
    name: exam.name,
    scheduled_start: exam.scheduled_start,
    scheduled_end: exam.scheduled_end,
    status: exam.status,
    max_marks: exam.max_marks,
    passing_marks: exam.passing_marks,
  },
  // the score is the student's only once the grading is finished
  ...(attempt.status === 'graded'
    ? { score: attempt.score, passed: attempt.score >= exam.passing_marks, feedback: attempt.feedback }
    : {}),
});

const staffSummary = (attempt: Attempt, exam: Exam, student: unknown) => ({
  ...studentSummary(attempt, exam),
  status: attempt.status,
  score: attempt.score,
  passed: attempt.status === 'graded' ? attempt.score >= exam.passing_marks : null,
  feedback: attempt.feedback,
  cheating_disclosed: attempt.cheating_disclosed,
  typing_timeline: attempt.typing_timeline,
  student,
});

// the two detail views differ only in what a student must not see: the correct options and the paste ratio
const attemptQuestions = async (attempt: Attempt, forStaff: boolean) => {
  const rows = unwrap(await database
    .from('question_assignment')
    .select(ANSWER_COLUMNS)
    .eq('assignment_id', attempt.id)
    .order('position')) ?? [];
  if (!rows.length) return [];

  const questionIds = rows.map((row: { question_id: number }) => row.question_id);

  const questions = unwrap(await activeOnly(database
    .from('questions')
    .select('id, title, question, question_type, expected_duration, expected_duration_unit')
    .in('id', questionIds))) ?? [];
  // the column list depends on the caller, which the PostgREST result types cannot follow
  const options = (unwrap(await activeOnly(database
    .from('question_options')
    .select(forStaff ? 'id, question_id, option_text, is_correct' : 'id, question_id, option_text')
    .in('question_id', questionIds)
    .order('id'))) ?? []) as unknown as { id: number; question_id: number; option_text: string; is_correct?: boolean }[];
  const chosen = unwrap(await database
    .from('question_assignment_option')
    .select('question_id, option_id')
    .eq('assignment_id', attempt.id)) ?? [];
  const marks = unwrap(await database.from('exam_question').select('question_id, marks').eq('exam_id', attempt.exam_id)) ?? [];

  const questionById = new Map(questions.map((question: { id: number }) => [question.id, question]));
  const marksById = new Map(marks.map((row: { question_id: number; marks: number }) => [row.question_id, row.marks]));

  return rows.flatMap((row: any) => {
    const question = questionById.get(row.question_id) as any;
    // the question was soft deleted after the attempt started
    if (!question) return [];

    return [{
      question_id: question.id,
      position: row.position,
      title: question.title,
      question: question.question,
      question_type: question.question_type,
      expected_duration: question.expected_duration,
      expected_duration_unit: question.expected_duration_unit,
      marks: marksById.get(question.id) ?? 0,
      options: options
        .filter((option: { question_id: number }) => option.question_id === question.id)
        .map(({ question_id, ...option }: any) => option),
      answer: row.answer,
      selected_option_ids: chosen
        .filter((option: { question_id: number }) => option.question_id === row.question_id)
        .map((option: { option_id: number }) => option.option_id),
      typing_duration: row.typing_duration,
      typing_duration_unit: row.typing_duration_unit,
      text_typed: row.text_typed,
      text_edited: row.text_edited,
      text_pasted: row.text_pasted,
      paste_events: row.paste_events,
      text_deleted: row.text_deleted,
      freeze_count: row.freeze_count,
      longest_freeze: row.longest_freeze,
      started_at: row.started_at,
      answered_at: row.answered_at,
      last_synced_at: row.last_synced_at,
      ...(forStaff ? { paste_ratio: pasteRatio(row.text_typed, row.text_pasted), marks_awarded: row.marks_awarded } : {}),
      ...(!forStaff && attempt.status === 'graded' ? { marks_awarded: row.marks_awarded } : {}),
    }];
  });
};

const attemptPermittedUrls = async (attemptId: number) => {
  const links = unwrap(await database.from('assignment_permitted_url').select('permitted_url_id').eq('assignment_id', attemptId)) ?? [];
  if (!links.length) return [];

  return unwrap(await database
    .from('permitted_urls')
    .select('id, url')
    .in('id', links.map((link: { permitted_url_id: number }) => link.permitted_url_id))) ?? [];
};

// same shape as attemptPermittedUrls - frozen by start_attempt() alongside it, from the exam's,
// the student's and their group's app grants
const attemptPermittedApps = async (attemptId: number) => {
  const links = unwrap(await database.from('assignment_permitted_app').select('permitted_app_id').eq('assignment_id', attemptId)) ?? [];
  if (!links.length) return [];

  return unwrap(await database
    .from('permitted_apps')
    .select('id, name')
    .in('id', links.map((link: { permitted_app_id: number }) => link.permitted_app_id))) ?? [];
};

// Closes an attempt: marks every objective answer, stores the total and moves the status on.
// A flagged attempt keeps its status until a professor grades it, so the flag is not lost.
const finishAttempt = async (attempt: Attempt, exam: Exam, auto: boolean) => {
  const examQuestions = unwrap(await database.from('exam_question').select('question_id, marks').eq('exam_id', attempt.exam_id)) ?? [];
  const questionIds = examQuestions.map((row: { question_id: number }) => row.question_id);

  const questions = questionIds.length
    ? unwrap(await activeOnly(database.from('questions').select('id, question_type').in('id', questionIds))) ?? []
    : [];
  const objectiveIds = questions
    .filter((question: { question_type: string }) => !MANUAL_TYPES.includes(question.question_type))
    .map((question: { id: number }) => question.id);
  const hasManual = questions.some((question: { question_type: string }) => MANUAL_TYPES.includes(question.question_type));

  let awarded = 0;
  if (objectiveIds.length) {
    const correct = unwrap(await activeOnly(database
      .from('question_options')
      .select('id, question_id')
      .in('question_id', objectiveIds)
      .eq('is_correct', true))) ?? [];
    const chosen = unwrap(await database
      .from('question_assignment_option')
      .select('question_id, option_id')
      .eq('assignment_id', attempt.id)) ?? [];
    const marksById = new Map(examQuestions.map((row: { question_id: number; marks: number }) => [row.question_id, row.marks]));

    for (const questionId of objectiveIds) {
      const expected = correct.filter((option: { question_id: number }) => option.question_id === questionId).map((option: { id: number }) => option.id);
      const given = chosen.filter((option: { question_id: number }) => option.question_id === questionId).map((option: { option_id: number }) => option.option_id);
      // all or nothing on the option set; a question without a correct option can never be right
      const right = expected.length > 0 && expected.length === given.length && expected.every((id: number) => given.includes(id));
      const marks = right ? (marksById.get(questionId) as number) ?? 0 : 0;

      const { error } = await database
        .from('question_assignment')
        .update({ marks_awarded: marks })
        .eq('assignment_id', attempt.id)
        .eq('question_id', questionId);
      if (error) throw new Error(error.message);

      awarded += marks;
    }
  }

  const naturalStatus: AttemptStatus = hasManual ? (auto ? 'auto_submitted' : 'submitted') : 'graded';
  const submissionFields = { submitted_at: new Date().toISOString(), auto_submitted: auto, score: Math.min(awarded, exam.max_marks) };

  // guarded on the attempt's *current* DB status, not the possibly-stale `attempt` passed in - a
  // cheating/face-mismatch incident can flag the row in the window between when the caller first
  // read it and this write, and that flag must survive the submit, not get silently overwritten
  const settled = unwrap(await database
    .from('assignments')
    .update({ ...submissionFields, status: naturalStatus })
    .eq('id', attempt.id)
    .neq('status', 'flagged')
    .select(ATTEMPT_COLUMNS)) as Attempt[] | null;
  if (settled?.length) return settled[0];

  // already flagged by the time we got here - keep that status, still record the submission itself
  return unwrap(await database
    .from('assignments')
    .update(submissionFields)
    .eq('id', attempt.id)
    .select(ATTEMPT_COLUMNS)
    .single()) as Attempt;
};

// there is no cron: an attempt that ran out of time is closed by the next request that touches it
const ensureCurrent = async (attempt: Attempt, exam: Exam) =>
  isOpen(attempt) && Date.now() >= deadline(attempt, exam) ? finishAttempt(attempt, exam, true) : attempt;

// starting an exam whose attempt is still open picks it up where it was left (the app was
// closed, the connection dropped) instead of refusing a student who never got to submit
const resumeAttempt = async (studentId: number, attemptId: number) => {
  const { attempt, exam } = await loadOwnAttempt(studentId, attemptId);
  const current = await ensureCurrent(attempt, exam);
  if (!isOpen(current)) throw new HttpError(409, 'You have already completed this exam');

  return {
    ...studentSummary(current, exam),
    questions: await attemptQuestions(current, false),
    permitted_urls: await attemptPermittedUrls(current.id),
    permitted_apps: await attemptPermittedApps(current.id),
  };
};

export const startAttempt = async (studentId: number, body: { examId?: unknown }) => {
  const examId = parseId(body.examId);
  if (!examId) throw new HttpError(400, 'examId is required');

  const exam = await loadExam(examId);
  if (!(await sitsExam(exam, studentId))) throw new HttpError(404, 'Exam not found');

  // one attempt per student per exam is a unique constraint; an existing attempt is resumed as-is,
  // before the exam-window checks below - a professor-granted retake (allowRetake) reopens an
  // attempt whose exam window may since have closed, and resumeAttempt judges it by the attempt's
  // own deadline (unlimited for a retake), not the exam's
  const existing = unwrap(await database.from('student_assignment').select('assignment_id').eq('student_id', studentId).eq('exam_id', examId).maybeSingle()) as { assignment_id: number } | null;
  if (existing) return resumeAttempt(studentId, existing.assignment_id);

  if (!STARTABLE_EXAM_STATUSES.includes(exam.status)) throw new HttpError(400, `This exam is ${exam.status} and cannot be taken`);

  const now = Date.now();
  if (now < Date.parse(exam.scheduled_start)) throw new HttpError(400, 'This exam has not started yet');
  if (now >= Date.parse(exam.scheduled_end)) throw new HttpError(400, 'This exam is over');

  const examQuestions = unwrap(await database
    .from('exam_question')
    .select('question_id')
    .eq('exam_id', examId)) ?? [];
  const questions = examQuestions.length
    ? unwrap(await activeOnly(database
        .from('questions')
        .select('id, expected_duration, expected_duration_unit')
        .in('id', examQuestions.map((row: { question_id: number }) => row.question_id)))) ?? []
    : [];
  if (!questions.length) throw new HttpError(400, 'This exam has no questions yet');

  // the time the student gets: what the questions are expected to take, never past the end of the exam window
  const windowLeft = Math.floor((Date.parse(exam.scheduled_end) - now) / 1000);
  const expected = questions.reduce(
    (total: number, question: { expected_duration: number; expected_duration_unit: TimeUnit }) => total + toSeconds(question.expected_duration, question.expected_duration_unit),
    0
  );

  // the attempt, its student link, its questions in their attempt order and the permitted urls are
  // one transaction in the database (migrations/008_start_attempt.sql): a half started attempt is
  // unusable, and PostgREST cannot span four writes
  const { data, error } = await database.rpc('start_attempt', {
    param_student_id: studentId,
    param_exam_id: examId,
    param_session_duration: Math.min(expected || windowLeft, windowLeft),
    param_started_at: new Date(now).toISOString(),
  });
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'You have already started this exam');
    throw new Error(error.message);
  }
  const created = data as Attempt;

  return {
    ...studentSummary(created, exam),
    questions: await attemptQuestions(created, false),
    permitted_urls: await attemptPermittedUrls(created.id),
    permitted_apps: await attemptPermittedApps(created.id),
  };
};

export const listMyAttempts = async (studentId: number) => {
  const links = unwrap(await database.from('student_assignment').select('assignment_id').eq('student_id', studentId)) ?? [];
  if (!links.length) return [];

  const attempts = unwrap(await activeOnly(database
    .from('assignments')
    .select(ATTEMPT_COLUMNS)
    .in('id', links.map((link: { assignment_id: number }) => link.assignment_id))
    .order('id', { ascending: false }))) ?? [];
  if (!attempts.length) return [];

  const exams = unwrap(await activeOnly(database
    .from('exams')
    .select(EXAM_COLUMNS)
    .in('id', attempts.map((attempt: Attempt) => attempt.exam_id)))) ?? [];
  const examById = new Map(exams.map((exam: Exam) => [exam.id, exam]));

  return attempts.flatMap((attempt: Attempt) => {
    const exam = examById.get(attempt.exam_id) as Exam | undefined;
    return exam ? [studentSummary(attempt, exam)] : [];
  });
};

export const listExamAttempts = async (caller: Caller, query: { examId?: unknown; status?: unknown }) => {
  const examId = parseId(query.examId);
  if (!examId) throw new HttpError(400, 'examId is required');

  const status = query.status === undefined ? null : String(query.status);
  if (status && !ATTEMPT_STATUSES.includes(status as AttemptStatus)) throw new HttpError(400, `status must be one of ${ATTEMPT_STATUSES.join(', ')}`);

  const exam = await findVisibleExam(examId, caller, EXAM_COLUMNS) as Exam | null;
  if (!exam) throw new HttpError(404, 'Exam not found');

  let selection = activeOnly(database.from('assignments').select(ATTEMPT_COLUMNS).eq('exam_id', examId));
  if (status) selection = selection.eq('status', status);
  const attempts = unwrap(await selection.order('id').limit(ATTEMPT_LIMIT)) ?? [];
  if (!attempts.length) return [];

  const links = unwrap(await database
    .from('student_assignment')
    .select('student_id, assignment_id')
    .in('assignment_id', attempts.map((attempt: Attempt) => attempt.id))) ?? [];
  const students = links.length
    ? unwrap(await activeOnly(database
        .from('users')
        .select('id, first_name, last_name, email')
        .in('id', links.map((link: { student_id: number }) => link.student_id)))) ?? []
    : [];

  const studentIdByAttempt = new Map(links.map((link: { assignment_id: number; student_id: number }) => [link.assignment_id, link.student_id]));
  const studentById = new Map(students.map((student: { id: number }) => [student.id, student]));

  return attempts.map((attempt: Attempt) => staffSummary(attempt, exam, studentById.get(studentIdByAttempt.get(attempt.id) as number) ?? null));
};

// an attempt is "awaiting" once it's submitted but has no grade yet - mirrors AWAITING on the Attempts overview page
const AWAITING_STATUSES = new Set(['submitted', 'auto_submitted', 'flagged']);

// counts per exam for every exam the professor manages, in a fixed number of queries - the
// admin panel's Attempts overview used to call listExamAttempts once per exam to build this,
// which got slow once there were more than a handful (worse now that homework exams exist too)
export const listAttemptsSummary = async (professorId: number): Promise<{ exam_id: number; students: number; awaiting: number; graded: number }[]> => {
  const examIds = await managedExamIds(professorId);
  if (!examIds.length) return [];

  const counts = new Map(examIds.map((id) => [id, { exam_id: id, students: 0, awaiting: 0, graded: 0 }]));

  // "students" is who the exam was actually assigned to (exam_student), not who has started it -
  // that count is frozen per exam at assignment time, so an exam from before students joined the
  // class doesn't silently grow when the roster does later
  const assigned = unwrap(await database.from('exam_student').select('exam_id').in('exam_id', examIds)) ?? [];
  for (const row of assigned as { exam_id: number }[]) {
    const count = counts.get(row.exam_id);
    if (count) count.students += 1;
  };

  const rows = unwrap(await activeOnly(database.from('assignments').select('exam_id, status').in('exam_id', examIds))) ?? [];
  for (const row of rows as { exam_id: number; status: string }[]) {
    const count = counts.get(row.exam_id);
    if (!count) continue;
    if (AWAITING_STATUSES.has(row.status)) count.awaiting += 1;
    if (row.status === 'graded') count.graded += 1;
  };

  return [...counts.values()];
};

export const getAttempt = async (caller: Caller, attemptId: number | null) => {
  if (!attemptId) throw new HttpError(404, 'Attempt not found');

  if (caller.role === 'student') {
    const { attempt, exam } = await loadOwnAttempt(caller.id, attemptId);
    const current = await ensureCurrent(attempt, exam);

    return {
      ...studentSummary(current, exam),
      questions: await attemptQuestions(current, false),
      permitted_urls: await attemptPermittedUrls(current.id),
      permitted_apps: await attemptPermittedApps(current.id),
      // disclosed only when a professor explicitly chose to show this student what was
      // recorded against them - never by default, see setCheatingDisclosure below
      ...(current.cheating_disclosed ? { cheating_incidents: await incidentsForAttempt(current.id) } : {}),
    };
  }

  const { attempt, exam, studentId } = await loadStaffAttempt(caller, attemptId);
  const current = await ensureCurrent(attempt, exam);
  const questions = await attemptQuestions(current, true);
  const cachedReview = await loadCachedAiReview(current.id);

  return {
    ...staffSummary(current, exam, await loadStudent(studentId)),
    questions,
    completion: completionOf(questions),
    writing_profile: {
      ...computeWritingProfile(questions.map((q: any) => ({
        text_typed: q.text_typed,
        text_edited: q.text_edited,
        text_pasted: q.text_pasted,
        paste_events: q.paste_events,
        text_deleted: q.text_deleted,
        freeze_count: q.freeze_count,
        longest_freeze: q.longest_freeze,
        typing_duration_seconds: toSeconds(q.typing_duration, q.typing_duration_unit),
      }))),
      ai_probability: aiProbabilityOf(cachedReview?.cheating_likelihood),
    },
  };
};

// how much of the exam the student actually answered, independent of whether it was graded yet
// or whether any answer is right - a reference figure next to the staff's own marks
const completionOf = (questions: Array<{ answer: string; selected_option_ids: number[]; marks: number }>) => {
  const answered = questions.filter((q) => q.answer.trim() !== '' || q.selected_option_ids.length > 0);
  return {
    answered: answered.length,
    total: questions.length,
    marks_answered: answered.reduce((sum, q) => sum + q.marks, 0),
    marks_total: questions.reduce((sum, q) => sum + q.marks, 0),
  };
};

type AnswerInput = {
  questionId?: unknown;
  answer?: unknown;
  optionIds?: unknown;
  typingDuration?: unknown;
  typingDurationUnit?: unknown;
  textTyped?: unknown;
  textEdited?: unknown;
  textPasted?: unknown;
  pasteEvents?: unknown;
  textDeleted?: unknown;
  freezeCount?: unknown;
  longestFreeze?: unknown;
  startedAt?: unknown;
  answeredAt?: unknown;
};

const counter = (value: unknown, field: string) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new HttpError(400, `${field} must be a whole number of zero or more`);
  return value as number;
};

const timestamp = (value: unknown, field: string) => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(parsed)) throw new HttpError(400, `${field} must be a date`);
  return new Date(parsed).toISOString();
};

export const syncAnswers = async (studentId: number, attemptId: number | null, body: { answers?: unknown }) => {
  if (!attemptId) throw new HttpError(404, 'Attempt not found');

  const { attempt, exam } = await loadOwnAttempt(studentId, attemptId);
  const current = await ensureCurrent(attempt, exam);
  if (!isOpen(current)) {
    throw new HttpError(409, current.auto_submitted
      ? 'Time is up: this attempt has been submitted automatically'
      : 'This attempt is not in progress');
  }

  const answers = body.answers;
  if (!Array.isArray(answers) || !answers.length) throw new HttpError(400, 'answers must be a non-empty array');

  const rows = unwrap(await database.from('question_assignment').select('question_id').eq('assignment_id', current.id)) ?? [];
  const asked = new Set(rows.map((row: { question_id: number }) => row.question_id));

  // nothing is written before the whole batch is known to be valid
  const patches = (answers as AnswerInput[]).map((entry) => {
    const questionId = parseId(entry.questionId);
    if (!questionId) throw new HttpError(400, 'Each answer needs a questionId');
    if (!asked.has(questionId)) throw new HttpError(400, `Question ${questionId} is not part of this attempt`);

    const patch: Record<string, unknown> = { last_synced_at: new Date().toISOString() };

    if (entry.answer !== undefined) {
      if (typeof entry.answer !== 'string') throw new HttpError(400, 'answer must be a string');
      patch.answer = entry.answer;
    }
    if (entry.typingDuration !== undefined) patch.typing_duration = counter(entry.typingDuration, 'typingDuration');
    if (entry.typingDurationUnit !== undefined) {
      if (!TIME_UNITS.includes(entry.typingDurationUnit as TimeUnit)) throw new HttpError(400, `typingDurationUnit must be one of ${TIME_UNITS.join(', ')}`);
      patch.typing_duration_unit = entry.typingDurationUnit;
    }
    if (entry.textTyped !== undefined) patch.text_typed = counter(entry.textTyped, 'textTyped');
    if (entry.textEdited !== undefined) patch.text_edited = counter(entry.textEdited, 'textEdited');
    if (entry.textPasted !== undefined) patch.text_pasted = counter(entry.textPasted, 'textPasted');
    if (entry.pasteEvents !== undefined) patch.paste_events = counter(entry.pasteEvents, 'pasteEvents');
    if (entry.textDeleted !== undefined) patch.text_deleted = counter(entry.textDeleted, 'textDeleted');
    if (entry.freezeCount !== undefined) patch.freeze_count = counter(entry.freezeCount, 'freezeCount');
    if (entry.longestFreeze !== undefined) patch.longest_freeze = counter(entry.longestFreeze, 'longestFreeze');
    if (entry.startedAt !== undefined) patch.started_at = timestamp(entry.startedAt, 'startedAt');

    let optionIds: number[] | null = null;
    if (entry.optionIds !== undefined) {
      if (!Array.isArray(entry.optionIds)) throw new HttpError(400, 'optionIds must be an array');
      optionIds = entry.optionIds.map((value) => {
        const optionId = parseId(value);
        if (!optionId) throw new HttpError(400, 'optionIds must contain ids');
        return optionId;
      });
    }

    if (entry.answeredAt !== undefined) patch.answered_at = timestamp(entry.answeredAt, 'answeredAt');
    else if (entry.answer !== undefined || optionIds) patch.answered_at = new Date().toISOString();

    return { questionId, patch, optionIds };
  });

  // every chosen option has to belong to the question it was sent for
  const sent = patches.flatMap((patch) => patch.optionIds ?? []);
  if (sent.length) {
    const options = unwrap(await activeOnly(database.from('question_options').select('id, question_id').in('id', sent))) ?? [];
    const questionByOption = new Map(options.map((option: { id: number; question_id: number }) => [option.id, option.question_id]));

    for (const { questionId, optionIds } of patches) {
      for (const optionId of optionIds ?? []) {
        if (questionByOption.get(optionId) !== questionId) throw new HttpError(400, `Option ${optionId} does not belong to question ${questionId}`);
      }
    }
  }

  for (const { questionId, patch, optionIds } of patches) {
    const { error } = await database
      .from('question_assignment')
      .update(patch)
      .eq('assignment_id', current.id)
      .eq('question_id', questionId);
    if (error) throw new Error(error.message);

    if (!optionIds) continue;

    const { error: clearError } = await database
      .from('question_assignment_option')
      .delete()
      .eq('assignment_id', current.id)
      .eq('question_id', questionId);
    if (clearError) throw new Error(clearError.message);

    if (!optionIds.length) continue;

    const { error: optionError } = await database
      .from('question_assignment_option')
      .insert(optionIds.map((optionId) => ({ assignment_id: current.id, question_id: questionId, option_id: optionId })));
    if (optionError) throw new Error(optionError.message);
  }

  return { synced: patches.length, remaining_seconds: remainingSeconds(current, exam) };
};

// a `file_upload` question is answered by uploading a file instead of typing - the file's
// public URL becomes the answer, same column every other question type already writes to
export const uploadAnswerFile = async (
  studentId: number,
  attemptId: number | null,
  body: { questionId?: unknown; fileName?: unknown; fileData?: unknown }
) => {
  if (!attemptId) throw new HttpError(404, 'Attempt not found');

  const { attempt, exam } = await loadOwnAttempt(studentId, attemptId);
  const current = await ensureCurrent(attempt, exam);
  if (!isOpen(current)) {
    throw new HttpError(409, current.auto_submitted
      ? 'Time is up: this attempt has been submitted automatically'
      : 'This attempt is not in progress');
  }

  const questionId = parseId(body.questionId);
  if (!questionId) throw new HttpError(400, 'questionId is required');

  const asked = unwrap(await database
    .from('question_assignment')
    .select('question_id')
    .eq('assignment_id', current.id)
    .eq('question_id', questionId)
    .maybeSingle());
  if (!asked) throw new HttpError(400, `Question ${questionId} is not part of this attempt`);

  const question = unwrap(await activeOnly(database.from('questions').select('question_type').eq('id', questionId)).maybeSingle()) as { question_type: string } | null;
  if (question?.question_type !== 'file_upload') throw new HttpError(400, 'This question does not accept a file');

  const url = await uploadSubmissionFile(current.id, questionId, body.fileName, body.fileData);

  const { error } = await database
    .from('question_assignment')
    .update({ answer: url, answered_at: new Date().toISOString(), last_synced_at: new Date().toISOString() })
    .eq('assignment_id', current.id)
    .eq('question_id', questionId);
  if (error) throw new Error(error.message);

  return { url, remaining_seconds: remainingSeconds(current, exam) };
};

// a malformed/oversized timeline must never fail the submission itself - it's a nice-to-have
// chart for staff, not something the student's own exam result should ever depend on
const MAX_TIMELINE_POINTS = 500;
const parseTypingTimeline = (value: unknown): TypingTimelinePoint[] | null => {
  if (!Array.isArray(value) || value.length > MAX_TIMELINE_POINTS) return null;
  const points: TypingTimelinePoint[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { t, chars } = entry as Record<string, unknown>;
    if (!Number.isSafeInteger(t) || (t as number) < 0 || !Number.isSafeInteger(chars) || (chars as number) < 0) return null;
    points.push({ t: t as number, chars: chars as number });
  }
  return points;
};

export const submitAttempt = async (studentId: number, attemptId: number | null, body: { typingTimeline?: unknown } = {}) => {
  if (!attemptId) throw new HttpError(404, 'Attempt not found');

  const { attempt, exam } = await loadOwnAttempt(studentId, attemptId);
  if (!isOpen(attempt)) throw new HttpError(409, 'This attempt has already been submitted');

  const auto = Date.now() >= deadline(attempt, exam);
  let submitted = await finishAttempt(attempt, exam, auto);

  if (body.typingTimeline !== undefined) {
    const timeline = parseTypingTimeline(body.typingTimeline);
    if (timeline) {
      const updated = unwrap(await database
        .from('assignments')
        .update({ typing_timeline: timeline })
        .eq('id', submitted.id)
        .select(ATTEMPT_COLUMNS)
        .single()) as Attempt | null;
      if (updated) submitted = updated;
    }
  }

  // best-effort - the professor's "Run AI review" button is still there for a manual re-ask, but
  // the review is ready without anyone having to click it. Never let this slow down or fail the
  // student's own submission: no manual-type questions and no API key are both routine, not errors
  if (aiConfigured()) {
    void runAiReview(submitted, exam, false).catch((err) => {
      console.error(`ai review of attempt ${submitted.id} after submit failed:`, err instanceof Error ? err.message : err);
    });
  };

  return {
    attempt: studentSummary(submitted, exam),
    message: auto ? 'Time was up: this attempt has been submitted automatically' : 'Your answers have been submitted',
  };
};

export const gradeAttempt = async (professorId: number, attemptId: number | null, body: { marks?: unknown; score?: unknown; feedback?: unknown }) => {
  if (!attemptId) throw new HttpError(404, 'Attempt not found');

  const { attempt, exam, studentId } = await loadStaffAttempt({ id: professorId, role: 'professor' }, attemptId);
  const current = await ensureCurrent(attempt, exam);
  if (!current.submitted_at) throw new HttpError(409, 'This attempt has not been submitted yet');

  if (body.feedback !== undefined && body.feedback !== null && typeof body.feedback !== 'string') throw new HttpError(400, 'feedback must be a string');

  // one overall grade for the whole attempt instead of marking each manually-graded question on
  // its own - skips question_assignment entirely and sets the total directly
  if (body.score !== undefined) {
    if (!Number.isSafeInteger(body.score) || (body.score as number) < 0) throw new HttpError(400, 'score must be a whole number of zero or more');
    if ((body.score as number) > exam.max_marks) throw new HttpError(400, `score cannot exceed ${exam.max_marks}`);

    const graded = unwrap(await database
      .from('assignments')
      .update({
        score: body.score,
        status: 'graded',
        ...(body.feedback !== undefined ? { feedback: body.feedback } : {}),
      })
      .eq('id', current.id)
      .select(ATTEMPT_COLUMNS)
      .single()) as Attempt;

    if (studentId) void notify(studentId, 'exam_graded', 'Exam graded', `${exam.name}: ${graded.score}/${exam.max_marks}`, exam.id);
    return staffSummary(graded, exam, await loadStudent(studentId));
  };

  const marks = body.marks;
  if (marks !== undefined && !Array.isArray(marks)) throw new HttpError(400, 'marks must be an array');

  const examQuestions = unwrap(await database.from('exam_question').select('question_id, marks').eq('exam_id', current.exam_id)) ?? [];
  const questions = examQuestions.length
    ? unwrap(await activeOnly(database
        .from('questions')
        .select('id, question_type')
        .in('id', examQuestions.map((row: { question_id: number }) => row.question_id)))) ?? []
    : [];
  const manualIds = new Set(questions
    .filter((question: { question_type: string }) => MANUAL_TYPES.includes(question.question_type))
    .map((question: { id: number }) => question.id));
  const maxByQuestion = new Map(examQuestions.map((row: { question_id: number; marks: number }) => [row.question_id, row.marks]));

  const given = ((marks ?? []) as { questionId?: unknown; marks?: unknown }[]).map((entry) => {
    const questionId = parseId(entry.questionId);
    if (!questionId) throw new HttpError(400, 'Each mark needs a questionId');
    // only the questions a professor has to read are graded by hand
    if (!manualIds.has(questionId)) throw new HttpError(400, `Question ${questionId} is not graded by hand`);

    const value = entry.marks;
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new HttpError(400, 'marks must be a whole number of zero or more');
    const allowed = (maxByQuestion.get(questionId) as number) ?? 0;
    if ((value as number) > allowed) throw new HttpError(400, `Question ${questionId} is worth at most ${allowed} marks`);

    return { questionId, marks: value as number };
  });

  for (const entry of given) {
    const { error } = await database
      .from('question_assignment')
      .update({ marks_awarded: entry.marks })
      .eq('assignment_id', current.id)
      .eq('question_id', entry.questionId);
    if (error) throw new Error(error.message);
  }

  const awarded = unwrap(await database.from('question_assignment').select('marks_awarded').eq('assignment_id', current.id)) ?? [];
  const total = awarded.reduce((sum: number, row: { marks_awarded: number }) => sum + row.marks_awarded, 0);

  const graded = unwrap(await database
    .from('assignments')
    .update({
      score: Math.min(total, exam.max_marks),
      status: 'graded',
      ...(body.feedback !== undefined ? { feedback: body.feedback } : {}),
    })
    .eq('id', current.id)
    .select(ATTEMPT_COLUMNS)
    .single()) as Attempt;

  if (studentId) void notify(studentId, 'exam_graded', 'Exam graded', `${exam.name}: ${graded.score}/${exam.max_marks}`, exam.id);
  return staffSummary(graded, exam, await loadStudent(studentId));
};

// Reopens a finished attempt so the student can resubmit it - e.g. they ran out of time or the
// professor wants another shot after a dispute. Unlimited time, not just "resumed": a retake that
// still raced the clock would defeat the point of granting one. Reused answers/timeline are
// cleared since they belonged to the submission being redone, same as a fresh attempt would start.
export const allowRetake = async (professorId: number, attemptId: number | null) => {
  if (!attemptId) throw new HttpError(404, 'Attempt not found');

  const { attempt, exam, studentId } = await loadStaffAttempt({ id: professorId, role: 'professor' }, attemptId);
  const current = await ensureCurrent(attempt, exam);
  if (!RETAKEABLE_STATUSES.includes(current.status) || !current.submitted_at) {
    throw new HttpError(409, 'Only a submitted attempt can be reopened for a retake');
  }

  const { error: clearError } = await database
    .from('question_assignment')
    .update({
      answer: '',
      started_at: null,
      answered_at: null,
      last_synced_at: null,
      marks_awarded: 0,
      text_typed: 0,
      text_edited: 0,
      text_pasted: 0,
      paste_events: 0,
      text_deleted: 0,
      freeze_count: 0,
      longest_freeze: 0,
      typing_duration: 0,
    })
    .eq('assignment_id', current.id);
  if (clearError) throw new Error(clearError.message);

  const { error: clearOptionsError } = await database.from('question_assignment_option').delete().eq('assignment_id', current.id);
  if (clearOptionsError) throw new Error(clearOptionsError.message);

  const reopened = unwrap(await database
    .from('assignments')
    .update({
      status: 'in_progress',
      started_at: new Date().toISOString(),
      submitted_at: null,
      auto_submitted: false,
      unlimited_time: true,
      score: 0,
      feedback: null,
      typing_timeline: [],
    })
    .eq('id', current.id)
    .select(ATTEMPT_COLUMNS)
    .single()) as Attempt;

  if (studentId) void notify(studentId, 'retake_allowed', 'Retake allowed', `${exam.name}: you can resubmit this exam, with no time limit`, exam.id);
  return staffSummary(reopened, exam, await loadStudent(studentId));
};

// A student is never told an attempt was flagged, let alone shown the incidents behind it -
// that is staff business by default (see studentStatus above). This is the one deliberate
// opt-in: a professor who fails a student for cheating can choose to show exactly what was
// recorded, instead of leaving them guessing why they failed.
export const setCheatingDisclosure = async (professorId: number, attemptId: number | null, disclosed: boolean) => {
  if (!attemptId) throw new HttpError(404, 'Attempt not found');

  const { attempt, exam, studentId } = await loadStaffAttempt({ id: professorId, role: 'professor' }, attemptId);
  const current = await ensureCurrent(attempt, exam);

  const updated = unwrap(await database
    .from('assignments')
    .update({ cheating_disclosed: disclosed })
    .eq('id', current.id)
    .select(ATTEMPT_COLUMNS)
    .single()) as Attempt;

  return staffSummary(updated, exam, await loadStudent(studentId));
};

const loadCachedAiReview = async (assignmentId: number): Promise<AiReview | null> => {
  const overall = unwrap(await database
    .from('assignment_ai_review')
    .select('cheating_likelihood, cheating_reasoning')
    .eq('assignment_id', assignmentId)
    .maybeSingle()) as Pick<AiReview, 'cheating_likelihood' | 'cheating_reasoning'> | null;
  if (!overall) return null;

  const perQuestion = unwrap(await database
    .from('question_ai_review')
    .select('question_id, percent_correct, reasoning, writing_notes')
    .eq('assignment_id', assignmentId)) ?? [];

  return { ...overall, per_question: perQuestion as AiReview['per_question'] };
};

const storeAiReview = async (assignmentId: number, review: AiReview) => {
  const { error: overallError } = await database
    .from('assignment_ai_review')
    .upsert({
      assignment_id: assignmentId,
      cheating_likelihood: review.cheating_likelihood,
      cheating_reasoning: review.cheating_reasoning,
      updated_at: new Date().toISOString(),
    });
  if (overallError) throw new Error(overallError.message);

  const { error: deleteError } = await database.from('question_ai_review').delete().eq('assignment_id', assignmentId);
  if (deleteError) throw new Error(deleteError.message);

  if (review.per_question.length) {
    const { error: insertError } = await database.from('question_ai_review').insert(
      review.per_question.map((q) => ({
        assignment_id: assignmentId,
        question_id: q.question_id,
        percent_correct: q.percent_correct,
        reasoning: q.reasoning,
        writing_notes: q.writing_notes,
      }))
    );
    if (insertError) throw new Error(insertError.message);
  };
};

// shared by the professor-triggered endpoint below and the automatic run right after submit -
// never touches assignments/question_assignment, which is still entirely the professor's own
// call via gradeAttempt above. Cached after the first run; pass force to re-ask (e.g. the
// professor edited the question's model answer since)
const runAiReview = async (current: Attempt, exam: Exam, force: boolean): Promise<AiReview> => {
  if (!force) {
    const cached = await loadCachedAiReview(current.id);
    if (cached) return cached;
  };

  const questions = await attemptQuestions(current, true);
  const manual = (questions as any[]).filter((q) => AI_REVIEWABLE_TYPES.includes(q.question_type) && q.answer.trim() !== '');
  if (!manual.length) throw new HttpError(400, 'No answered short-answer or essay questions to review');

  // model_answers isn't part of the staff grading view above (that reads exam_question/questions
  // for the grading-relevant columns only) - one extra read for the one extra column this needs
  const modelAnswers = unwrap(await activeOnly(database
    .from('questions')
    .select('id, model_answers')
    .in('id', manual.map((q) => q.question_id)))) as { id: number; model_answers: string[] | null }[] ?? [];
  const modelAnswersById = new Map(modelAnswers.map((q) => [q.id, q.model_answers]));

  const incidents = await incidentsForAttempt(current.id);
  const incidentCounts: IncidentCount[] = Object.entries(
    incidents.reduce((acc, i) => ({ ...acc, [i.name]: (acc[i.name] ?? 0) + 1 }), {} as Record<string, number>)
  ).map(([name, count]) => ({ name, count }));

  const review = await reviewAnswers(manual.map((q) => ({
    question_id: q.question_id,
    question: q.question,
    model_answers: modelAnswersById.get(q.question_id) ?? null,
    answer: q.answer,
    max_marks: q.marks,
    typing_duration: q.typing_duration,
    text_typed: q.text_typed,
    text_pasted: q.text_pasted,
    paste_events: q.paste_events,
    text_edited: q.text_edited,
    text_deleted: q.text_deleted,
    freeze_count: q.freeze_count,
    longest_freeze: q.longest_freeze,
  })), incidentCounts);

  // the text-only pass already found this attempt at least "medium" - worth the extra vision
  // call to actually look at the proctoring photos before settling on a verdict
  const finalReview = (aiProbabilityOf(review.cheating_likelihood) ?? 0) >= 50
    ? await deepenReview(current.id, review, incidentCounts)
    : review;

  await storeAiReview(current.id, finalReview);
  return finalReview;
};

const deepenReview = async (attemptId: number, review: AiReview, incidents: IncidentCount[]): Promise<AiReview> => {
  const photos = await proctoringPhotosForAttempt(attemptId);
  if (!photos.length) return review;

  try {
    const deep = await deepReviewAnswers(review.cheating_reasoning, incidents, photos);
    return { ...review, cheating_likelihood: deep.cheating_likelihood, cheating_reasoning: deep.cheating_reasoning };
  } catch (error) {
    // the first-pass verdict is still a usable answer - a failed deep pass (timeout, API error)
    // shouldn't block the whole review
    console.error('Deep AI review failed, keeping the first-pass verdict:', error instanceof Error ? error.message : error);
    return review;
  };
};

export const aiReviewAttempt = async (professorId: number, attemptId: number | null, force = false): Promise<AiReview> => {
  if (!attemptId) throw new HttpError(404, 'Attempt not found');
  if (!aiConfigured()) throw new HttpError(503, 'AI review is not configured');

  const { attempt, exam } = await loadStaffAttempt({ id: professorId, role: 'professor' }, attemptId);
  const current = await ensureCurrent(attempt, exam);
  if (!current.submitted_at) throw new HttpError(409, 'This attempt has not been submitted yet');

  return runAiReview(current, exam, force);
};
