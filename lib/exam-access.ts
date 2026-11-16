import { database } from './db.js';
import { activeOnly } from './utils.js';
import { type Role } from './types.js';

// who can see an exam and everything under it

export type Caller = { id: number; role: Role };
type ExamRow = { id: number; created_by?: number | null };

const unwrap = <T>({ data, error }: { data: T | null; error: { message: string } | null }): T | null => {
  if (error) throw new Error(error.message);
  return data;
};

// a professor manages the exams they created and the exams linked to a module they teach
export const managesExam = async (exam: ExamRow, professorId: number): Promise<boolean> => {
  if (exam.created_by === professorId) return true;

  const links = unwrap(await database.from('exam_module').select('module_id').eq('exam_id', exam.id)) ?? [];
  if (!links.length) return false;

  const taught = unwrap(await database
    .from('module_professor')
    .select('module_id')
    .eq('professor_id', professorId)
    .in('module_id', links.map((link: { module_id: number }) => link.module_id))
    .limit(1)) ?? [];
  return taught.length > 0;
};

export const examinesExam = async (exam: ExamRow, examinerId: number): Promise<boolean> => {
  const link = unwrap(await database
    .from('exam_examiner')
    .select('exam_id')
    .eq('exam_id', exam.id)
    .eq('examiner_id', examinerId)
    .maybeSingle());
  return link !== null;
};

export const sitsExam = async (exam: ExamRow, studentId: number): Promise<boolean> => {
  const link = unwrap(await database
    .from('exam_student')
    .select('exam_id')
    .eq('exam_id', exam.id)
    .eq('student_id', studentId)
    .maybeSingle());
  return link !== null;
};

export const seesExam = async (exam: ExamRow, user: Caller): Promise<boolean> => {
  if (user.role === 'professor') return managesExam(exam, user.id);
  if (user.role === 'examiner') return examinesExam(exam, user.id);
  return sitsExam(exam, user.id);
};

// the live exam this caller may see, or null: a soft deleted exam is gone for everybody
export const findVisibleExam = async (examId: number, user: Caller, columns: string = 'id, created_by'): Promise<any | null> => {
  const exam = unwrap(await activeOnly(database.from('exams').select(columns).eq('id', examId)).maybeSingle()) as ExamRow | null;
  if (!exam) return null;
  return (await seesExam(exam, user)) ? exam : null;
};

// the same rule as a list: what a professor manages is what they created plus what their modules carry
export const managedExamIds = async (professorId: number): Promise<number[]> => {
  const created = unwrap(await activeOnly(database.from('exams').select('id').eq('created_by', professorId))) ?? [];
  const ids = new Set<number>(created.map((exam: { id: number }) => exam.id));

  const taught = unwrap(await database.from('module_professor').select('module_id').eq('professor_id', professorId)) ?? [];
  if (!taught.length) return [...ids];

  const linked = unwrap(await database
    .from('exam_module')
    .select('exam_id')
    .in('module_id', taught.map((row: { module_id: number }) => row.module_id))) ?? [];
  const more = linked.map((row: { exam_id: number }) => row.exam_id).filter((examId: number) => !ids.has(examId));
  if (!more.length) return [...ids];

  // exam_module has no deleted_at of its own, so the exams behind the links are checked for it
  const live = unwrap(await activeOnly(database.from('exams').select('id').in('id', more))) ?? [];
  for (const exam of live) ids.add(exam.id);

  return [...ids];
};
