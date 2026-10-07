import { database } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { managedExamIds, managesExam, seesExam } from '../../lib/exam-access.js';
import { activeOnly, parseId, softDelete } from '../../lib/utils.js';
import { type TokenPayload } from '../../lib/types.js';

const EXAM_COLUMNS = 'id, name, shuffle_questions, scheduled_start, scheduled_end, status, max_marks, passing_marks, created_by, created_at, updated_at';
// a student never sees who owns an exam, how it is shuffled or what it asks
const STUDENT_EXAM_COLUMNS = 'id, name, scheduled_start, scheduled_end, status, max_marks, passing_marks';

const EXAM_STATUSES = ['demo', 'scheduled', 'ongoing', 'completed', 'delayed', 'cancelled'] as const;
type ExamStatus = (typeof EXAM_STATUSES)[number];

// what a status may become; completed and cancelled are final
const STATUS_FLOW: Record<ExamStatus, ExamStatus[]> = {
  demo: ['ongoing', 'completed', 'cancelled'],
  scheduled: ['ongoing', 'delayed', 'cancelled'],
  delayed: ['scheduled', 'ongoing', 'cancelled'],
  ongoing: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const throwOnError = (error: { code?: string; message: string } | null, conflict?: string) => {
  if (!error) return;
  if (error.code === '23505' && conflict) throw new HttpError(409, conflict);
  throw new Error(error.message);
};

const requireName = (value: unknown): string => {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 100) throw new HttpError(400, 'name is required and must be at most 100 characters');
  return name;
};

const requireDate = (value: unknown, field: string): string => {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(time)) throw new HttpError(400, `${field} must be a date`);
  return new Date(time).toISOString();
};

const requireMarks = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new HttpError(400, `${field} must be a whole number of 0 or more`);
  return value as number;
};

const requireBodyId = (value: unknown, field: string): number => {
  const id = parseId(value);
  if (!id) throw new HttpError(400, `${field} must be an id`);
  return id;
};

const assignedExamIds = async (user: TokenPayload): Promise<number[]> => {
  const table = user.role === 'examiner' ? 'exam_examiner' : 'exam_student';
  const column = user.role === 'examiner' ? 'examiner_id' : 'student_id';
  const { data, error } = await database.from(table).select('exam_id').eq(column, user.id);
  throwOnError(error);
  return (data ?? []).map((row) => row.exam_id);
};

const loadExamRow = async (examId: number, columns: string) => {
  const { data, error } = await activeOnly(
    database.from('exams').select(columns).eq('id', examId)
  ).maybeSingle<any>();
  throwOnError(error);
  return data;
};

// an exam somebody else manages must not be distinguishable from one that does not exist
const loadManagedExam = async (professorId: number, examId: number, columns: string = EXAM_COLUMNS) => {
  const exam = await loadExamRow(examId, columns);
  if (!exam || !(await managesExam(exam, professorId))) throw new HttpError(404, 'Exam not found');
  return exam;
};

// the exam as this user is allowed to see it: managed by a professor, assigned to an examiner or a student
const loadVisibleExam = async (user: TokenPayload, examId: number, columns: string = EXAM_COLUMNS) => {
  const exam = await loadExamRow(examId, columns);
  if (!exam || !(await seesExam(exam, user))) throw new HttpError(404, 'Exam not found');
  return exam;
};

// questions, schedule, modules and students are settled once somebody has an attempt
const assertNoAttempts = async (examId: number) => {
  const { data, error } = await activeOnly(
    database.from('assignments').select('id').eq('exam_id', examId)
  ).limit(1);
  throwOnError(error);
  if (data?.length) throw new HttpError(409, 'The exam already has attempts and cannot be restructured');
};

const examModules = async (examId: number) => {
  const { data: links, error } = await database.from('exam_module').select('module_id').eq('exam_id', examId);
  throwOnError(error);
  const ids = (links ?? []).map((row) => row.module_id);
  if (!ids.length) return [];

  const { data, error: moduleError } = await activeOnly(
    database.from('modules').select('id, name').in('id', ids)
  ).order('name');
  throwOnError(moduleError);
  return data ?? [];
};

