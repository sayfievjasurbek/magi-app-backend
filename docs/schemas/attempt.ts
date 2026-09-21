// Attempts domain: the schemas used by docs/paths/attempt.ts (helpers in docs/common.ts).
import { dateTime, id, nullable, ref } from '../common.js';

const timeUnit = { type: 'string', enum: ['seconds', 'minutes', 'hours', 'days'] };
const attemptStatus = { type: 'string', enum: ['pending', 'in_progress', 'submitted', 'auto_submitted', 'graded', 'flagged'] };
// `flagged` is staff business: a student reads in_progress while the attempt runs, submitted or auto_submitted afterwards
const studentAttemptStatus = { type: 'string', enum: ['pending', 'in_progress', 'submitted', 'auto_submitted', 'graded'] };

const answerFields = {
  answer: { type: 'string', description: 'The text the student typed (empty for a pure choice question)' },
  selected_option_ids: { type: 'array', items: id },
  typing_duration: { type: 'integer' },
  typing_duration_unit: timeUnit,
  text_typed: { type: 'integer', description: 'Characters typed by hand' },
  text_edited: { type: 'integer' },
  text_pasted: { type: 'integer', description: 'Characters pasted into the answer' },
  started_at: nullable(dateTime),
  answered_at: nullable(dateTime),
  last_synced_at: nullable(dateTime),
};

const questionFields = {
  question_id: id,
  position: { type: 'integer', description: 'Order of the question in this attempt (shuffled per attempt when the exam shuffles)' },
  title: { type: 'string' },
  question: { type: 'string' },
  question_type: { type: 'string', enum: ['multiple_choice', 'true_false', 'short_answer', 'essay'] },
  expected_duration: { type: 'integer' },
  expected_duration_unit: timeUnit,
  marks: { type: 'integer', description: 'What the question is worth in this exam (exam_question.marks)' },
};

const attemptFields = (status: object) => ({
  id,
  exam_id: id,
  status,
  started_at: nullable(dateTime),
  submitted_at: nullable(dateTime),
  auto_submitted: { type: 'boolean', description: 'The time ran out and the attempt was closed by the server' },
  session_duration: { type: 'integer' },
  session_duration_unit: timeUnit,
  expires_at: dateTime,
  remaining_seconds: { type: 'integer', description: '0 once the attempt is closed' },
  exam: ref('AttemptExam'),
});

export const schemas = {
  AttemptExam: {
    type: 'object',
    properties: {
      id,
      name: { type: 'string' },
      scheduled_start: dateTime,
      scheduled_end: dateTime,
      status: { type: 'string', enum: ['demo', 'scheduled', 'ongoing', 'completed', 'delayed', 'cancelled'] },
      max_marks: { type: 'integer' },
      passing_marks: { type: 'integer' },
    },
  },
  AttemptOption: {
    type: 'object',
    properties: { id, option_text: { type: 'string' } },
  },
  StaffAttemptOption: {
    type: 'object',
    properties: { id, option_text: { type: 'string' }, is_correct: { type: 'boolean' } },
  },
  StudentAttemptQuestion: {
    type: 'object',
    description: 'A question as the student sees it: no is_correct anywhere, marks_awarded only once the attempt is graded.',
    properties: {
      ...questionFields,
      options: { type: 'array', items: ref('AttemptOption') },
      ...answerFields,
      marks_awarded: { type: 'integer', description: 'Only present when the attempt is graded' },
    },
  },
  StaffAttemptQuestion: {
    type: 'object',
    properties: {
      ...questionFields,
      options: { type: 'array', items: ref('StaffAttemptOption') },
      ...answerFields,
      marks_awarded: { type: 'integer' },
      paste_ratio: nullable({ type: 'number', description: 'text_pasted / (text_typed + text_pasted), null when nothing was written' }),
    },
  },
  StudentAttempt: {
    type: 'object',
    description: 'score, passed and feedback appear only once the status is graded; the student is never told the attempt is flagged.',
    properties: {
      ...attemptFields(studentAttemptStatus),
      score: { type: 'integer' },
      passed: { type: 'boolean' },
      feedback: nullable({ type: 'string' }),
    },
  },
  StudentAttemptDetail: {
    allOf: [
      ref('StudentAttempt'),
      {
        type: 'object',
        properties: {
          questions: { type: 'array', items: ref('StudentAttemptQuestion') },
          permitted_urls: { type: 'array', items: ref('PermittedUrl') },
        },
      },
    ],
  },
  StaffAttempt: {
    type: 'object',
    properties: {
      ...attemptFields(attemptStatus),
      score: { type: 'integer' },
      passed: nullable({ type: 'boolean', description: 'null while the attempt is not graded' }),
      feedback: nullable({ type: 'string' }),
      student: nullable(ref('Person')),
    },
  },
  StaffAttemptDetail: {
    allOf: [
      ref('StaffAttempt'),
      { type: 'object', properties: { questions: { type: 'array', items: ref('StaffAttemptQuestion') } } },
    ],
  },
  AnswerSync: {
    type: 'object',
    required: ['questionId'],
    description: 'Every field but questionId is optional: only what is sent is written.',
    properties: {
      questionId: id,
      answer: { type: 'string' },
      optionIds: { type: 'array', items: id, description: 'Replaces the chosen options of that question; [] clears them' },
      typingDuration: { type: 'integer', minimum: 0 },
      typingDurationUnit: timeUnit,
      textTyped: { type: 'integer', minimum: 0 },
      textEdited: { type: 'integer', minimum: 0 },
      textPasted: { type: 'integer', minimum: 0 },
      startedAt: dateTime,
      answeredAt: dateTime,
    },
  },
  QuestionMark: {
    type: 'object',
    required: ['questionId', 'marks'],
    properties: {
      questionId: id,
      marks: { type: 'integer', minimum: 0, description: 'Never more than exam_question.marks of that question' },
    },
  },
};
