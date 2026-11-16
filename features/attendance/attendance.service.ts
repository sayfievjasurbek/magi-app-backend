import { database } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { parseId } from '../../lib/utils.js';
import { requireManagedModule } from '../modules/module.service.js';
import { type AttendanceEntry } from './attendance.entities.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const requireDateOnly = (value: unknown): string => {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, 'date must be YYYY-MM-DD');
  };
  return value;
};

const moduleStudentIds = async (moduleId: number): Promise<number[]> => {
  const { data, error } = await database.from('module_student').select('student_id').eq('module_id', moduleId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { student_id: number }) => row.student_id);
};

// whole roster, including students nobody marked yet
export const getAttendance = async (moduleIdParam: string, professorId: number, dateParam: unknown): Promise<AttendanceEntry[]> => {
  const date = requireDateOnly(dateParam);
  const managed = await requireManagedModule(moduleIdParam, professorId);

  const studentIds = await moduleStudentIds(managed.id);
  if (!studentIds.length) return [];

  const { data, error } = await database
    .from('attendance')
    .select('student_id, present')
    .eq('module_id', managed.id)
    .eq('date', date)
    .in('student_id', studentIds);
  if (error) throw new Error(error.message);

  const marked = new Map((data ?? []).map((row: { student_id: number; present: boolean }) => [row.student_id, row.present]));
  return studentIds.map((student_id) => ({ student_id, present: marked.get(student_id) ?? null }));
};

export const setAttendance = async (
  moduleIdParam: string,
  studentIdParam: string,
  professorId: number,
  body: any = {},
): Promise<AttendanceEntry> => {
  const date = requireDateOnly(body.date);
  if (typeof body.present !== 'boolean') throw new HttpError(400, 'present must be true or false');
  const managed = await requireManagedModule(moduleIdParam, professorId);
  const studentId = parseId(studentIdParam);
  if (!studentId) throw new HttpError(404, 'Student not found');

  const studentIds = await moduleStudentIds(managed.id);
  if (!studentIds.includes(studentId)) throw new HttpError(404, 'Student not found');

  const { data, error } = await database
    .from('attendance')
    .upsert(
      { module_id: managed.id, student_id: studentId, date, present: body.present, recorded_by: professorId, updated_at: new Date().toISOString() },
      { onConflict: 'module_id,student_id,date' },
    )
    .select('student_id, present')
    .single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Attendance row is null after upsert');
  return data;
};
