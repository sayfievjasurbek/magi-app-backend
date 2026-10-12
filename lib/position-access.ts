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
