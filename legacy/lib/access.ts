import { database } from '../../lib/db.js';
import { isUuid } from './uuid.js';

export type AssignmentWithClass = {
  id: string;
  class_id: string;
  title: string;
  description: string;
  monitoring_level: number;
  allowed_sources: string[];
  due_date: string;
  weight: number;
  behavioral_audit: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  class: { id: string; code: string; name: string; professor_id: string };
};

export const findAssignment = async (id: string) => {
  const { data, error } = await database
    .from('assignments')
    .select('*, class:classes(id, code, name, professor_id)')
    .eq('id', id)
    .maybeSingle<AssignmentWithClass>();

  if (error) throw new Error(error.message);
  return data;
};

export const isEnrolled = async (classId: string, studentId: string) => {
  const { data, error } = await database
    .from('enrollments')
    .select('class_id')
    .eq('class_id', classId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return !!data;
};

// professor's assignment (must belong to one of their classes), or null
export const findOwnedAssignment = async (assignmentId: string, professorId: string) => {
  if (!isUuid(assignmentId)) return null;
  const assignment = await findAssignment(assignmentId);
  return assignment && assignment.class.professor_id === professorId ? assignment : null;
};
