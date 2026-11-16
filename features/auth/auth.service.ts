import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { database } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { encryptSecret } from '../../lib/recovery.js';
import { hasFace, isUsableImage } from '../../lib/faceMatch.js';
import { seesAllModules, managesStudent } from '../../lib/position-access.js';

// the auth logic other code calls directly (the ai chat among them), kept out of the controller

// +998 and 9 digits
export const isValidUzPhone = (value: string): boolean => /^\+998\d{9}$/.test(value);

// generated login, try the next suffix on collision
export const uniqueLogin = async (firstName: string): Promise<string> => {
  const base = firstName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'student';
  for (let suffix = 0; suffix < 50; suffix++) {
    const candidate = `${base}${suffix || ''}@magi.com`;
    const { data, error } = await database.from('users').select('email').eq('email', candidate).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return candidate;
  };
  return `${base}${crypto.randomInt(1000, 9999)}@magi.com`;
};

// random 5 digit code, not the real id
export const uniqueRoleCode = async (table: 'students' | 'professors', column: 'student_code' | 'professor_code' | 'id_number'): Promise<string> => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = String(crypto.randomInt(0, 100_000)).padStart(5, '0');
    const { data, error } = await database.from(table).select(column).eq(column, candidate).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return candidate;
  };
  throw new Error(`Could not generate a unique ${column}`);
};

