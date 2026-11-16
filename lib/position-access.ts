import { database } from './db.js';
import { HttpError } from './errors.js';

const positionOf = async (professorId: number): Promise<string> => {
  const { data, error } = await database
    .from('professors')
    .select('position')
    .eq('user_id', professorId)
    .maybeSingle<{ position: string | null }>();
  if (error) throw new Error(error.message);
  return data?.position?.trim().toLowerCase() ?? '';
};

// "professor" only sees their own classes, every other position manages everything
export const seesAllModules = async (professorId: number): Promise<boolean> => (await positionOf(professorId)) !== 'professor';

export const isAdministrator = async (professorId: number): Promise<boolean> => (await positionOf(professorId)) === 'administrator';

// creating/staffing groups is admin only (the nav hides it too, this is the real check)
export const requireAdministrator = async (professorId: number, action: string): Promise<void> => {
  if (!(await seesAllModules(professorId))) throw new HttpError(403, `Only an administrator can ${action}`);
};

// and the other way: admins don't write exams/questions or grade
export const requireNotAdministrator = async (professorId: number, action: string): Promise<void> => {
  if (await isAdministrator(professorId)) throw new HttpError(403, `An administrator cannot ${action} - that is the professor's own work`);
};

// same rule for the by-id routes
export const managesStudent = async (professorId: number, studentId: number): Promise<boolean> => {
  if (await seesAllModules(professorId)) return true;

  const { data: created, error: createdError } = await database
    .from('students')
    .select('user_id')
    .eq('user_id', studentId)
    .eq('created_by', professorId)
    .maybeSingle();
  if (createdError) throw new Error(createdError.message);
  if (created) return true;

  const { data: managed, error: managedError } = await database
    .from('module_professor')
    .select('module_id')
    .eq('professor_id', professorId);
  if (managedError) throw new Error(managedError.message);
  const moduleIds = (managed ?? []).map((row) => row.module_id);
  if (!moduleIds.length) return false;

  const { data: roster, error: rosterError } = await database
    .from('module_student')
    .select('student_id')
    .in('module_id', moduleIds)
    .eq('student_id', studentId)
    .maybeSingle();
  if (rosterError) throw new Error(rosterError.message);
  return roster !== null;
};

export const managesProfessor = async (professorId: number, otherProfessorId: number): Promise<boolean> => {
  if (professorId === otherProfessorId) return true;
  if (await seesAllModules(professorId)) return true;

  const { data: created, error: createdError } = await database
    .from('professors')
    .select('user_id')
    .eq('user_id', otherProfessorId)
    .eq('created_by', professorId)
    .maybeSingle();
  if (createdError) throw new Error(createdError.message);
  if (created) return true;

  const { data: managed, error: managedError } = await database
    .from('module_professor')
    .select('module_id')
    .eq('professor_id', professorId);
  if (managedError) throw new Error(managedError.message);
  const moduleIds = (managed ?? []).map((row) => row.module_id);
  if (!moduleIds.length) return false;

  const { data: coTaught, error: coTaughtError } = await database
    .from('module_professor')
    .select('professor_id')
    .in('module_id', moduleIds)
    .eq('professor_id', otherProfessorId)
    .maybeSingle();
  if (coTaughtError) throw new Error(coTaughtError.message);
  return coTaught !== null;
};
