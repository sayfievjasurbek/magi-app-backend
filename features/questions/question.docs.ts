// Questions domain: the endpoints of question.route.ts and the schemas they use (helpers in docs/common.ts).
import { authed, dateTime, envelope, errors, id, json, messageOnly, nullable, ok, pathParam, ref } from '../../docs/common.js';

export const tags = [{ name: 'Questions', description: 'Questions and their options' }];

const questionType = { type: 'string', enum: ['multiple_choice', 'true_false', 'short_answer', 'essay'], example: 'multiple_choice' };
const timeUnit = { type: 'string', enum: ['seconds', 'minutes', 'hours', 'days'], example: 'seconds' };

export const schemas = {
  QuestionOption: {
    type: 'object',
    description: '`is_correct` is only ever sent to staff, never to a student.',
    properties: {
      id,
      question_id: id,
      option_text: { type: 'string', example: '42' },
      is_correct: { type: 'boolean', example: true },
      created_at: dateTime,
      updated_at: dateTime,
    },
  },
  Question: {
    type: 'object',
    properties: {
      id,
      title: { type: 'string', maxLength: 100, example: 'Complexity of binary search' },
      question_type: questionType,
      question: { type: 'string', example: 'What is the worst case complexity of binary search?' },
      expected_duration: { type: 'integer', example: 90 },
      expected_duration_unit: timeUnit,
      created_by: id,
      created_at: dateTime,
      updated_at: dateTime,
      deleted_at: nullable(dateTime),
      reason: nullable({ type: 'string', example: 'replaced by a clearer wording' }),
    },
  },
  QuestionWithOptions: {
    type: 'object',
    allOf: [ref('Question'), { type: 'object', properties: { options: { type: 'array', items: ref('QuestionOption') } } }],
  },
  QuestionOptionInput: {
    type: 'object',
    required: ['optionText'],
    properties: { optionText: { type: 'string', example: 'O(log n)' }, isCorrect: { type: 'boolean', default: false, example: true } },
  },
  QuestionInput: {
    type: 'object',
    description:
      'The option set has to match the type: `multiple_choice` at least 2 options and at least 1 correct, ' +
      '`true_false` exactly 2 options and exactly 1 correct, `short_answer` and `essay` no options at all.',
    properties: {
      title: { type: 'string', maxLength: 100, example: 'Complexity of binary search' },
      questionType,
      question: { type: 'string', example: 'What is the worst case complexity of binary search?' },
      expectedDuration: { type: 'integer', minimum: 0, example: 90 },
      expectedDurationUnit: timeUnit,
      options: { type: 'array', items: ref('QuestionOptionInput') },
    },
  },
};

const questionParam = pathParam('id', 'Question id');

export const paths = {
  '/api/questions': {
    post: {
      tags: ['Questions'],
      summary: 'Create a question with its options (professor)',
      description: 'Question and options are written in one call; if the options cannot be written the question is removed again.',
      ...authed,
      requestBody: { required: true, content: json(ref('QuestionInput')) },
      responses: { '201': ok('Question created', envelope({ question: ref('QuestionWithOptions') })), ...errors(400, 401, 403) },
    },
    get: {
      tags: ['Questions'],
      summary: 'List own questions (professor)',
      ...authed,
      parameters: [
        { name: 'questionType', in: 'query', required: false, description: 'Only questions of this type', schema: { type: 'string', enum: ['multiple_choice', 'true_false', 'short_answer', 'essay'], example: 'multiple_choice' } },
        { name: 'search', in: 'query', required: false, description: 'Case insensitive match on the title', schema: { type: 'string', example: 'binary search' } },
      ],
      responses: { '200': ok('Questions', envelope({ questions: { type: 'array', items: ref('Question') } })), ...errors(400, 401, 403) },
    },
  },
  '/api/questions/{id}': {
    get: {
      tags: ['Questions'],
      summary: 'Get a question with its options (professor)',
      description: 'Readable by the professor who owns the question and by a professor whose exam asks it. Anything else answers 404.',
      ...authed,
      parameters: [questionParam],
      responses: { '200': ok('Question', envelope({ question: ref('QuestionWithOptions') })), ...errors(401, 403, 404) },
    },
    patch: {
      tags: ['Questions'],
      summary: 'Update a question (owner)',
      description:
        'Sending `options` replaces the whole option set; once a student has answered the question that answers 409. ' +
        'A new `questionType` without `options` is only accepted when the options the question keeps fit it.',
      ...authed,
      parameters: [questionParam],
      requestBody: { required: true, content: json(ref('QuestionInput')) },
      responses: { '200': ok('Question updated', envelope({ question: ref('QuestionWithOptions') })), ...errors(400, 401, 403, 404, 409) },
    },
    delete: {
      tags: ['Questions'],
      summary: 'Soft delete a question (owner)',
      description: 'A question a student has already answered cannot be deleted (409).',
      ...authed,
      parameters: [questionParam],
      requestBody: { content: json({ type: 'object', properties: { reason: { type: 'string', example: 'replaced by a clearer wording' } } }) },
      responses: { '200': ok('Question deleted', messageOnly), ...errors(400, 401, 403, 404, 409) },
    },
  },
};
