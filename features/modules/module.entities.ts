// Modules domain: one type per table it owns, field for field from migrations/003_exam_schema.sql.

export type Module = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  reason: string | null;
};

export type ModuleProfessor = { module_id: number; professor_id: number };

export type ModuleStudent = { module_id: number; student_id: number };

// what the roster and the member lookup answer with, not a table of this domain
export type Person = { id: number; first_name: string; last_name: string | null; email: string };