const examPeople = async (table: string, column: string, examId: number) => {
  const { data: links, error } = await database.from(table).select(column).eq('exam_id', examId);
  throwOnError(error);
  // the table and the column are picked at runtime, so the PostgREST result types cannot follow
  const ids = ((links ?? []) as unknown as Record<string, number>[]).map((row) => row[column]);
  if (!ids.length) return [];

  const { data, error: userError } = await activeOnly(
    database.from('users').select('id, first_name, last_name, email').in('id', ids)
  ).order('first_name');
  throwOnError(userError);
  return data ?? [];
};

const examEvents = async (examId: number) => {
  const { data: links, error } = await database.from('exam_events').select('event_id').eq('exam_id', examId);
  throwOnError(error);
  const ids = (links ?? []).map((row) => row.event_id);
  if (!ids.length) return [];

  const { data, error: eventError } = await activeOnly(
    database.from('events').select('id, name, description').in('id', ids)
  ).order('name');
  throwOnError(eventError);
  return data ?? [];
};

const examUrls = async (examId: number) => {
  const { data: links, error } = await database.from('exam_permitted_url').select('permitted_url_id').eq('exam_id', examId);
  throwOnError(error);
  const ids = (links ?? []).map((row) => row.permitted_url_id);
  if (!ids.length) return [];

  const { data, error: urlError } = await database.from('permitted_urls').select('id, url').in('id', ids).order('url');
  throwOnError(urlError);
  return data ?? [];
};

// staff only: the options carry is_correct
const examQuestions = async (examId: number) => {
  const { data: links, error } = await database
    .from('exam_question')
    .select('question_id, position, marks')
    .eq('exam_id', examId)
    .order('position');
  throwOnError(error);
  const ids = (links ?? []).map((row) => row.question_id);
  if (!ids.length) return [];

  const { data: questions, error: questionError } = await activeOnly(
    database.from('questions').select('id, title, question_type, question, expected_duration, expected_duration_unit').in('id', ids)
  );
  throwOnError(questionError);

  const { data: options, error: optionError } = await activeOnly(
    database.from('question_options').select('id, question_id, option_text, is_correct').in('question_id', ids)
  ).order('id');
  throwOnError(optionError);

  const byId = new Map((questions ?? []).map((question) => [question.id, question]));
  // a question its owner soft deleted stays linked but is no longer part of the exam
  return (links ?? []).flatMap((link) => {
    const question = byId.get(link.question_id);
    if (!question) return [];
    return [{
      ...question,
      position: link.position,
      marks: link.marks,
      options: (options ?? []).filter((option) => option.question_id === question.id),
    }];
  });
};

const totalMarks = (questions: { marks: number }[]) => questions.reduce((total, question) => total + question.marks, 0);

export const listExams = async (user: TokenPayload) => {
  const ids = user.role === 'professor' ? await managedExamIds(user.id) : await assignedExamIds(user);
  if (!ids.length) return [];

  const { data, error } = await activeOnly(
    database.from('exams').select(user.role === 'student' ? STUDENT_EXAM_COLUMNS : EXAM_COLUMNS).in('id', ids)
  ).order('scheduled_start');
  throwOnError(error);
  return data ?? [];
};

export const getExam = async (user: TokenPayload, examId: number) => {
  const exam = await loadVisibleExam(user, examId, user.role === 'student' ? STUDENT_EXAM_COLUMNS : EXAM_COLUMNS);
  if (user.role === 'student') return { ...exam, permitted_urls: await examUrls(examId) };

  const questions = await examQuestions(examId);
  return {
    ...exam,
    modules: await examModules(examId),
    examiners: await examPeople('exam_examiner', 'examiner_id', examId),
    students: await examPeople('exam_student', 'student_id', examId),
    events: await examEvents(examId),
    permitted_urls: await examUrls(examId),
    questions,
    marks_total: totalMarks(questions),
  };
};

