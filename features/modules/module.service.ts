import { database } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { activeOnly, parseId, softDelete } from '../../lib/utils.js';
import { type Role } from '../../lib/types.js';
import { notify } from '../../lib/notifications.js';
import { seesAllModules } from '../../lib/position-access.js';

type Person = { id: number; first_name: string; last_name: string | null; email: string };

const moduleNotFound = () => new HttpError(404, 'Module not found');

const parseName = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'Module name is required');

  const name = value.trim();
  if (name.length > 100) throw new HttpError(400, 'Module name must be at most 100 characters');
  return name;
};

const parseReason = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'reason must be a non-empty string');
  return value.trim();
};

// class names read as duplicates to an admin even if the casing differs ("Class2" vs "class2"),
// so this is a case-insensitive exact match - excludeId lets a rename keep its own current name
const requireUniqueName = async (name: string, excludeId?: number) => {
  let query = activeOnly(database.from('modules').select('id').ilike('name', name));
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.limit(1);
  if (error) throw new Error(error.message);
  if (data?.length) throw new HttpError(409, `A class named "${name}" already exists`);
};

// module the professor manages, or null - someone who sees all modules (not a plain "professor"
// position) manages every one of them directly, not just the ones they're linked to
const findManagedModule = async (moduleId: number, professorId: number) => {
  if (!(await seesAllModules(professorId))) {
    const { data: managed, error: managedError } = await database
      .from('module_professor')
      .select('module_id')
      .eq('module_id', moduleId)
      .eq('professor_id', professorId)
      .maybeSingle();

    if (managedError) throw new Error(managedError.message);
    if (!managed) return null;
  };

  const { data, error } = await activeOnly(database.from('modules').select('*').eq('id', moduleId)).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
};

const requireManagedModule = async (moduleIdParam: string, professorId: number) => {
  const moduleId = parseId(moduleIdParam);
  if (!moduleId) throw moduleNotFound();

  const managed = await findManagedModule(moduleId, professorId);
  if (!managed) throw moduleNotFound();
  return managed;
};

// the module a student is enrolled in, or 404 - also covers a module soft deleted after they
// enrolled (deleteModule doesn't clean up module_student rows)
const requireEnrolledModule = async (moduleIdParam: string, studentId: number) => {
  const moduleId = parseId(moduleIdParam);
  if (!moduleId) throw moduleNotFound();

  const { data: enrolled, error: enrolledError } = await database
    .from('module_student')
    .select('module_id')
    .eq('module_id', moduleId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (enrolledError) throw new Error(enrolledError.message);
  if (!enrolled) throw moduleNotFound();

  const { data, error } = await activeOnly(database.from('modules').select('*').eq('id', moduleId)).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw moduleNotFound();
  return data;
};

const managedModuleIds = async (professorId: number): Promise<number[]> => {
  const { data, error } = await database
    .from('module_professor')
    .select('module_id')
    .eq('professor_id', professorId);

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.module_id);
};

const allModuleIds = async (): Promise<number[]> => {
  const { data, error } = await activeOnly(database.from('modules').select('id'));
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.id);
};

const enrolledModuleIds = async (studentId: number): Promise<number[]> => {
  const { data, error } = await database
    .from('module_student')
    .select('module_id')
    .eq('student_id', studentId);

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.module_id);
};

const listModulesByIds = async (moduleIds: number[]) => {
  const { data, error } = await activeOnly(database.from('modules').select('*').in('id', moduleIds))
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
};

// a soft-deleted student keeps their module_student row (deleteStudent never cleans it up), so a
// raw count would disagree with the roster/rating, which both filter to active users
const countStudents = async (moduleIds: number[]): Promise<Record<number, number>> => {
  const { data, error } = await database
    .from('module_student')
    .select('module_id, student_id')
    .in('module_id', moduleIds);

  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const studentIds = [...new Set(rows.map((row) => row.student_id))];
  const { data: activeUsers, error: activeError } = studentIds.length
    ? await activeOnly(database.from('users').select('id').in('id', studentIds))
    : { data: [] as { id: number }[], error: null };
  if (activeError) throw new Error(activeError.message);
  const activeIds = new Set((activeUsers ?? []).map((u) => u.id));

  const counts: Record<number, number> = {};
  for (const row of rows) {
    if (!activeIds.has(row.student_id)) continue;
    counts[row.module_id] = (counts[row.module_id] ?? 0) + 1;
  };
  return counts;
};