// students this professor created + everyone in their modules, optional search
export const listManagedStudents = async (professorId: number, search?: string) => {
  let studentIds: Set<number>;

  if (await seesAllModules(professorId)) {
    // not a plain "professor" position - manages the whole shared pool of students directly
    const { data: everyone, error: everyoneError } = await database.from('students').select('user_id');
    if (everyoneError) throw new Error(everyoneError.message);
    studentIds = new Set((everyone ?? []).map((row) => row.user_id));
  } else {
    studentIds = new Set<number>();

    const { data: managed, error: managedError } = await database
      .from('module_professor')
      .select('module_id')
      .eq('professor_id', professorId);
    if (managedError) throw new Error(managedError.message);
    const moduleIds = (managed ?? []).map((row) => row.module_id);

    if (moduleIds.length) {
      const { data: roster, error: rosterError } = await database
        .from('module_student')
        .select('student_id')
        .in('module_id', moduleIds);
      if (rosterError) throw new Error(rosterError.message);
      for (const row of roster ?? []) studentIds.add(row.student_id);
    };

    const { data: created, error: createdError } = await database
      .from('students')
      .select('user_id')
      .eq('created_by', professorId);
    if (createdError) throw new Error(createdError.message);
    for (const row of created ?? []) studentIds.add(row.user_id);
  };

  if (!studentIds.size) return [];

  const { data: rows, error } = await database
    .from('students')
    .select('user_id, student_code, id_number, phone, parent_phone, parent_relation, age, profile_photo_url')
    .in('user_id', [...studentIds]);
  if (error) throw new Error(error.message);

  const { data: users, error: usersError } = await database
    .from('users')
    .select('id, first_name, last_name, email')
    .in('id', [...studentIds])
    .is('deleted_at', null);
  if (usersError) throw new Error(usersError.message);

  const { data: memberships, error: membershipsError } = await database
    .from('module_student')
    .select('student_id')
    .in('student_id', [...studentIds]);
  if (membershipsError) throw new Error(membershipsError.message);
  const hasGroupIds = new Set((memberships ?? []).map((row) => row.student_id));

  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  let students = (rows ?? [])
    .map((row) => {
      const user = userById.get(row.user_id);
      if (!user) return null;
      return {
        ...user,
        student_code: row.student_code,
        id_number: row.id_number,
        phone: row.phone,
        parent_phone: row.parent_phone,
        parent_relation: row.parent_relation,
        age: row.age,
        profile_photo_url: row.profile_photo_url,
        has_group: hasGroupIds.has(row.user_id),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.id - a.id);

  if (search?.trim()) {
    // compare letters/digits only so "behruz123" matches "Behruz 123"
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/gi, '');
    const needle = normalize(search);
    students = students.filter((s) =>
      normalize(`${s.first_name}${s.last_name ?? ''}${s.email}${s.student_code ?? ''}`).includes(needle),
    );
  };

  return students;
};

export type UpdateStudentPatch = {
  firstName?: string; lastName?: string | null; phone?: string | null; parentPhone?: string | null; parentRelation?: string | null;
  age?: number | null; email?: string; idNumber?: string; studentCode?: string; password?: string;
};

// plain function so the ai chat can call it too
export const updateStudentProfile = async (professorId: number, studentId: number, patch: UpdateStudentPatch) => {
  if (!(await managesStudent(professorId, studentId))) throw new HttpError(404, 'Student not found');

  const { firstName, lastName, phone, parentPhone, parentRelation, age, email, idNumber, studentCode, password } = patch;

  const { data: student, error: studentError } = await database
    .from('students')
    .select('user_id')
    .eq('user_id', studentId)
    .maybeSingle();
  if (studentError) throw new Error(studentError.message);
  if (!student) throw new HttpError(404, 'Student not found');

  const userPatch: Record<string, unknown> = {};
  if (firstName !== undefined) {
    if (typeof firstName !== 'string') throw new HttpError(400, 'firstName must be a string');
    const trimmed = firstName.trim();
    if (!trimmed) throw new HttpError(400, 'firstName cannot be empty');
    userPatch.first_name = trimmed;
  };
  if (lastName !== undefined) userPatch.last_name = lastName?.trim() || null;

  if (email !== undefined) {
    if (typeof email !== 'string') throw new HttpError(400, 'email must be a string');
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) throw new HttpError(400, 'email cannot be empty');
    if (trimmedEmail.length > 255) throw new HttpError(400, 'email must be at most 255 characters');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) throw new HttpError(400, 'Invalid email format');
    const { data: existing, error: existingError } = await database.from('users').select('id').eq('email', trimmedEmail).neq('id', studentId).maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) throw new HttpError(409, 'This email is already in use');
    userPatch.email = trimmedEmail;
  };

  // professor sets it, so refresh recovery_secret instead of clearing it
  if (password !== undefined) {
    if (typeof password !== 'string') throw new HttpError(400, 'password must be a string');
    if (password.length < 6 || password.length > 100) throw new HttpError(400, 'password must be between 6 and 100 characters long');
    userPatch.password = await bcrypt.hash(password, 10);
  };

  const studentPatch: Record<string, unknown> = {};
  if (idNumber !== undefined) {
    if (typeof idNumber !== 'string') throw new HttpError(400, 'idNumber must be a string');
    const trimmedIdNumber = idNumber.trim();
    if (!trimmedIdNumber) throw new HttpError(400, 'idNumber cannot be empty');
    if (trimmedIdNumber.length > 100) throw new HttpError(400, 'idNumber must be at most 100 characters');
    const { data: existingId, error: existingIdError } = await database.from('students').select('user_id').eq('id_number', trimmedIdNumber).neq('user_id', studentId).maybeSingle();
    if (existingIdError) throw new Error(existingIdError.message);
    if (existingId) throw new HttpError(409, 'This ID number is already in use');
    studentPatch.id_number = trimmedIdNumber;
  };
  if (studentCode !== undefined) {
    if (typeof studentCode !== 'string') throw new HttpError(400, 'studentCode must be a string');
    const trimmedStudentCode = studentCode.trim();
    if (!trimmedStudentCode) throw new HttpError(400, 'studentCode cannot be empty');
    if (trimmedStudentCode.length > 100) throw new HttpError(400, 'studentCode must be at most 100 characters');
    const { data: existingCode, error: existingCodeError } = await database.from('students').select('user_id').eq('student_code', trimmedStudentCode).neq('user_id', studentId).maybeSingle();
    if (existingCodeError) throw new Error(existingCodeError.message);
    if (existingCode) throw new HttpError(409, 'This student ID is already in use');
    studentPatch.student_code = trimmedStudentCode;
  };
  if (password !== undefined) studentPatch.recovery_secret = encryptSecret(password);
  if (phone !== undefined) {
    const trimmedPhone = phone?.trim() || null;
    if (trimmedPhone && !isValidUzPhone(trimmedPhone)) throw new HttpError(400, 'Phone must be in the format +998XXXXXXXXX');
    studentPatch.phone = trimmedPhone;
  };
  if (parentPhone !== undefined) {
    const trimmedParentPhone = parentPhone?.trim() || null;
    if (trimmedParentPhone && !isValidUzPhone(trimmedParentPhone)) throw new HttpError(400, 'Parent phone must be in the format +998XXXXXXXXX');
    studentPatch.parent_phone = trimmedParentPhone;
  };
  const resolvedPhone = phone !== undefined ? (studentPatch.phone as string | null) : undefined;
  const resolvedParentPhone = parentPhone !== undefined ? (studentPatch.parent_phone as string | null) : undefined;
  if (resolvedPhone && resolvedParentPhone && resolvedPhone === resolvedParentPhone) throw new HttpError(400, 'The student and parent phone numbers cannot be the same');
  if (parentRelation !== undefined) studentPatch.parent_relation = parentRelation?.trim() || null;
  if (age !== undefined) {
    if (age !== null && (!Number.isInteger(age) || age < 1 || age > 100)) throw new HttpError(400, 'age must be an integer between 1 and 100');
    studentPatch.age = age;
  };

  if (Object.keys(userPatch).length) {
    const { error } = await database.from('users').update(userPatch).eq('id', studentId);
    if (error) throw new Error(error.message);
  };
  if (Object.keys(studentPatch).length) {
    const { error } = await database.from('students').update(studentPatch).eq('user_id', studentId);
    if (error) throw new Error(error.message);
  };
};