// express 5 leaves req.body undefined when nothing is sent, hence the default on every body
export const createExam = async (professorId: number, body: any = {}) => {
  const name = requireName(body.name);
  const scheduled_start = requireDate(body.scheduledStart, 'scheduledStart');
  const scheduled_end = requireDate(body.scheduledEnd, 'scheduledEnd');
  if (scheduled_end <= scheduled_start) throw new HttpError(400, 'scheduledEnd must be after scheduledStart');
  if (new Date(scheduled_start).getTime() < Date.now()) throw new HttpError(400, 'scheduledStart cannot be in the past');

  const max_marks = body.maxMarks === undefined ? 100 : requireMarks(body.maxMarks, 'maxMarks');
  const passing_marks = body.passingMarks === undefined ? 0 : requireMarks(body.passingMarks, 'passingMarks');
  if (passing_marks > max_marks) throw new HttpError(400, 'passingMarks cannot be above maxMarks');

  // an exam is born scheduled or as a demo, every other status is reached through PATCH /status
  const status = body.status === undefined ? 'scheduled' : body.status;
  if (status !== 'scheduled' && status !== 'demo') throw new HttpError(400, 'status must be scheduled or demo');

  const { data, error } = await database
    .from('exams')
    .insert({
      name,
      scheduled_start,
      scheduled_end,
      status,
      max_marks,
      passing_marks,
      shuffle_questions: body.shuffleQuestions === undefined ? true : Boolean(body.shuffleQuestions),
      created_by: professorId,
    })
    .select(EXAM_COLUMNS)
    .single();
  throwOnError(error);
  return data;
};

export const updateExam = async (professorId: number, examId: number, body: any = {}) => {
  const exam = await loadManagedExam(professorId, examId);

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = requireName(body.name);
  if (body.shuffleQuestions !== undefined) patch.shuffle_questions = Boolean(body.shuffleQuestions);
  if (body.scheduledStart !== undefined) patch.scheduled_start = requireDate(body.scheduledStart, 'scheduledStart');
  if (body.scheduledEnd !== undefined) patch.scheduled_end = requireDate(body.scheduledEnd, 'scheduledEnd');
  if (body.maxMarks !== undefined) patch.max_marks = requireMarks(body.maxMarks, 'maxMarks');
  if (body.passingMarks !== undefined) patch.passing_marks = requireMarks(body.passingMarks, 'passingMarks');
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update');

  const start = new Date((patch.scheduled_start ?? exam.scheduled_start) as string);
  const end = new Date((patch.scheduled_end ?? exam.scheduled_end) as string);
  if (end <= start) throw new HttpError(400, 'scheduledEnd must be after scheduledStart');
  if (patch.scheduled_start !== undefined && start.getTime() < Date.now()) {
    throw new HttpError(400, 'scheduledStart cannot be in the past');
  };

  const max = (patch.max_marks ?? exam.max_marks) as number;
  const passing = (patch.passing_marks ?? exam.passing_marks) as number;
  if (passing > max) throw new HttpError(400, 'passingMarks cannot be above maxMarks');

  // the schedule is part of what the students already started on
  if (patch.scheduled_start !== undefined || patch.scheduled_end !== undefined) await assertNoAttempts(examId);

  const { data, error } = await database.from('exams').update(patch).eq('id', examId).select(EXAM_COLUMNS).single();
  throwOnError(error);
  return data;
};

export const deleteExam = async (professorId: number, examId: number, body: any = {}) => {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) throw new HttpError(400, 'reason is required');

  await loadManagedExam(professorId, examId);
  await assertNoAttempts(examId);

  const { error } = await database.from('exams').update(softDelete(reason)).eq('id', examId);
  throwOnError(error);
};

export const setExamStatus = async (professorId: number, examId: number, body: any = {}) => {
  const status = body.status as ExamStatus;
  if (!EXAM_STATUSES.includes(status)) throw new HttpError(400, `status must be one of ${EXAM_STATUSES.join(', ')}`);

  const exam = await loadManagedExam(professorId, examId);
  if (!STATUS_FLOW[exam.status as ExamStatus].includes(status)) {
    throw new HttpError(409, `An exam that is ${exam.status} cannot become ${status}`);
  };

  // the exam is about to be taken, so its questions have to add up to what it is out of
  if (status === 'ongoing') {
    const questions = await examQuestions(examId);
    if (!questions.length) throw new HttpError(409, 'The exam has no questions yet');
    const total = totalMarks(questions);
    if (total !== exam.max_marks) {
      throw new HttpError(409, `The questions add up to ${total} marks, the exam is out of ${exam.max_marks}`);
    };
  };

  const { data, error } = await database.from('exams').update({ status }).eq('id', examId).select(EXAM_COLUMNS).single();
  throwOnError(error);
  return data;
};

