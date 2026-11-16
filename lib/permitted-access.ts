// permitted urls/apps at exam, group and student level. start_attempt() merges them
import { database } from './db.js';
import { HttpError } from './errors.js';

export const requireUrl = (raw: unknown): string => {
  const url = typeof raw === 'string' ? raw.trim() : '';
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    throw new HttpError(400, 'url must be an http or https address');
  };
  if (address.protocol !== 'http:' && address.protocol !== 'https:') throw new HttpError(400, 'url must be an http or https address');
  return url;
};

export const requireAppName = (raw: unknown): string => {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) throw new HttpError(400, 'name is required');
  return name;
};

// the same url/app is shared by every exam, module or student that permits it
export const findOrCreatePermittedUrl = async (url: string): Promise<{ id: number; url: string }> => {
  const { data: existing, error } = await database.from('permitted_urls').select('id, url').eq('url', url).limit(1);
  if (error) throw new Error(error.message);
  if (existing?.[0]) return existing[0];

  const { data: created, error: createError } = await database.from('permitted_urls').insert({ url }).select('id, url').single();
  if (createError) throw new Error(createError.message);
  return created!;
};

export const findOrCreatePermittedApp = async (name: string): Promise<{ id: number; name: string }> => {
  const { data: existing, error } = await database.from('permitted_apps').select('id, name').eq('name', name).limit(1);
  if (error) throw new Error(error.message);
  if (existing?.[0]) return existing[0];

  const { data: created, error: createError } = await database.from('permitted_apps').insert({ name }).select('id, name').single();
  if (createError) throw new Error(createError.message);
  return created!;
};

export const linkPermitted = async (
  table: string,
  ownerColumn: string,
  ownerId: number,
  permittedColumn: string,
  permittedId: number,
  duplicateMessage: string,
): Promise<void> => {
  // table names come from our own callers, not input
  const { error } = await database.from(table).insert({ [ownerColumn]: ownerId, [permittedColumn]: permittedId } as never);
  if (error) {
    if (error.code === '23505') throw new HttpError(409, duplicateMessage);
    throw new Error(error.message);
  };
};

export const unlinkPermitted = async (
  table: string,
  ownerColumn: string,
  ownerId: number,
  permittedColumn: string,
  permittedId: number,
  notFoundMessage: string,
): Promise<void> => {
  const { data, error } = await database.from(table).delete().eq(ownerColumn, ownerId).eq(permittedColumn, permittedId).select(permittedColumn);
  if (error) throw new Error(error.message);
  if (!data?.length) throw new HttpError(404, notFoundMessage);
};

const permittedFor = async (
  table: string,
  ownerColumn: string,
  ownerId: number,
  permittedTable: 'permitted_urls' | 'permitted_apps',
  permittedColumn: 'permitted_url_id' | 'permitted_app_id',
  valueColumn: 'url' | 'name',
) => {
  const { data: links, error } = await database.from(table).select(permittedColumn).eq(ownerColumn, ownerId);
  if (error) throw new Error(error.message);
  const ids = (links ?? []).map((row: Record<string, number>) => row[permittedColumn]);
  if (!ids.length) return [];

  const { data, error: rowError } = await database.from(permittedTable).select(`id, ${valueColumn}`).in('id', ids).order(valueColumn);
  if (rowError) throw new Error(rowError.message);
  return data ?? [];
};

export const modulePermittedUrls = (moduleId: number) => permittedFor('module_permitted_url', 'module_id', moduleId, 'permitted_urls', 'permitted_url_id', 'url');
export const modulePermittedApps = (moduleId: number) => permittedFor('module_permitted_app', 'module_id', moduleId, 'permitted_apps', 'permitted_app_id', 'name');
export const studentPermittedUrls = (studentId: number) => permittedFor('student_permitted_url', 'student_id', studentId, 'permitted_urls', 'permitted_url_id', 'url');
export const studentPermittedApps = (studentId: number) => permittedFor('student_permitted_app', 'student_id', studentId, 'permitted_apps', 'permitted_app_id', 'name');
export const examPermittedApps = (examId: number) => permittedFor('exam_permitted_app', 'exam_id', examId, 'permitted_apps', 'permitted_app_id', 'name');

export const sharedModuleIds = async (examId: number, studentId: number): Promise<number[]> => {
  const { data: studentModules, error: moduleError } = await database.from('module_student').select('module_id').eq('student_id', studentId);
  if (moduleError) throw new Error(moduleError.message);
  const { data: examModules, error: examModuleError } = await database.from('exam_module').select('module_id').eq('exam_id', examId);
  if (examModuleError) throw new Error(examModuleError.message);
  const studentModuleIds = new Set((studentModules ?? []).map((row) => row.module_id));
  return (examModules ?? []).map((row) => row.module_id).filter((id) => studentModuleIds.has(id));
};

// what start_attempt() would merge right now
const effectiveFor = async (
  examId: number,
  studentId: number,
  moduleIds: number[],
  examTable: string,
  moduleTable: string,
  studentTable: string,
  permittedTable: 'permitted_urls' | 'permitted_apps',
  permittedColumn: 'permitted_url_id' | 'permitted_app_id',
  valueColumn: 'url' | 'name',
) => {
  const { data: examLinks, error: examError } = await database.from(examTable).select(permittedColumn).eq('exam_id', examId);
  if (examError) throw new Error(examError.message);

  const { data: studentLinks, error: studentError } = await database.from(studentTable).select(permittedColumn).eq('student_id', studentId);
  if (studentError) throw new Error(studentError.message);

  let moduleLinks: Record<string, number>[] = [];
  if (moduleIds.length) {
    const { data, error: moduleLinkError } = await database.from(moduleTable).select(permittedColumn).in('module_id', moduleIds);
    if (moduleLinkError) throw new Error(moduleLinkError.message);
    moduleLinks = data ?? [];
  };

  const ids = new Set<number>([...(examLinks ?? []), ...(studentLinks ?? []), ...moduleLinks].map((row: Record<string, number>) => row[permittedColumn]));
  if (!ids.size) return [];

  const { data, error: rowError } = await database.from(permittedTable).select(`id, ${valueColumn}`).in('id', [...ids]).order(valueColumn);
  if (rowError) throw new Error(rowError.message);
  return data ?? [];
};

export const effectivePermittedUrls = (examId: number, studentId: number, moduleIds: number[]) =>
  effectiveFor(examId, studentId, moduleIds, 'exam_permitted_url', 'module_permitted_url', 'student_permitted_url', 'permitted_urls', 'permitted_url_id', 'url');

export const effectivePermittedApps = (examId: number, studentId: number, moduleIds: number[]) =>
  effectiveFor(examId, studentId, moduleIds, 'exam_permitted_app', 'module_permitted_app', 'student_permitted_app', 'permitted_apps', 'permitted_app_id', 'name');
