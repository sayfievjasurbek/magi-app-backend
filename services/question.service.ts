import { database } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { activeOnly, parseId, softDelete } from '../lib/utils.js';

const QUESTION_TYPES = ['multiple_choice', 'true_false', 'short_answer', 'essay'];
const TIME_UNITS = ['seconds', 'minutes', 'hours', 'days'];

const OPTION_COLUMNS = 'id, question_id, option_text, is_correct, created_at, updated_at';

type QuestionFields = {
  title?: string;
  question?: string;
  question_type?: string;
  expected_duration?: number;
  expected_duration_unit?: string;
};

type OptionInput = { option_text: string; is_correct: boolean };

const questionNotFound = () => new HttpError(404, 'Question not found');

const parseReason = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'reason must be a non-empty string');
  return value.trim();
};

const parseQuestionType = (value: unknown): string => {
  if (typeof value !== 'string' || !QUESTION_TYPES.includes(value)) {
    throw new HttpError(400, `questionType must be one of: ${QUESTION_TYPES.join(', ')}`);
  };
  return value;
};

const parseQuestionFields = (body: Record<string, unknown>): QuestionFields => {
  const fields: QuestionFields = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) throw new HttpError(400, 'Question title must be a non-empty string');
    if (body.title.trim().length > 100) throw new HttpError(400, 'Question title must be at most 100 characters');
    fields.title = body.title.trim();
  };

  if (body.question !== undefined) {
    if (typeof body.question !== 'string') throw new HttpError(400, 'question must be a string');
    fields.question = body.question;
  };

  if (body.questionType !== undefined) fields.question_type = parseQuestionType(body.questionType);

  if (body.expectedDuration !== undefined) {
    if (!Number.isInteger(body.expectedDuration) || (body.expectedDuration as number) < 0) {
      throw new HttpError(400, 'expectedDuration must be a non-negative integer');
    };
    fields.expected_duration = body.expectedDuration as number;
  };

  if (body.expectedDurationUnit !== undefined) {
    if (typeof body.expectedDurationUnit !== 'string' || !TIME_UNITS.includes(body.expectedDurationUnit)) {
      throw new HttpError(400, `expectedDurationUnit must be one of: ${TIME_UNITS.join(', ')}`);
    };
    fields.expected_duration_unit = body.expectedDurationUnit;
  };

  return fields;
};

// how many options and how many correct ones are allowed is decided by the question type
const parseOptions = (value: unknown, questionType: string): OptionInput[] => {
  if (!Array.isArray(value)) throw new HttpError(400, 'options must be an array');

  const options = value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new HttpError(400, 'Each option must be an object');

    const { optionText, isCorrect } = entry as Record<string, unknown>;
    if (typeof optionText !== 'string' || !optionText.trim()) throw new HttpError(400, 'optionText must be a non-empty string');
    if (isCorrect !== undefined && typeof isCorrect !== 'boolean') throw new HttpError(400, 'isCorrect must be a boolean');

    return { option_text: optionText.trim(), is_correct: isCorrect === true };
  });

  const correct = options.filter((option) => option.is_correct).length;

  if (questionType === 'multiple_choice') {
    if (options.length < 2) throw new HttpError(400, 'A multiple_choice question needs at least 2 options');
    if (!correct) throw new HttpError(400, 'A multiple_choice question needs at least 1 correct option');
  } else if (questionType === 'true_false') {
    if (options.length !== 2) throw new HttpError(400, 'A true_false question needs exactly 2 options');
    if (correct !== 1) throw new HttpError(400, 'A true_false question needs exactly 1 correct option');
  } else if (options.length) {
    throw new HttpError(400, `${questionType} questions take no options`);
  };

  return options;
};

const findOwnedQuestion = async (questionId: number, professorId: number) => {
  const { data, error } = await activeOnly(
    database.from('questions').select('*').eq('id', questionId).eq('created_by', professorId)
  ).maybeSingle();

  if (error) throw new Error(error.message);
  return data;
};

// only the owner writes: a question used by someone else's exam stays theirs
const requireOwnedQuestion = async (questionIdParam: string, professorId: number) => {
  const questionId = parseId(questionIdParam);
  if (!questionId) throw questionNotFound();

  const owned = await findOwnedQuestion(questionId, professorId);
  if (!owned) throw questionNotFound();
  return owned;
};

// exams.created_by belongs to the exams domain, so the exam tables are read directly here
const managesAnyExam = async (examIds: number[], professorId: number) => {
  const { data: created, error } = await activeOnly(
    database.from('exams').select('id').in('id', examIds).eq('created_by', professorId)
  ).limit(1);

  if (error) throw new Error(error.message);
  if (created?.length) return true;

  const { data: modules, error: modulesError } = await database
    .from('module_professor')
    .select('module_id')
    .eq('professor_id', professorId);

  if (modulesError) throw new Error(modulesError.message);

  const moduleIds = (modules ?? []).map((row) => row.module_id);
  if (!moduleIds.length) return false;

  const { data: linked, error: linkedError } = await database
    .from('exam_module')
    .select('exam_id')
    .in('exam_id', examIds)
    .in('module_id', moduleIds)
    .limit(1);

  if (linkedError) throw new Error(linkedError.message);
  return Boolean(linked?.length);
};

