import { database } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { isUuid } from '../lib/uuid.js';
import { findAssignment, findOwnedAssignment, isEnrolled } from '../lib/access.js';
import { taskPriority, taskStatus } from '../lib/stats.js';

type AssignmentFields = {
  title?: string;
  description?: string;
  monitoring_level?: number;
  allowed_sources?: string[];
  due_date?: string;
  weight?: number;
  behavioral_audit?: boolean;
};

const assignmentNotFound = () => new HttpError(404, 'Assignment not found');

// a plain date (YYYY-MM-DD) is due at the end of that day (UTC)
const parseDueDate = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value);
  return isNaN(date.getTime()) ? null : date.toISOString();
};

const parseAssignmentFields = (body: Record<string, unknown>): AssignmentFields => {
  const fields: AssignmentFields = {};

  for (const key of ['title', 'description'] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'string' || !(body[key] as string).trim()) throw new HttpError(400, `${key} must be a non-empty string`);
      fields[key] = (body[key] as string).trim();
    };
  };

  if (body.monitoringLevel !== undefined) {
    if (![1, 2, 3].includes(body.monitoringLevel as number)) throw new HttpError(400, 'monitoringLevel must be 1, 2 or 3');
    fields.monitoring_level = body.monitoringLevel as number;
  };

  if (body.allowedSources !== undefined) {
    if (!Array.isArray(body.allowedSources) || body.allowedSources.some((s) => typeof s !== 'string' || !s.trim())) {
      throw new HttpError(400, 'allowedSources must be an array of non-empty strings');
    };
    fields.allowed_sources = [...new Set((body.allowedSources as string[]).map((s) => s.trim()))];
  };

  if (body.dueDate !== undefined) {
    const dueDate = parseDueDate(body.dueDate);
    if (!dueDate) throw new HttpError(400, 'dueDate must be a valid date');
    fields.due_date = dueDate;
  };

  if (body.weight !== undefined) {
    if (typeof body.weight !== 'number' || body.weight < 0 || body.weight > 100) throw new HttpError(400, 'weight must be a number between 0 and 100');
    fields.weight = body.weight;
  };

  if (body.behavioralAudit !== undefined) {
    if (typeof body.behavioralAudit !== 'boolean') throw new HttpError(400, 'behavioralAudit must be a boolean');
    fields.behavioral_audit = body.behavioralAudit;
  };

  return fields;
};

export const createAssignment = async (professorId: string, body: Record<string, unknown>) => {
  if (!isUuid(body.classId)) throw new HttpError(400, 'A valid classId is required');
  if (body.title === undefined || body.description === undefined || body.dueDate === undefined) {
    throw new HttpError(400, 'title, description and dueDate are required');
  };

  const fields = parseAssignmentFields(body);

  const { data: cls, error: classError } = await database
    .from('classes')
    .select('id')
    .eq('id', body.classId)
    .eq('professor_id', professorId)
    .maybeSingle();

  if (classError) throw new Error(classError.message);
  if (!cls) throw new HttpError(404, 'Class not found');

  const { data: assignment, error } = await database
    .from('assignments')
    .insert({ ...fields, class_id: cls.id, created_by: professorId })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return assignment;
};