// the class detail page's "average age" stat - null students (nobody enrolled, or none of them
// have an age on file) read as "unknown" rather than a misleading 0
const averageAgeForModule = async (moduleId: number): Promise<number | null> => {
  const { data: rows, error } = await database.from('module_student').select('student_id').eq('module_id', moduleId);
  if (error) throw new Error(error.message);
  const studentIds = (rows ?? []).map((row) => row.student_id);
  if (!studentIds.length) return null;

  const { data: ages, error: agesError } = await database.from('students').select('age').in('user_id', studentIds);
  if (agesError) throw new Error(agesError.message);
  const known = (ages ?? []).map((row) => row.age).filter((age): age is number => age !== null && age !== undefined);
  if (!known.length) return null;

  return Math.round((known.reduce((sum, age) => sum + age, 0) / known.length) * 10) / 10;
};

// one bounded query to attach each roster student's age, instead of folding it into listPeople
// (which also resolves professors, who don't have an age column at all)
const studentAgesById = async (studentIds: number[]): Promise<Map<number, number | null>> => {
  if (!studentIds.length) return new Map();
  const { data, error } = await database.from('students').select('user_id, age').in('user_id', studentIds);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [row.user_id, row.age]));
};

// every professor on each module, for the Classes list (shows the first one plus a "+N more"
// count rather than nobody at all - a class can have several, same as a student can be in several)
const professorsByModule = async (moduleIds: number[]): Promise<Record<number, Person[]>> => {
  const { data, error } = await database
    .from('module_professor')
    .select('module_id, professor_id')
    .in('module_id', moduleIds);
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const people = await listPeople([...new Set(rows.map((row) => row.professor_id))]);
  const personById = new Map(people.map((p) => [p.id, p]));

  const byModule: Record<number, Person[]> = {};
  for (const row of rows) {
    const person = personById.get(row.professor_id);
    if (!person) continue;
    (byModule[row.module_id] ??= []).push(person);
  };
  return byModule;
};

const listPeople = async (userIds: number[]): Promise<Person[]> => {
  if (!userIds.length) return [];

  const { data, error } = await activeOnly(
    database.from('users').select('id, first_name, last_name, email').in('id', userIds)
  );

  if (error) throw new Error(error.message);
  return (data ?? []) as Person[];
};

// the member is named by email or by id, and has to carry the role of the list it is added to
const findMember = async (body: Record<string, unknown>, idField: string, roleTable: string, role: Role) => {
  let query = activeOnly(database.from('users').select('id, first_name, last_name, email'));

  if (body.email !== undefined) {
    if (typeof body.email !== 'string' || !body.email.trim()) throw new HttpError(400, 'email must be a non-empty string');
    query = query.eq('email', body.email.trim().toLowerCase());
  } else {
    const userId = parseId(body[idField]);
    if (!userId) throw new HttpError(400, `email or ${idField} is required`);
    query = query.eq('id', userId);
  };

  const { data: user, error } = await query.maybeSingle<Person>();
  if (error) throw new Error(error.message);
  if (!user) throw new HttpError(404, 'User not found');

  const { data: hasRole, error: roleError } = await database
    .from(roleTable)
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (roleError) throw new Error(roleError.message);
  if (!hasRole) throw new HttpError(400, `This user is not a ${role}`);

  return user;
};

export const createModule = async (professorId: number, body: Record<string, unknown>) => {
  const name = parseName(body.name);
  await requireUniqueName(name);

  const { data: newModule, error } = await database
    .from('modules')
    .insert({ name })
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  // only an account that actually teaches (position "professor") is linked as a mentor here - an
  // administrator/director creating a group already manages every module via seesAllModules, and
  // isn't one of its mentors just for having set it up
  if (!(await seesAllModules(professorId))) {
    const { error: linkError } = await database
      .from('module_professor')
      .insert({ module_id: newModule.id, professor_id: professorId });

    // the two writes are not one transaction: a module nobody manages is worse than no module
    if (linkError) {
      await database.from('modules').delete().eq('id', newModule.id);
      throw new Error(linkError.message);
    };
  };

  return newModule;
};

// professor: modules they manage with their student count, student: modules they are enrolled in
export const listModules = async (userId: number, role: Role) => {
  if (role === 'professor') {
    const moduleIds = (await seesAllModules(userId)) ? await allModuleIds() : await managedModuleIds(userId);
    if (!moduleIds.length) return [];

    const modules = await listModulesByIds(moduleIds);
    const counts = await countStudents(moduleIds);
    const professors = await professorsByModule(moduleIds);
    return modules.map((row) => ({ ...row, student_count: counts[row.id] ?? 0, professors: professors[row.id] ?? [] }));
  };

  const moduleIds = await enrolledModuleIds(userId);
  if (!moduleIds.length) return [];

  return listModulesByIds(moduleIds);
};