// a question the professor does not own is readable when an exam they manage asks it
const findExamQuestion = async (questionId: number, professorId: number) => {
  const { data: asked, error: askedError } = await database
    .from('exam_question')
    .select('exam_id')
    .eq('question_id', questionId);

  if (askedError) throw new Error(askedError.message);

  const examIds = (asked ?? []).map((row) => row.exam_id);
  if (!examIds.length) return null;
  if (!(await managesAnyExam(examIds, professorId))) return null;

  const { data, error } = await activeOnly(database.from('questions').select('*').eq('id', questionId)).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
};

// answers point at the option rows, so an answered question is frozen
const hasAnswers = async (questionId: number) => {
  const { data, error } = await database
    .from('question_assignment')
    .select('assignment_id')
    .eq('question_id', questionId)
    .limit(1);

  if (error) throw new Error(error.message);
  return Boolean(data?.length);
};

const listOptions = async (questionId: number) => {
  const { data, error } = await activeOnly(
    database.from('question_options').select(OPTION_COLUMNS).eq('question_id', questionId)
  ).order('id', { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
};

const insertOptions = async (questionId: number, options: OptionInput[]) => {
  if (!options.length) return [];

  const { data, error } = await database
    .from('question_options')
    .insert(options.map((option) => ({ ...option, question_id: questionId })))
    .select(OPTION_COLUMNS);

  if (error) throw new Error(error.message);
  return data ?? [];
};

// the old options are soft deleted and put back when the insert fails: deleting them for real would
// cascade into question_assignment_option and take recorded answers with it
const replaceOptions = async (questionId: number, options: OptionInput[]) => {
  const { data: removed, error } = await activeOnly(
    database.from('question_options').update(softDelete('options replaced')).eq('question_id', questionId)
  ).select('id');

  if (error) throw new Error(error.message);

  try {
    return await insertOptions(questionId, options);
  } catch (insertError: unknown) {
    const ids = (removed ?? []).map((option) => option.id);
    if (ids.length) await database.from('question_options').update({ deleted_at: null, reason: null }).in('id', ids);
    throw insertError;
  };
};

const updateFields = async (questionId: number, fields: QuestionFields) => {
  if (!Object.keys(fields).length) {
    const { data, error } = await activeOnly(database.from('questions').select('*').eq('id', questionId)).single();
    if (error) throw new Error(error.message);
    return data;
  };

  const { data, error } = await database
    .from('questions')
    .update(fields)
    .eq('id', questionId)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data;
};

export const createQuestion = async (professorId: number, body: Record<string, unknown>) => {
  const fields = parseQuestionFields(body);
  if (!fields.title) throw new HttpError(400, 'Question title is required');

  const questionType = fields.question_type ?? 'multiple_choice';
  const options = parseOptions(body.options ?? [], questionType);

  const { data: question, error } = await database
    .from('questions')
    .insert({ ...fields, question_type: questionType, created_by: professorId })
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  try {
    return { ...question, options: await insertOptions(question.id, options) };
  } catch (optionsError: unknown) {
    // nothing references the question yet, so undoing the first write is a plain delete
    await database.from('questions').delete().eq('id', question.id);
    throw optionsError;
  };
};

export const listQuestions = async (professorId: number, query: Record<string, unknown>) => {
  let builder = activeOnly(database.from('questions').select('*').eq('created_by', professorId));

  if (query.questionType !== undefined) builder = builder.eq('question_type', parseQuestionType(query.questionType));

  if (query.search !== undefined) {
    if (typeof query.search !== 'string' || !query.search.trim()) throw new HttpError(400, 'search must be a non-empty string');
    builder = builder.ilike('title', `%${query.search.trim()}%`);
  };

  const { data, error } = await builder.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
};

export const getQuestion = async (professorId: number, questionIdParam: string) => {
  const questionId = parseId(questionIdParam);
  if (!questionId) throw questionNotFound();

  const question = (await findOwnedQuestion(questionId, professorId)) ?? (await findExamQuestion(questionId, professorId));
  if (!question) throw questionNotFound();

  return { ...question, options: await listOptions(question.id) };
};

export const updateQuestion = async (professorId: number, questionIdParam: string, body: Record<string, unknown>) => {
  const question = await requireOwnedQuestion(questionIdParam, professorId);
  const fields = parseQuestionFields(body);
  const replacing = body.options !== undefined;

  if (!Object.keys(fields).length && !replacing) throw new HttpError(400, 'Nothing to update');

  const questionType = fields.question_type ?? question.question_type;

  if (replacing) {
    const options = parseOptions(body.options, questionType);
    if (await hasAnswers(question.id)) throw new HttpError(409, 'This question has been answered, its options cannot be changed');

    const updated = await updateFields(question.id, fields);
    return { ...updated, options: await replaceOptions(question.id, options) };
  };

  const options = await listOptions(question.id);

  // the options the question keeps have to fit its new type
  if (fields.question_type && fields.question_type !== question.question_type) {
    parseOptions(options.map((option) => ({ optionText: option.option_text, isCorrect: option.is_correct })), questionType);
  };

  return { ...(await updateFields(question.id, fields)), options };
};

export const deleteQuestion = async (professorId: number, questionIdParam: string, body: Record<string, unknown>) => {
  const question = await requireOwnedQuestion(questionIdParam, professorId);
  const reason = parseReason(body.reason);

  if (await hasAnswers(question.id)) throw new HttpError(409, 'This question has been answered and cannot be deleted');

  const { error } = await database.from('questions').update(softDelete(reason)).eq('id', question.id);
  if (error) throw new Error(error.message);
};
