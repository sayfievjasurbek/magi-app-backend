// Questions domain: the schemas used by docs/paths/question.ts (helpers in docs/common.ts).
import { dateTime, id, nullable, ref } from '../common.js';

const questionType = { type: 'string', enum: ['multiple_choice', 'true_false', 'short_answer', 'essay'] };
const timeUnit = { type: 'string', enum: ['seconds', 'minutes', 'hours', 'days'] };

export const schemas = {
  QuestionOption: {
    type: 'object',
    description: '`is_correct` is only ever sent to staff, never to a student.',
    properties: {
      id,
      question_id: id,
      option_text: { type: 'string', example: '42' },
      is_correct: { type: 'boolean' },
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
      reason: nullable({ type: 'string' }),
    },
  },
  QuestionWithOptions: {
    type: 'object',
    allOf: [ref('Question'), { type: 'object', properties: { options: { type: 'array', items: ref('QuestionOption') } } }],
  },
  QuestionOptionInput: {
    type: 'object',
    required: ['optionText'],
    properties: { optionText: { type: 'string', example: 'O(log n)' }, isCorrect: { type: 'boolean', default: false } },
  },
  QuestionInput: {
    type: 'object',
    description:
      'The option set has to match the type: `multiple_choice` at least 2 options and at least 1 correct, ' +
      '`true_false` exactly 2 options and exactly 1 correct, `short_answer` and `essay` no options at all.',
    properties: {
      title: { type: 'string', maxLength: 100 },
      questionType,
      question: { type: 'string' },
      expectedDuration: { type: 'integer', minimum: 0 },
      expectedDurationUnit: timeUnit,
      options: { type: 'array', items: ref('QuestionOptionInput') },
    },
  },
};