// a professor looking up which modules one student belongs to - the Students detail page in
// the admin panel, not scoped to modules this professor manages (same broad visibility as
// looking up that student's credentials)
export const getStudentModules = async (studentIdParam: string) => {
  const studentId = parseId(studentIdParam);
  if (!studentId) return [];

  const moduleIds = await enrolledModuleIds(studentId);
  if (!moduleIds.length) return [];

  return listModulesByIds(moduleIds);
};

// same, for the Professors detail page - which groups a given professor is attached to
export const getProfessorModules = async (professorIdParam: string) => {
  const professorId = parseId(professorIdParam);
  if (!professorId) return [];

  const moduleIds = await managedModuleIds(professorId);
  if (!moduleIds.length) return [];

  return listModulesByIds(moduleIds);
};

// a professor sees any module they manage (or every one, if their position isn't scoped), a
// student only one they're enrolled in - both get the same shape back: the module with its
// student count and its mentors, for the class detail page
export const getModule = async (userId: number, role: Role, moduleIdParam: string) => {
  const managed = role === 'professor' ? await requireManagedModule(moduleIdParam, userId) : await requireEnrolledModule(moduleIdParam, userId);

  const counts = await countStudents([managed.id]);
  const professors = await professorsByModule([managed.id]);
  const averageAge = await averageAgeForModule(managed.id);
  return { ...managed, student_count: counts[managed.id] ?? 0, professors: professors[managed.id] ?? [], average_age: averageAge };
};

// every member's total score across this module's own graded exams, highest first - a
// professor sees any module they manage, a student only one they are enrolled in
export const getModuleRating = async (userId: number, role: Role, moduleIdParam: string) => {
  const moduleId =
    role === 'professor' ? (await requireManagedModule(moduleIdParam, userId)).id : (await requireEnrolledModule(moduleIdParam, userId)).id;

  const { data: members, error: membersError } = await database.from('module_student').select('student_id').eq('module_id', moduleId);
  if (membersError) throw new Error(membersError.message);
  const memberIds = (members ?? []).map((row) => row.student_id);
  if (!memberIds.length) return [];

  const { data: examLinks, error: examLinksError } = await database.from('exam_module').select('exam_id').eq('module_id', moduleId);
  if (examLinksError) throw new Error(examLinksError.message);
  const examIds = (examLinks ?? []).map((row) => row.exam_id);

  const totals = new Map<number, number>(memberIds.map((id) => [id, 0]));
  if (examIds.length) {
    const { data: links, error: linksError } = await database
      .from('student_assignment')
      .select('student_id, assignment_id')
      .in('student_id', memberIds)
      .in('exam_id', examIds);
    if (linksError) throw new Error(linksError.message);

    const assignmentIds = (links ?? []).map((row) => row.assignment_id);
    if (assignmentIds.length) {
      const { data: graded, error: gradedError } = await database
        .from('assignments')
        .select('id, score')
        .in('id', assignmentIds)
        .eq('status', 'graded');
      if (gradedError) throw new Error(gradedError.message);

      const scoreByAssignment = new Map((graded ?? []).map((row) => [row.id, row.score as number]));
      for (const link of links ?? []) {
        const score = scoreByAssignment.get(link.assignment_id);
        if (score === undefined) continue;
        totals.set(link.student_id, (totals.get(link.student_id) ?? 0) + score);
      };
    };
  };

  const { data: users, error: usersError } = await activeOnly(
    database.from('users').select('id, first_name, last_name, email').in('id', memberIds)
  );
  if (usersError) throw new Error(usersError.message);
  const userById = new Map((users ?? []).map((u) => [u.id, u]));

  return memberIds
    .map((id) => ({ student: userById.get(id), total_score: totals.get(id) ?? 0 }))
    .filter((row): row is { student: NonNullable<typeof row.student>; total_score: number } => !!row.student)
    .sort((a, b) => b.total_score - a.total_score);
};

