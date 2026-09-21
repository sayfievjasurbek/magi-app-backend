import { database } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { isUuid } from '../lib/uuid.js';
import { isEnrolled } from '../lib/access.js';
import { worstRisk } from '../lib/integrity.js';
import { average, countEnrollments, fullName } from '../lib/stats.js';

const CLASS_STATUSES = ['draft', 'synced', 'audited', 'pending_update'];

type ClassFields = {
  code?: string;
  name?: string;
  description?: string | null;
  cycle?: string | null;
  credits?: number | null;
  status?: string;
};

const classNotFound = () => new HttpError(404, 'Class not found');

const parseClassFields = (body: Record<string, unknown>): ClassFields => {
  const fields: ClassFields = {};

  if (body.code !== undefined) {
    if (typeof body.code !== 'string' || !body.code.trim()) throw new HttpError(400, 'Class code must be a non-empty string');
    fields.code = body.code.trim();
  };

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new HttpError(400, 'Class name must be a non-empty string');
    fields.name = body.name.trim();
  };

  for (const key of ['description', 'cycle'] as const) {
    if (body[key] !== undefined) {
      if (body[key] !== null && typeof body[key] !== 'string') throw new HttpError(400, `${key} must be a string`);
      fields[key] = body[key] as string | null;
    };
  };

  if (body.credits !== undefined) {
    if (body.credits !== null && (!Number.isInteger(body.credits) || (body.credits as number) < 1)) {
      throw new HttpError(400, 'credits must be a positive integer');
    };
    fields.credits = body.credits as number | null;
  };

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !CLASS_STATUSES.includes(body.status)) {
      throw new HttpError(400, `status must be one of: ${CLASS_STATUSES.join(', ')}`);
    };
    fields.status = body.status;
  };

  return fields;
};

// professor's own class, or null
const findOwnedClass = async (classId: string, professorId: string) => {
  if (!isUuid(classId)) return null;

  const { data, error } = await database
    .from('classes')
    .select('*')
    .eq('id', classId)
    .eq('professor_id', professorId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
};

export const createClass = async (professorId: string, body: Record<string, unknown>) => {
  const fields = parseClassFields(body);
  if (!fields.code || !fields.name) throw new HttpError(400, 'Class code and name are required');

  const { data: newClass, error } = await database
    .from('classes')
    .insert({ ...fields, professor_id: professorId })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'You already have a class with this code');
    throw new Error(error.message);
  };

  return newClass;
};

