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

// The admin panel shows a "professor" position only their own teaching surface (classes they're
// linked to, for picking when creating an exam); anyone else - "administrator", "director",
// unset, or a custom typed-in position - manages the whole shared pool directly, not just what
// they personally created or were linked to. Mirrors DashboardShell's own POSITION_HREFS split.
export const seesAllModules = async (professorId: number): Promise<boolean> => (await positionOf(professorId)) !== 'professor';

export const isAdministrator = async (professorId: number): Promise<boolean> => (await positionOf(professorId)) === 'administrator';

// group/staff/roster management (creating or deleting a class, staffing it with professors or
// students) is the administrator's (or director's) job, not a plain professor's own teaching
// surface - DashboardShell's POSITION_HREFS already keeps a plain professor off the Groups page
// entirely; this is the same rule enforced server-side, since nothing else (an API client, Magi
// AI) is bound by that page's own routing
export const requireAdministrator = async (professorId: number, action: string): Promise<void> => {
  if (!(await seesAllModules(professorId))) throw new HttpError(403, `Only an administrator can ${action}`);
};

// the reverse: writing exam/question content, scheduling it, grading it - the professor's own
// teaching work - isn't the administrator's job either, even though their position otherwise
// manages everything structural; a director (or unset/custom position) is still unrestricted
export const requireNotAdministrator = async (professorId: number, action: string): Promise<void> => {
  if (await isAdministrator(professorId)) throw new HttpError(403, `An administrator cannot ${action} - that is the professor's own work`);
};

// same rule as listCreatedStudents/listCreatedProfessors, for a single id instead of a list -
// the by-:id routes (detail, update, delete, credentials) need this too, or any professor
// account could reach any student/professor's record by id alone
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
