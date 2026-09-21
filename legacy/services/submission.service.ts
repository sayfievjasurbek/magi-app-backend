import crypto from 'crypto';
import { database } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { isUuid } from '../lib/uuid.js';
import { findAssignment, findOwnedAssignment, isEnrolled } from '../lib/access.js';
import { computeIntegrityRisk, pasteRatio } from '../lib/integrity.js';
import { fullName, taskStatus } from '../lib/stats.js';

// request field -> column, all optional
const SCORE_FIELDS = {
  humanTypingScore: 'human_typing_score',
  volumeScore: 'volume_score',
  rhythmScore: 'rhythm_score',
  editingScore: 'editing_score',
  aiProbability: 'ai_probability',
} as const;

const COUNT_FIELDS = {
  sessionDurationSeconds: 'session_duration_seconds',
  activeTypingSeconds: 'active_typing_seconds',
  pausingSeconds: 'pausing_seconds',
  editingSeconds: 'editing_seconds',
  editCycles: 'edit_cycles',
  charactersTyped: 'characters_typed',
  pasteEvents: 'paste_events',
  charactersPasted: 'characters_pasted',
  correctionKeystrokes: 'correction_keystrokes',
} as const;

const MAX_RESEARCH_LOG_ENTRIES = 200;

type Dossier = Record<string, number | string | null | { title: string; url: string | null; visited_at: string | null }[]>;

const submissionNotFound = () => new HttpError(404, 'Submission not found');

const parseDossier = (input: Record<string, unknown>): Dossier => {
  const dossier: Dossier = {};

  for (const [key, column] of Object.entries(SCORE_FIELDS)) {
    if (input[key] === undefined) continue;
    const value = input[key];
    if (typeof value !== 'number' || value < 0 || value > 100) throw new HttpError(400, `dossier.${key} must be a number between 0 and 100`);
    dossier[column] = value;
  };

  for (const [key, column] of Object.entries(COUNT_FIELDS)) {
    if (input[key] === undefined) continue;
    const value = input[key];
    if (!Number.isInteger(value) || (value as number) < 0) throw new HttpError(400, `dossier.${key} must be a non-negative integer`);
    dossier[column] = value as number;
  };

  if (input.researchLog !== undefined) {
    if (!Array.isArray(input.researchLog) || input.researchLog.length > MAX_RESEARCH_LOG_ENTRIES) {
      throw new HttpError(400, `dossier.researchLog must be an array of at most ${MAX_RESEARCH_LOG_ENTRIES} entries`);
    };

    const log = [];
    for (const entry of input.researchLog) {
      if (!entry || typeof entry.title !== 'string' || !entry.title.trim()) {
        throw new HttpError(400, 'Every dossier.researchLog entry needs a title');
      };
      if (entry.visitedAt !== undefined && isNaN(new Date(entry.visitedAt).getTime())) {
        throw new HttpError(400, 'dossier.researchLog visitedAt must be a valid date');
      };
      log.push({
        title: entry.title.trim(),
        url: typeof entry.url === 'string' ? entry.url : null,
        visited_at: entry.visitedAt ? new Date(entry.visitedAt).toISOString() : null,
      });
    };
    dossier.research_log = log;
  };

  if (input.verdict !== undefined) {
    if (typeof input.verdict !== 'string') throw new HttpError(400, 'dossier.verdict must be a string');
    dossier.verdict = input.verdict;
  };

  return dossier;
};

const asNumber = (value: unknown) => (typeof value === 'number' ? value : null);

// student submits from the MAGI desktop app
export const submitAssignment = async (studentId: string, assignmentId: string, body: Record<string, unknown>) => {
  if (!isUuid(assignmentId)) throw new HttpError(404, 'Assignment not found');
  const assignment = await findAssignment(assignmentId);
  if (!assignment || !(await isEnrolled(assignment.class_id, studentId))) throw new HttpError(404, 'Assignment not found');

  if (new Date(assignment.due_date) < new Date()) throw new HttpError(400, 'The deadline for this assignment has passed');

  const { content, dossier: dossierInput } = body;
  if (typeof content !== 'string' || !content.trim()) throw new HttpError(400, 'Submission content is required');

  let dossier: Dossier = {};
  if (dossierInput === undefined) {
    if (assignment.behavioral_audit) throw new HttpError(400, 'This assignment requires a behavioral dossier');
  } else {
    if (typeof dossierInput !== 'object' || dossierInput === null || Array.isArray(dossierInput)) {
      throw new HttpError(400, 'dossier must be an object');
    };
    dossier = parseDossier(dossierInput as Record<string, unknown>);
  };

  const integrityRisk = computeIntegrityRisk({
    aiProbability: asNumber(dossier.ai_probability),
    humanTypingScore: asNumber(dossier.human_typing_score),
    pasteRatio: pasteRatio(asNumber(dossier.characters_typed), asNumber(dossier.characters_pasted)),
  });

  const contentHash = `sha256-${crypto.createHash('sha256').update(content).digest('hex')}`;
  const receiptId = `rcpt-${crypto.randomBytes(5).toString('hex')}`;

  const { data: submission, error } = await database
    .from('submissions')
    .insert({
      assignment_id: assignmentId,
      student_id: studentId,
      content,
      content_hash: contentHash,
      receipt_id: receiptId,
      integrity_risk: integrityRisk,
      ...dossier,
    })
    .select('receipt_id, content_hash, submitted_at, status')
    .single();

  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'You have already submitted this assignment');
    throw new Error(error.message);
  };

  return { ...submission, assignment_id: assignmentId };
};