// professors and students of the module - a professor sees any module they manage, a student
// their own classmates and mentors for a class they're enrolled in
export const getRoster = async (userId: number, role: Role, moduleIdParam: string) => {
  const managed = role === 'professor' ? await requireManagedModule(moduleIdParam, userId) : await requireEnrolledModule(moduleIdParam, userId);

  const { data: professorRows, error: professorsError } = await database
    .from('module_professor')
    .select('professor_id')
    .eq('module_id', managed.id);

  if (professorsError) throw new Error(professorsError.message);

  const { data: studentRows, error: studentsError } = await database
    .from('module_student')
    .select('student_id, created_at')
    .eq('module_id', managed.id);

  if (studentsError) throw new Error(studentsError.message);

  const professors = await listPeople((professorRows ?? []).map((row) => row.professor_id));
  const students = await listPeople((studentRows ?? []).map((row) => row.student_id));
  const ages = await studentAgesById(students.map((s) => s.id));
  const enrolledAtById = new Map((studentRows ?? []).map((row) => [row.student_id, row.created_at]));

  return {
    professors,
    students: students.map((s) => ({ ...s, age: ages.get(s.id) ?? null, enrolled_at: enrolledAtById.get(s.id) ?? null })),
  };
};

export const updateModule = async (professorId: number, moduleIdParam: string, body: Record<string, unknown>) => {
  const managed = await requireManagedModule(moduleIdParam, professorId);
  const name = parseName(body.name);
  await requireUniqueName(name, managed.id);

  const { data: updated, error } = await database
    .from('modules')
    .update({ name })
    .eq('id', managed.id)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return updated;
};

// deleting a class is an administrator action, same as creating one - a plain professor position
// manages their own teaching surface (roster, exams), not whether the class itself exists
export const deleteModule = async (professorId: number, moduleIdParam: string, body: Record<string, unknown>) => {
  const managed = await requireManagedModule(moduleIdParam, professorId);
  if (!(await seesAllModules(professorId))) throw new HttpError(403, 'Only an administrator can delete a class');
  const reason = parseReason(body.reason);

  const { error } = await database.from('modules').update(softDelete(reason)).eq('id', managed.id);
  if (error) throw new Error(error.message);
};

export const addProfessor = async (professorId: number, moduleIdParam: string, body: Record<string, unknown>) => {
  const managed = await requireManagedModule(moduleIdParam, professorId);
  const professor = await findMember(body, 'professorId', 'professors', 'professor');

  const { error } = await database
    .from('module_professor')
    .insert({ module_id: managed.id, professor_id: professor.id });

  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'This professor already manages the module');
    throw new Error(error.message);
  };

  return professor;
};

export const removeProfessor = async (professorId: number, moduleIdParam: string, targetIdParam: string) => {
  const managed = await requireManagedModule(moduleIdParam, professorId);

  const notInModule = () => new HttpError(404, 'This professor does not manage the module');
  const targetId = parseId(targetIdParam);
  if (!targetId) throw notInModule();

  // the last professor on a module can't remove themselves: nobody could manage it again afterwards
  const { count, error: countError } = await database
    .from('module_professor')
    .select('professor_id', { count: 'exact', head: true })
    .eq('module_id', managed.id);

  if (countError) throw new Error(countError.message);
  if ((count ?? 0) <= 1) throw new HttpError(409, 'A module must have at least one professor');

  const { data: removed, error } = await database
    .from('module_professor')
    .delete()
    .eq('module_id', managed.id)
    .eq('professor_id', targetId)
    .select('professor_id');

  if (error) throw new Error(error.message);
  if (!removed?.length) throw notInModule();
};

export const addStudent = async (professorId: number, moduleIdParam: string, body: Record<string, unknown>) => {
  const managed = await requireManagedModule(moduleIdParam, professorId);
  const student = await findMember(body, 'studentId', 'students', 'student');

  const { error } = await database
    .from('module_student')
    .insert({ module_id: managed.id, student_id: student.id });

  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'This student is already enrolled in the module');
    throw new Error(error.message);
  };

  void notify(student.id, 'module_enrolled', 'Added to a group', managed.name, managed.id);
  return student;
};

export const removeStudent = async (professorId: number, moduleIdParam: string, studentIdParam: string) => {
  const managed = await requireManagedModule(moduleIdParam, professorId);

  const notEnrolled = () => new HttpError(404, 'This student is not enrolled in the module');
  const studentId = parseId(studentIdParam);
  if (!studentId) throw notEnrolled();

  const { data: removed, error } = await database
    .from('module_student')
    .delete()
    .eq('module_id', managed.id)
    .eq('student_id', studentId)
    .select('student_id');

  if (error) throw new Error(error.message);
  if (!removed?.length) throw notEnrolled();
};