export const linkModule = async (professorId: number, examId: number, body: any = {}) => {
  const moduleId = requireBodyId(body.moduleId, 'moduleId');
  await loadManagedExam(professorId, examId);
  await assertNoAttempts(examId);

  const { data: taught, error: taughtError } = await database
    .from('module_professor')
    .select('module_id')
    .eq('professor_id', professorId)
    .eq('module_id', moduleId)
    .maybeSingle();
  throwOnError(taughtError);
  if (!taught) throw new HttpError(404, 'Module not found');

  const { error } = await database.from('exam_module').insert({ exam_id: examId, module_id: moduleId });
  throwOnError(error, 'The module is already linked to this exam');
  return { exam_id: examId, module_id: moduleId };
};

export const unlinkModule = async (professorId: number, examId: number, moduleId: number) => {
  await loadManagedExam(professorId, examId);
  await assertNoAttempts(examId);

  const { data, error } = await database
    .from('exam_module')
    .delete()
    .eq('exam_id', examId)
    .eq('module_id', moduleId)
    .select('module_id');
  throwOnError(error);
  if (!data?.length) throw new HttpError(404, 'Module not found');
};

export const addExaminer = async (professorId: number, examId: number, body: any = {}) => {
  const examinerId = requireBodyId(body.examinerId, 'examinerId');
  await loadManagedExam(professorId, examId);

  const { data: examiner, error: examinerError } = await database
    .from('examiners')
    .select('user_id')
    .eq('user_id', examinerId)
    .maybeSingle();
  throwOnError(examinerError);
  if (!examiner) throw new HttpError(404, 'Examiner not found');

  const { error } = await database.from('exam_examiner').insert({ exam_id: examId, examiner_id: examinerId });
  throwOnError(error, 'The examiner is already assigned to this exam');
  return { exam_id: examId, examiner_id: examinerId };
};

export const removeExaminer = async (professorId: number, examId: number, examinerId: number) => {
  await loadManagedExam(professorId, examId);

  const { data, error } = await database
    .from('exam_examiner')
    .delete()
    .eq('exam_id', examId)
    .eq('examiner_id', examinerId)
    .select('examiner_id');
  throwOnError(error);
  if (!data?.length) throw new HttpError(404, 'Examiner not found');
};

const addModuleStudents = async (examId: number, moduleId: number) => {
  const { data: enrolled, error } = await database.from('module_student').select('student_id').eq('module_id', moduleId);
  throwOnError(error);
  const studentIds = (enrolled ?? []).map((row) => row.student_id);
  if (!studentIds.length) return { added: [] };

  const { data: already, error: alreadyError } = await database
    .from('exam_student')
    .select('student_id')
    .eq('exam_id', examId)
    .in('student_id', studentIds);
  throwOnError(alreadyError);

  const assigned = new Set((already ?? []).map((row) => row.student_id));
  const added = studentIds.filter((studentId) => !assigned.has(studentId));
  if (!added.length) return { added };

  const { error: insertError } = await database
    .from('exam_student')
    .insert(added.map((student_id) => ({ exam_id: examId, student_id })));
  throwOnError(insertError, 'Some of these students are already assigned to this exam');
  return { added };
};

