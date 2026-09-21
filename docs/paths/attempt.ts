// Attempts domain: document the endpoints of routes/attempt.route.ts here, openapi.ts picks this file up.
import { authed, envelope, errors, id, json, ok, pathParam, ref } from '../common.js';

export const tags = [{ name: 'Attempts', description: 'A student sitting an exam: answers, timing and score (table assignments)' }];

const attemptId = pathParam('id', 'Attempt id (assignments.id)');

export const paths = {
  '/api/assignments': {
    post: {
      tags: ['Attempts'],
      summary: 'Start an attempt (student)',
      description:
        'Only for an exam the student is assigned to, inside `[scheduled_start, scheduled_end]` and while the exam is demo, scheduled or ongoing. ' +
        'Creates the attempt in `in_progress`, one row per exam question in a stable order (shuffled per attempt when the exam shuffles) and copies the permitted urls of the exam. ' +
        'The time limit is the sum of the expected duration of the questions, capped by what is left of the exam window, and falls back to the rest of the window when the questions expect nothing. ' +
        'A second attempt at the same exam is a 409.',
      ...authed,
      requestBody: { required: true, content: json({ type: 'object', required: ['examId'], properties: { examId: id } }) },
      responses: { '201': ok('Attempt started', envelope({ attempt: ref('StudentAttemptDetail') })), ...errors(400, 401, 403, 404, 409) },
    },
    get: {
      tags: ['Attempts'],
      summary: 'Attempts of one exam (professor, examiner)',
      description: 'The professor has to manage the exam (they created it, or they teach one of its modules), the examiner has to be assigned to it; otherwise 404. Oldest first, at most 500.',
      ...authed,
      parameters: [
        { name: 'examId', in: 'query', required: true, description: 'Exam to list the attempts of', schema: id },
        {
          name: 'status',
          in: 'query',
          required: false,
          description: 'Keep only the attempts in this status',
          schema: { type: 'string', enum: ['pending', 'in_progress', 'submitted', 'auto_submitted', 'graded', 'flagged'] },
        },
      ],
      responses: { '200': ok('Attempts of the exam', envelope({ attempts: { type: 'array', items: ref('StaffAttempt') } })), ...errors(400, 401, 403, 404) },
    },
  },
  '/api/assignments/my': {
    get: {
      tags: ['Attempts'],
      summary: 'My attempts (student)',
      description: 'Every attempt of the caller, newest first. The score appears only once the attempt is graded. Attempts are not auto submitted from this list, only from the endpoints that touch one attempt.',
      ...authed,
      responses: { '200': ok('Attempts of the caller', envelope({ attempts: { type: 'array', items: ref('StudentAttempt') } })), ...errors(401, 403) },
    },
  },
  '/api/assignments/{id}': {
    get: {
      tags: ['Attempts'],
      summary: 'One attempt',
      description:
        'A student reads their own attempt: the questions in their order, the options **without** `is_correct`, their own answers and the remaining time. ' +
        'A professor managing the exam (as its owner or through one of its modules) or an examiner assigned to it reads it in full: correct options, typing metrics, paste ratio, marks and score. ' +
        'An attempt whose time ran out is submitted automatically before it is returned. Anything else is a 404.',
      ...authed,
      parameters: [attemptId],
      responses: {
        '200': ok('The attempt, as much of it as the caller may see', envelope({ attempt: { oneOf: [ref('StudentAttemptDetail'), ref('StaffAttemptDetail')] } })),
        ...errors(401, 403, 404),
      },
    },
  },
  '/api/assignments/{id}/answers': {
    put: {
      tags: ['Attempts'],
      summary: 'Sync answers (student)',
      description:
        'Writes a batch of answers, chosen options and typing metrics. Only while the attempt is open and inside its time limit: an attempt past its limit is submitted automatically and the call answers 409. ' +
        'The whole batch is validated before anything is written; a question that is not part of the attempt or an option that does not belong to its question is a 400.',
      ...authed,
      parameters: [attemptId],
      requestBody: {
        required: true,
        content: json({ type: 'object', required: ['answers'], properties: { answers: { type: 'array', minItems: 1, items: ref('AnswerSync') } } }),
      },
      responses: {
        '200': ok('Answers written', envelope({ synced: { type: 'integer' }, remaining_seconds: { type: 'integer' } })),
        ...errors(400, 401, 403, 404, 409),
      },
    },
  },
  '/api/assignments/{id}/submit': {
    post: {
      tags: ['Attempts'],
      summary: 'Submit an attempt (student)',
      description:
        'Stamps `submitted_at`, grades the multiple choice and true/false answers (all or nothing on the option set) and stores the total. ' +
        'The status becomes `graded` right away when the exam has no question to grade by hand, `submitted` otherwise, and `auto_submitted` when the time had already run out (`auto_submitted` is then true). ' +
        'A flagged attempt keeps the status `flagged` in the database until a professor grades it, but the student is answered with `submitted` or `auto_submitted`. Submitting twice is a 409.',
      ...authed,
      parameters: [attemptId],
      responses: {
        '200': ok('Attempt submitted', envelope({ attempt: ref('StudentAttempt'), message: { type: 'string' } })),
        ...errors(401, 403, 404, 409),
      },
    },
  },
  '/api/assignments/{id}/grade': {
    put: {
      tags: ['Attempts'],
      summary: 'Grade an attempt (professor)',
      description:
        'Marks the short answer and essay questions of a submitted attempt; the objective questions keep the marks given at submit. ' +
        'The total is the sum of every awarded mark, never above `exams.max_marks`, and the status becomes `graded`. Regrading is allowed, marks that are left out stay as they are.',
      ...authed,
      parameters: [attemptId],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          properties: {
            marks: { type: 'array', items: ref('QuestionMark') },
            feedback: { type: 'string', description: 'Note for the student, shown once the attempt is graded' },
          },
        }),
      },
      responses: { '200': ok('Attempt graded', envelope({ attempt: ref('StaffAttempt') })), ...errors(400, 401, 403, 404, 409) },
    },
  },
};
