import { database } from '../../lib/db.js';
import { average, countEnrollments, taskPriority, taskStatus } from '../lib/stats.js';

const MAX_DASHBOARD_ASSIGNMENTS = 20;

export const professorDashboard = async (professorId: string) => {
  const { data: classes, error } = await database
    .from('classes')
    .select('id, code, name, status')
    .eq('professor_id', professorId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  const classIds = (classes ?? []).map((cls) => cls.id);
  const counts = await countEnrollments(classIds);

  let assignments: { id: string; title: string; due_date: string; class: { id: string; code: string; name: string } }[] = [];
  let submissions: { assignment_id: string; status: string; integrity_risk: string | null }[] = [];

  if (classIds.length) {
    const { data, error: assignmentsError } = await database
      .from('assignments')
      .select('id, title, due_date, class:classes(id, code, name)')
      .in('class_id', classIds)
      .order('due_date', { ascending: false });

    if (assignmentsError) throw new Error(assignmentsError.message);
    assignments = (data ?? []) as unknown as typeof assignments;
  };

  if (assignments.length) {
    const { data, error: submissionsError } = await database
      .from('submissions')
      .select('assignment_id, status, integrity_risk')
      .in('assignment_id', assignments.map((assignment) => assignment.id));

    if (submissionsError) throw new Error(submissionsError.message);
    submissions = data ?? [];
  };

  return {
    metrics: {
      active_classes: classes?.length ?? 0,
      enrolled_students: Object.values(counts).reduce((sum, count) => sum + count, 0),
      unmarked_submissions: submissions.filter((s) => s.status === 'pending_review').length,
      integrity_flags: submissions.filter((s) => s.integrity_risk === 'medium' || s.integrity_risk === 'high').length,
    },
    classes: (classes ?? []).map((cls) => ({ ...cls, students: counts[cls.id] ?? 0 })),
    assignments: assignments.slice(0, MAX_DASHBOARD_ASSIGNMENTS).map((assignment) => {
      const own = submissions.filter((submission) => submission.assignment_id === assignment.id);
      return {
        ...assignment,
        submissions_count: own.length,
        pending_grading: own.filter((submission) => submission.status === 'pending_review').length,
      };
    }),
  };
};

export const studentDashboard = async (studentId: string) => {
  const { data: enrolled, error } = await database
    .from('enrollments')
    .select('class_id')
    .eq('student_id', studentId);

  if (error) throw new Error(error.message);

  const classIds = (enrolled ?? []).map((row) => row.class_id);

  let classes: { id: string; code: string; name: string; credits: number | null; professor: { id: string; first_name: string; last_name: string | null } }[] = [];
  let assignments: { id: string; title: string; due_date: string; class_id: string }[] = [];
  let submissions: { assignment_id: string; status: string; grade: number | null }[] = [];

  if (classIds.length) {
    const { data, error: classesError } = await database
      .from('classes')
      .select('id, code, name, credits, professor:users!classes_professor_id_fkey(id, first_name, last_name)')
      .in('id', classIds);

    if (classesError) throw new Error(classesError.message);
    classes = (data ?? []) as unknown as typeof classes;

    const { data: assignmentRows, error: assignmentsError } = await database
      .from('assignments')
      .select('id, title, due_date, class_id')
      .in('class_id', classIds);

    if (assignmentsError) throw new Error(assignmentsError.message);
    assignments = assignmentRows ?? [];
  };

  if (assignments.length) {
    const { data, error: submissionsError } = await database
      .from('submissions')
      .select('assignment_id, status, grade')
      .eq('student_id', studentId)
      .in('assignment_id', assignments.map((assignment) => assignment.id));

    if (submissionsError) throw new Error(submissionsError.message);
    submissions = data ?? [];
  };

  const classById = new Map(classes.map((cls) => [cls.id, cls]));
  const assignmentById = new Map(assignments.map((assignment) => [assignment.id, assignment]));

  const gradesByClass: Record<string, number[]> = {};
  for (const submission of submissions) {
    const classId = assignmentById.get(submission.assignment_id)?.class_id;
    if (classId && submission.grade !== null) (gradesByClass[classId] ??= []).push(submission.grade);
  };

  const tasks = assignments.map((assignment) => {
    const submission = submissions.find((row) => row.assignment_id === assignment.id);
    const status = taskStatus(submission, assignment.due_date);
    const cls = classById.get(assignment.class_id);
    return {
      id: assignment.id,
      title: assignment.title,
      class: cls ? { id: cls.id, code: cls.code, name: cls.name } : null,
      due_date: assignment.due_date,
      status,
      grade: submission?.grade ?? null,
      priority: taskPriority(status, assignment.due_date),
    };
  });

  // open work first (earliest deadline first), graded work last
  tasks.sort((a, b) => {
    if ((a.status === 'graded') !== (b.status === 'graded')) return a.status === 'graded' ? 1 : -1;
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  });

  return {
    metrics: {
      enrolled_classes: classes.length,
      average_grade: average(submissions.filter((s) => s.grade !== null).map((s) => s.grade as number)),
      submissions_made: { submitted: submissions.length, total: assignments.length },
      pending_deadlines: tasks.filter((task) => task.status === 'not_started').length,
    },
    courses: classes.map((cls) => ({
      id: cls.id,
      code: cls.code,
      name: cls.name,
      credits: cls.credits,
      professor: cls.professor,
      grade: average(gradesByClass[cls.id] ?? []),
    })),
    tasks,
  };
};