// one student, or every student of a module the exam is linked to
export const addStudents = async (professorId: number, examId: number, body: any = {}) => {
  const studentId = body.studentId === undefined ? null : requireBodyId(body.studentId, 'studentId');
  const moduleId = body.moduleId === undefined ? null : requireBodyId(body.moduleId, 'moduleId');
  if ((studentId === null) === (moduleId === null)) throw new HttpError(400, 'Send either studentId or moduleId');

  await loadManagedExam(professorId, examId);
  await assertNoAttempts(examId);

  const { data: links, error } = await database.from('exam_module').select('module_id').eq('exam_id', examId);
  throwOnError(error);
  const moduleIds = (links ?? []).map((row) => row.module_id);

  if (moduleId !== null) {
    if (!moduleIds.includes(moduleId)) throw new HttpError(404, 'Module not found');
    return addModuleStudents(examId, moduleId);
  };

  // a student is only reachable through a module of this exam
  if (!moduleIds.length) throw new HttpError(404, 'Student not found');
  const { data: enrolled, error: enrolledError } = await database
    .from('module_student')
    .select('student_id')
    .eq('student_id', studentId)
    .in('module_id', moduleIds)
    .limit(1);
  throwOnError(enrolledError);
  if (!enrolled?.length) throw new HttpError(404, 'Student not found');

  const { error: insertError } = await database.from('exam_student').insert({ exam_id: examId, student_id: studentId });
  throwOnError(insertError, 'The student is already assigned to this exam');
  return { added: [studentId] };
};

export const removeStudent = async (professorId: number, examId: number, studentId: number) => {
  await loadManagedExam(professorId, examId);
  await assertNoAttempts(examId);

  const { data, error } = await database
    .from('exam_student')
    .delete()
    .eq('exam_id', examId)
    .eq('student_id', studentId)
    .select('student_id');
  throwOnError(error);
  if (!data?.length) throw new HttpError(404, 'Student not found');
};

export const listExamQuestions = async (user: TokenPayload, examId: number) => {
  const exam = await loadVisibleExam(user, examId);
  const questions = await examQuestions(examId);
  return { questions, marks_total: totalMarks(questions), max_marks: exam.max_marks };
};

// the owner of a question may put it in an exam, and so may a professor of an exam it is already in
const assertQuestionReadable = async (professorId: number, questionId: number) => {
  const { data: question, error } = await activeOnly(
    database.from('questions').select('id, created_by').eq('id', questionId)
  ).maybeSingle<any>();
  throwOnError(error);
  if (!question) throw new HttpError(404, 'Question not found');
  if (question.created_by === professorId) return;

  const { data: links, error: linkError } = await database
    .from('exam_question')
    .select('exam_id')
    .eq('question_id', questionId);
  throwOnError(linkError);

  const examIds = (links ?? []).map((row) => row.exam_id);
  if (examIds.length) {
    const managed = await managedExamIds(professorId);
    if (examIds.some((id) => managed.includes(id))) return;
  };

  throw new HttpError(404, 'Question not found');
};

const nextPosition = async (examId: number) => {
  const { data, error } = await database
    .from('exam_question')
    .select('position')
    .eq('exam_id', examId)
    .order('position', { ascending: false })
    .limit(1);
  throwOnError(error);
  return (data?.[0]?.position ?? 0) + 1;
};

export const attachQuestion = async (professorId: number, examId: number, body: any = {}) => {
  const questionId = requireBodyId(body.questionId, 'questionId');
  const marks = body.marks === undefined ? 1 : requireMarks(body.marks, 'marks');
  const position = body.position === undefined ? null : requireBodyId(body.position, 'position');

  await loadManagedExam(professorId, examId);
  await assertNoAttempts(examId);
  await assertQuestionReadable(professorId, questionId);

  const slot = position ?? await nextPosition(examId);
  const { data, error } = await database
    .from('exam_question')
    .insert({ exam_id: examId, question_id: questionId, position: slot, marks })
    .select('question_id, position, marks')
    .single();
  throwOnError(error, 'The question is already in this exam or the position is taken');
  return data;
};

export const updateExamQuestion = async (professorId: number, examId: number, questionId: number, body: any = {}) => {
  const marks = requireMarks(body.marks, 'marks');
  await loadManagedExam(professorId, examId);
  await assertNoAttempts(examId);

  const { data, error } = await database
    .from('exam_question')
    .update({ marks })
    .eq('exam_id', examId)
    .eq('question_id', questionId)
    .select('question_id, position, marks');
  throwOnError(error);
  if (!data?.length) throw new HttpError(404, 'Question not found');
  return data[0];
};