// professor: assignments of own classes, student: assignments of enrolled classes
export const listAssignments = async (userId: string, role: string, classFilter: unknown) => {
  const isProfessor = role === 'professor';

  if (classFilter !== undefined && !isUuid(classFilter)) throw new HttpError(400, 'classId must be a valid id');

  let classIds: string[];
  if (isProfessor) {
    const { data, error } = await database.from('classes').select('id').eq('professor_id', userId);
    if (error) throw new Error(error.message);
    classIds = (data ?? []).map((row) => row.id);
  } else {
    const { data, error } = await database.from('enrollments').select('class_id').eq('student_id', userId);
    if (error) throw new Error(error.message);
    classIds = (data ?? []).map((row) => row.class_id);
  };

  if (classFilter !== undefined) {
    if (!classIds.includes(classFilter as string)) throw new HttpError(404, 'Class not found');
    classIds = [classFilter as string];
  };

  if (!classIds.length) return [];

  const { data: assignments, error } = await database
    .from('assignments')
    .select('*, class:classes(id, code, name)')
    .in('class_id', classIds)
    .order('due_date', { ascending: true });

  if (error) throw new Error(error.message);

  const assignmentIds = (assignments ?? []).map((assignment) => assignment.id);
  if (!assignmentIds.length) return [];

  if (isProfessor) {
    const { data: submissions, error: submissionsError } = await database
      .from('submissions')
      .select('assignment_id, status')
      .in('assignment_id', assignmentIds);

    if (submissionsError) throw new Error(submissionsError.message);

    return (assignments ?? []).map((assignment) => {
      const own = (submissions ?? []).filter((submission) => submission.assignment_id === assignment.id);
      return {
        ...assignment,
        submissions_count: own.length,
        pending_grading: own.filter((submission) => submission.status === 'pending_review').length,
      };
    });
  };

  const { data: mine, error: mineError } = await database
    .from('submissions')
    .select('assignment_id, status, grade')
    .eq('student_id', userId)
    .in('assignment_id', assignmentIds);

  if (mineError) throw new Error(mineError.message);

  return (assignments ?? []).map((assignment) => {
    const submission = (mine ?? []).find((row) => row.assignment_id === assignment.id);
    const status = taskStatus(submission, assignment.due_date);
    return {
      ...assignment,
      status,
      grade: submission?.grade ?? null,
      priority: taskPriority(status, assignment.due_date),
    };
  });
};

// professor: with stats, student: with own submission status
export const getAssignment = async (userId: string, role: string, assignmentId: string) => {
  if (!isUuid(assignmentId)) throw assignmentNotFound();
  const assignment = await findAssignment(assignmentId);
  if (!assignment) throw assignmentNotFound();

  const { professor_id, ...cls } = assignment.class;

  if (role === 'professor') {
    if (professor_id !== userId) throw assignmentNotFound();

    const { count: enrolled, error: enrolledError } = await database
      .from('enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', assignment.class_id);

    if (enrolledError) throw new Error(enrolledError.message);

    const { data: submissions, error: submissionsError } = await database
      .from('submissions')
      .select('status')
      .eq('assignment_id', assignmentId);

    if (submissionsError) throw new Error(submissionsError.message);

    const submitted = submissions?.length ?? 0;
    const pastDue = new Date(assignment.due_date) < new Date();

    return {
      assignment: { ...assignment, class: cls },
      stats: {
        enrolled: enrolled ?? 0,
        submitted,
        pending_grading: (submissions ?? []).filter((s) => s.status === 'pending_review').length,
        graded: (submissions ?? []).filter((s) => s.status === 'graded').length,
        lapsed: pastDue ? Math.max((enrolled ?? 0) - submitted, 0) : 0,
      },
    };
  };

  if (!(await isEnrolled(assignment.class_id, userId))) throw assignmentNotFound();

  const { data: submission, error } = await database
    .from('submissions')
    .select('status, grade, submitted_at')
    .eq('assignment_id', assignmentId)
    .eq('student_id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    assignment: { ...assignment, class: cls },
    status: taskStatus(submission ?? undefined, assignment.due_date),
    submission,
  };
};

export const updateAssignment = async (professorId: string, assignmentId: string, body: Record<string, unknown>) => {
  const assignment = await findOwnedAssignment(assignmentId, professorId);
  if (!assignment) throw assignmentNotFound();

  const fields = parseAssignmentFields(body);
  if (!Object.keys(fields).length) throw new HttpError(400, 'Nothing to update');

  const { data: updated, error } = await database
    .from('assignments')
    .update({ ...fields, updated_at: new Date() })
    .eq('id', assignment.id)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return updated;
};

export const deleteAssignment = async (professorId: string, assignmentId: string) => {
  const assignment = await findOwnedAssignment(assignmentId, professorId);
  if (!assignment) throw assignmentNotFound();

  const { error } = await database.from('assignments').delete().eq('id', assignment.id);
  if (error) throw new Error(error.message);
};
