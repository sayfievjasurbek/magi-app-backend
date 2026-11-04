import { database } from './db.js';

// The admin panel shows a "professor" position only their own teaching surface (classes they're
// linked to, for picking when creating an exam); anyone else - "administrator", "director",
// unset, or a custom typed-in position - manages the whole shared pool directly, not just what
// they personally created or were linked to. Mirrors DashboardShell's own POSITION_HREFS split.
export const seesAllModules = async (professorId: number): Promise<boolean> => {
  const { data, error } = await database
    .from('professors')
    .select('position')
    .eq('user_id', professorId)
    .maybeSingle<{ position: string | null }>();
  if (error) throw new Error(error.message);
  return (data?.position?.trim().toLowerCase() ?? '') !== 'professor';
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