export const reorderQuestions = async (professorId: number, examId: number, body: any = {}) => {
  const questionIds: number[] = Array.isArray(body.questionIds) ? body.questionIds.map((value: unknown) => parseId(value)) : [];
  if (!questionIds.length || questionIds.some((questionId) => !questionId)) {
    throw new HttpError(400, 'questionIds must be a list of ids');
  };
  if (new Set(questionIds).size !== questionIds.length) throw new HttpError(400, 'questionIds lists the same question twice');

  await loadManagedExam(professorId, examId);
  await assertNoAttempts(examId);

  const { data: links, error } = await database.from('exam_question').select('question_id').eq('exam_id', examId);
  throwOnError(error);
  const attached = (links ?? []).map((row) => row.question_id);
  if (attached.length !== questionIds.length || questionIds.some((questionId) => !attached.includes(questionId))) {
    throw new HttpError(400, 'questionIds must list every question of the exam exactly once');
  };

  // unique (exam_id, position) is deferrable, so the whole new order fits in one statement
  const { error: reorderError } = await database
    .from('exam_question')
    .upsert(
      questionIds.map((question_id, index) => ({ exam_id: examId, question_id, position: index + 1 })),
      { onConflict: 'exam_id,question_id' }
    );
  throwOnError(reorderError);
  return examQuestions(examId);
};

export const detachQuestion = async (professorId: number, examId: number, questionId: number) => {
  await loadManagedExam(professorId, examId);
  await assertNoAttempts(examId);

  const { data, error } = await database
    .from('exam_question')
    .delete()
    .eq('exam_id', examId)
    .eq('question_id', questionId)
    .select('question_id');
  throwOnError(error);
  if (!data?.length) throw new HttpError(404, 'Question not found');
};

export const listEventCatalog = async () => {
  const { data, error } = await activeOnly(database.from('events').select('id, name, description')).order('name');
  throwOnError(error);
  return data ?? [];
};

export const attachEvent = async (professorId: number, examId: number, body: any = {}) => {
  const eventId = requireBodyId(body.eventId, 'eventId');
  await loadManagedExam(professorId, examId);

  const { data: event, error } = await activeOnly(
    database.from('events').select('id, name, description').eq('id', eventId)
  ).maybeSingle();
  throwOnError(error);
  if (!event) throw new HttpError(404, 'Event not found');

  const { error: insertError } = await database.from('exam_events').insert({ exam_id: examId, event_id: eventId });
  throwOnError(insertError, 'The event is already monitored for this exam');
  return event;
};

export const detachEvent = async (professorId: number, examId: number, eventId: number) => {
  await loadManagedExam(professorId, examId);

  const { data, error } = await database
    .from('exam_events')
    .delete()
    .eq('exam_id', examId)
    .eq('event_id', eventId)
    .select('event_id');
  throwOnError(error);
  if (!data?.length) throw new HttpError(404, 'Event not found');
};

export const addPermittedUrl = async (professorId: number, examId: number, body: any = {}) => {
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    throw new HttpError(400, 'url must be an http or https address');
  };
  if (address.protocol !== 'http:' && address.protocol !== 'https:') {
    throw new HttpError(400, 'url must be an http or https address');
  };

  await loadManagedExam(professorId, examId);

  // the same address is shared by every exam that permits it
  const { data: existing, error } = await database.from('permitted_urls').select('id, url').eq('url', url).limit(1);
  throwOnError(error);

  let permitted = existing?.[0];
  if (!permitted) {
    const { data: created, error: createError } = await database
      .from('permitted_urls')
      .insert({ url })
      .select('id, url')
      .single();
    throwOnError(createError);
    // .single() answers a row whenever it does not answer an error, which throwOnError has rethrown
    permitted = created!;
  };

  const { error: linkError } = await database
    .from('exam_permitted_url')
    .insert({ exam_id: examId, permitted_url_id: permitted.id });
  throwOnError(linkError, 'The url is already permitted for this exam');
  return permitted;
};

export const removePermittedUrl = async (professorId: number, examId: number, permittedUrlId: number) => {
  await loadManagedExam(professorId, examId);

  const { data, error } = await database
    .from('exam_permitted_url')
    .delete()
    .eq('exam_id', examId)
    .eq('permitted_url_id', permittedUrlId)
    .select('permitted_url_id');
  throwOnError(error);
  if (!data?.length) throw new HttpError(404, 'Permitted url not found');
};