// professors this one created + co-professors on their modules, optional search
export const listManagedProfessors = async (professorId: number, search?: string) => {
  let professorIds: Set<number>;

  if (await seesAllModules(professorId)) {
    // not a plain "professor" position - manages the whole shared pool of employees directly
    const { data: everyone, error: everyoneError } = await database.from('professors').select('user_id');
    if (everyoneError) throw new Error(everyoneError.message);
    professorIds = new Set((everyone ?? []).map((row) => row.user_id));
  } else {
    professorIds = new Set<number>();

    const { data: managed, error: managedError } = await database
      .from('module_professor')
      .select('module_id')
      .eq('professor_id', professorId);
    if (managedError) throw new Error(managedError.message);
    const moduleIds = (managed ?? []).map((row) => row.module_id);

    if (moduleIds.length) {
      const { data: roster, error: rosterError } = await database
        .from('module_professor')
        .select('professor_id')
        .in('module_id', moduleIds);
      if (rosterError) throw new Error(rosterError.message);
      for (const row of roster ?? []) professorIds.add(row.professor_id);
    };

    const { data: created, error: createdError } = await database
      .from('professors')
      .select('user_id')
      .eq('created_by', professorId);
    if (createdError) throw new Error(createdError.message);
    for (const row of created ?? []) professorIds.add(row.user_id);
  };

  professorIds.delete(professorId);

  if (!professorIds.size) return [];

  const { data: rows, error } = await database
    .from('professors')
    .select('user_id, professor_code, phone, position')
    .in('user_id', [...professorIds]);
  if (error) throw new Error(error.message);

  const { data: users, error: usersError } = await database
    .from('users')
    .select('id, first_name, last_name, email')
    .in('id', [...professorIds])
    .is('deleted_at', null);
  if (usersError) throw new Error(usersError.message);

  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  let professors = (rows ?? [])
    .map((row) => {
      const user = userById.get(row.user_id);
      if (!user) return null;
      return { ...user, professor_code: row.professor_code, phone: row.phone, position: row.position };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => b.id - a.id);

  if (search?.trim()) {
    // letters/digits only, see listManagedStudents
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/gi, '');
    const needle = normalize(search);
    professors = professors.filter((p) =>
      normalize(`${p.first_name}${p.last_name ?? ''}${p.email}${p.professor_code ?? ''}`).includes(needle),
    );
  };

  return professors;
};

// lets a student replace a reference photo that wouldn't pass the checks anymore
export const currentPhotoStillUsable = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url);
    const bytes = Buffer.from(await response.arrayBuffer());
    return (await isUsableImage(bytes)) && (await hasFace(bytes));
  } catch {
    return true; // couldn't be checked (network hiccup) - treat as fine rather than inviting an overwrite
  };
};