// professor: own classes, student: enrolled classes
export const listClasses = async (userId: string, role: string) => {
  if (role === 'professor') {
    const { data: classes, error } = await database
      .from('classes')
      .select('*')
      .eq('professor_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    const counts = await countEnrollments((classes ?? []).map((cls) => cls.id));
    return (classes ?? []).map((cls) => ({ ...cls, students: counts[cls.id] ?? 0 }));
  };

  const { data: enrolled, error: enrolledError } = await database
    .from('enrollments')
    .select('class_id')
    .eq('student_id', userId);

  if (enrolledError) throw new Error(enrolledError.message);

  const classIds = (enrolled ?? []).map((row) => row.class_id);
  if (!classIds.length) return [];

  const { data: classes, error } = await database
    .from('classes')
    .select('*, professor:users!classes_professor_id_fkey(id, first_name, last_name)')
    .in('id', classIds)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  const { data: grades, error: gradesError } = await database
    .from('submissions')
    .select('grade, assignment:assignments(class_id)')
    .eq('student_id', userId)
    .eq('status', 'graded');

  if (gradesError) throw new Error(gradesError.message);

  const gradesByClass: Record<string, number[]> = {};
  for (const row of (grades ?? []) as unknown as { grade: number; assignment: { class_id: string } }[]) {
    (gradesByClass[row.assignment.class_id] ??= []).push(row.grade);
  };

  return (classes ?? []).map((cls) => ({ ...cls, grade: average(gradesByClass[cls.id] ?? []) }));
};

// professor: roster with progress, student: class info
export const getClass = async (userId: string, role: string, classId: string) => {
  if (role === 'student') {
    if (!isUuid(classId) || !(await isEnrolled(classId, userId))) throw classNotFound();

    const { data: cls, error } = await database
      .from('classes')
      .select('*, professor:users!classes_professor_id_fkey(id, first_name, last_name)')
      .eq('id', classId)
      .single();

    if (error) throw new Error(error.message);
    return { class: cls };
  };

  const cls = await findOwnedClass(classId, userId);
  if (!cls) throw classNotFound();

  const { data: enrollments, error: enrollmentsError } = await database
    .from('enrollments')
    .select('student:users(id, first_name, last_name, email)')
    .eq('class_id', classId);

  if (enrollmentsError) throw new Error(enrollmentsError.message);

  const { data: assignments, error: assignmentsError } = await database
    .from('assignments')
    .select('id')
    .eq('class_id', classId);

  if (assignmentsError) throw new Error(assignmentsError.message);

  const assignmentIds = (assignments ?? []).map((assignment) => assignment.id);
  let submissions: { student_id: string; status: string; grade: number | null; integrity_risk: string | null }[] = [];

  if (assignmentIds.length) {
    const { data, error } = await database
      .from('submissions')
      .select('student_id, status, grade, integrity_risk')
      .in('assignment_id', assignmentIds);

    if (error) throw new Error(error.message);
    submissions = data ?? [];
  };

  const students = ((enrollments ?? []) as unknown as {
    student: { id: string; first_name: string; last_name: string | null; email: string };
  }[]).map(({ student }) => {
    const own = submissions.filter((submission) => submission.student_id === student.id);
    return {
      id: student.id,
      first_name: student.first_name,
      last_name: student.last_name,
      email: student.email,
      completed: own.length,
      total_assignments: assignmentIds.length,
      average_grade: average(own.filter((s) => s.grade !== null).map((s) => s.grade as number)),
      integrity_risk: worstRisk(own.map((submission) => submission.integrity_risk)),
    };
  });

  return {
    class: cls,
    students,
    stats: {
      enrollment: students.length,
      assignments: assignmentIds.length,
      average_grade: average(submissions.filter((s) => s.grade !== null).map((s) => s.grade as number)),
    },
  };
};

export const updateClass = async (professorId: string, classId: string, body: Record<string, unknown>) => {
  const cls = await findOwnedClass(classId, professorId);
  if (!cls) throw classNotFound();

  const fields = parseClassFields(body);
  if (!Object.keys(fields).length) throw new HttpError(400, 'Nothing to update');

  const { data: updated, error } = await database
    .from('classes')
    .update({ ...fields, updated_at: new Date() })
    .eq('id', cls.id)
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'You already have a class with this code');
    throw new Error(error.message);
  };

  return updated;
};

export const deleteClass = async (professorId: string, classId: string) => {
  const cls = await findOwnedClass(classId, professorId);
  if (!cls) throw classNotFound();

  const { error } = await database.from('classes').delete().eq('id', cls.id);
  if (error) throw new Error(error.message);
};

// enroll a student by email
export const addStudent = async (professorId: string, classId: string, body: Record<string, unknown>) => {
  const cls = await findOwnedClass(classId, professorId);
  if (!cls) throw classNotFound();

  const { email } = body;
  if (typeof email !== 'string' || !email.trim()) throw new HttpError(400, 'Student email is required');

  const { data: user, error: userError } = await database
    .from('users')
    .select('id, first_name, last_name, email')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle<{ id: string; first_name: string; last_name: string | null; email: string }>();

  if (userError) throw new Error(userError.message);
  if (!user) throw new HttpError(404, 'No user found with this email');

  const { data: role, error: roleError } = await database.rpc('get_user_role', { param_user_id: user.id });
  if (roleError) throw new Error(roleError.message);
  if (role !== 'student') throw new HttpError(400, 'This user is not a student');

  const { error } = await database.from('enrollments').insert({ class_id: cls.id, student_id: user.id });
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'Student is already enrolled in this class');
    throw new Error(error.message);
  };

  return { ...user, name: fullName(user) };
};

export const removeStudent = async (professorId: string, classId: string, studentId: string) => {
  const cls = await findOwnedClass(classId, professorId);
  if (!cls) throw classNotFound();

  const notEnrolled = () => new HttpError(404, 'Student is not enrolled in this class');
  if (!isUuid(studentId)) throw notEnrolled();

  const { data: removed, error } = await database
    .from('enrollments')
    .delete()
    .eq('class_id', cls.id)
    .eq('student_id', studentId)
    .select('student_id');

  if (error) throw new Error(error.message);
  if (!removed?.length) throw notEnrolled();
};