// the student's own submission, without the dossier
export const getMySubmission = async (studentId: string, assignmentId: string) => {
  if (!isUuid(assignmentId)) throw submissionNotFound();

  const { data: submission, error } = await database
    .from('submissions')
    .select('receipt_id, content_hash, submitted_at, status, grade, feedback, graded_at')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!submission) throw submissionNotFound();

  return { ...submission, assignment_id: assignmentId };
};

// roster of an assignment: every enrolled student with their submission state
export const listSubmissions = async (professorId: string, assignmentId: string) => {
  const assignment = await findOwnedAssignment(assignmentId, professorId);
  if (!assignment) throw new HttpError(404, 'Assignment not found');

  const { data: enrollments, error: enrollmentsError } = await database
    .from('enrollments')
    .select('student:users(id, first_name, last_name, email)')
    .eq('class_id', assignment.class_id);

  if (enrollmentsError) throw new Error(enrollmentsError.message);

  const { data: submissions, error: submissionsError } = await database
    .from('submissions')
    .select('student_id, status, submitted_at, grade, integrity_risk')
    .eq('assignment_id', assignment.id);

  if (submissionsError) throw new Error(submissionsError.message);

  return ((enrollments ?? []) as unknown as {
    student: { id: string; first_name: string; last_name: string | null; email: string };
  }[]).map(({ student }) => {
    const submission = (submissions ?? []).find((row) => row.student_id === student.id);
    return {
      student_id: student.id,
      name: fullName(student),
      email: student.email,
      status: taskStatus(submission, assignment.due_date),
      submitted_at: submission?.submitted_at ?? null,
      integrity_risk: submission?.integrity_risk ?? null,
      grade: submission?.grade ?? null,
    };
  });
};

// full forensic dossier of one student's submission
export const getSubmission = async (professorId: string, assignmentId: string, studentId: string) => {
  const assignment = await findOwnedAssignment(assignmentId, professorId);
  if (!assignment || !isUuid(studentId)) throw submissionNotFound();

  const { data: row, error } = await database
    .from('submissions')
    .select('*, student:users!submissions_student_id_fkey(id, first_name, last_name, email)')
    .eq('assignment_id', assignment.id)
    .eq('student_id', studentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row) throw submissionNotFound();

  return {
    id: row.id,
    assignment_id: row.assignment_id,
    student: { ...row.student, name: fullName(row.student) },
    submitted_at: row.submitted_at,
    receipt_id: row.receipt_id,
    content_hash: row.content_hash,
    content: row.content,
    status: row.status,
    grade: row.grade,
    feedback: row.feedback,
    graded_at: row.graded_at,
    dossier: {
      human_typing_score: row.human_typing_score,
      session_duration_seconds: row.session_duration_seconds,
      edit_cycles: row.edit_cycles,
      sub_scores: {
        volume: row.volume_score,
        rhythm: row.rhythm_score,
        editing: row.editing_score,
      },
      writing_statistics: {
        characters_typed: row.characters_typed,
        paste_events: row.paste_events,
        characters_pasted: row.characters_pasted,
        correction_keystrokes: row.correction_keystrokes,
        paste_ratio: pasteRatio(row.characters_typed, row.characters_pasted),
        active_typing_seconds: row.active_typing_seconds,
        session_duration_seconds: row.session_duration_seconds,
      },
      timeline: {
        typing_seconds: row.active_typing_seconds,
        pausing_seconds: row.pausing_seconds,
        editing_seconds: row.editing_seconds,
      },
      ai_probability: row.ai_probability,
      research_log: row.research_log,
      verdict: row.verdict,
      integrity_risk: row.integrity_risk,
    },
  };
};

export const gradeSubmission = async (professorId: string, assignmentId: string, studentId: string, body: Record<string, unknown>) => {
  const assignment = await findOwnedAssignment(assignmentId, professorId);
  if (!assignment || !isUuid(studentId)) throw submissionNotFound();

  const { grade, feedback } = body;
  if (typeof grade !== 'number' || grade < 0 || grade > 100) throw new HttpError(400, 'grade must be a number between 0 and 100');
  if (feedback !== undefined && feedback !== null && typeof feedback !== 'string') throw new HttpError(400, 'feedback must be a string');

  const { data: graded, error } = await database
    .from('submissions')
    .update({
      status: 'graded',
      grade,
      feedback: feedback ?? null,
      graded_at: new Date(),
      graded_by: professorId,
    })
    .eq('assignment_id', assignment.id)
    .eq('student_id', studentId)
    .select('student_id, status, grade, feedback, graded_at');

  if (error) throw new Error(error.message);
  if (!graded?.length) throw submissionNotFound();

  return { ...graded[0], assignment_id: assignment.id };
};
