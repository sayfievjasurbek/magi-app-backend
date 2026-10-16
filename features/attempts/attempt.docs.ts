// Attempts domain: the endpoints of attempt.route.ts and the schemas they use (helpers in docs/common.ts).
import { authed, dateTime, envelope, errors, id, json, nullable, ok, pathParam, ref } from '../../docs/common.js';

export const tags = [{ name: 'Attempts', description: 'A student sitting an exam: answers, timing and score (table assignments)' }];

const timeUnit = { type: 'string', enum: ['seconds', 'minutes', 'hours', 'days'], example: 'seconds' };
const attemptStatus = { type: 'string', enum: ['pending', 'in_progress', 'submitted', 'auto_submitted', 'graded', 'flagged'], example: 'submitted' };
// `flagged` is staff business: a student reads in_progress while the attempt runs, submitted or auto_submitted afterwards
const studentAttemptStatus = { type: 'string', enum: ['pending', 'in_progress', 'submitted', 'auto_submitted', 'graded'], example: 'in_progress' };

const answerFields = {
  answer: { type: 'string', example: 'It removes the transitive dependency of a non key column on another non key column.', description: 'The text the student typed (empty for a pure choice question)' },
  selected_option_ids: { type: 'array', items: id },
  typing_duration: { type: 'integer', example: 240 },
  typing_duration_unit: timeUnit,
  text_typed: { type: 'integer', example: 412, description: 'Characters typed by hand' },
  text_edited: { type: 'integer', example: 37 },
  text_pasted: { type: 'integer', example: 58, description: 'Characters pasted into the answer' },
  started_at: nullable(dateTime),
  answered_at: nullable(dateTime),
  last_synced_at: nullable(dateTime),
};

const questionFields = {
  question_id: id,
  position: { type: 'integer', example: 1, description: 'Order of the question in this attempt (shuffled per attempt when the exam shuffles)' },
  title: { type: 'string', example: 'Third normal form' },
  question: { type: 'string', example: 'Which anomaly does the third normal form remove?' },
  question_type: { type: 'string', enum: ['multiple_choice', 'true_false', 'short_answer', 'essay'], example: 'short_answer' },
  expected_duration: { type: 'integer', example: 90 },
  expected_duration_unit: timeUnit,
  marks: { type: 'integer', example: 10, description: 'What the question is worth in this exam (exam_question.marks)' },
};

const attemptFields = (status: object) => ({
  id,
  exam_id: id,
  status,
  started_at: nullable(dateTime),
  submitted_at: nullable(dateTime),
  auto_submitted: { type: 'boolean', example: false, description: 'The time ran out and the attempt was closed by the server' },
  session_duration: { type: 'integer', example: 5400 },
  session_duration_unit: timeUnit,
  expires_at: dateTime,
  remaining_seconds: { type: 'integer', example: 2700, description: '0 once the attempt is closed' },
  exam: ref('AttemptExam'),
});

export const schemas = {
  AttemptExam: {
    type: 'object',
    properties: {
      id,
      name: { type: 'string', example: 'Databases, final' },
      scheduled_start: dateTime,
      scheduled_end: dateTime,
      status: { type: 'string', enum: ['demo', 'scheduled', 'ongoing', 'completed', 'delayed', 'cancelled'], example: 'ongoing' },
      max_marks: { type: 'integer', example: 100 },
      passing_marks: { type: 'integer', example: 40 },
    },
  },
  AttemptOption: {
    type: 'object',
    properties: { id, option_text: { type: 'string', example: 'A transitive dependency on a non key column' } },
  },
  StaffAttemptOption: {
    type: 'object',
    properties: { id, option_text: { type: 'string', example: 'A transitive dependency on a non key column' }, is_correct: { type: 'boolean', example: true } },
  },
  StudentAttemptQuestion: {
    type: 'object',
    description: 'A question as the student sees it: no is_correct anywhere, marks_awarded only once the attempt is graded.',
    properties: {
      ...questionFields,
      options: { type: 'array', items: ref('AttemptOption') },
      ...answerFields,
      marks_awarded: { type: 'integer', example: 8, description: 'Only present when the attempt is graded' },
    },
  },
  StaffAttemptQuestion: {
    type: 'object',
    properties: {
      ...questionFields,
      options: { type: 'array', items: ref('StaffAttemptOption') },
      ...answerFields,
      marks_awarded: { type: 'integer', example: 8 },
      paste_ratio: nullable({ type: 'number', example: 0.12, description: 'text_pasted / (text_typed + text_pasted), null when nothing was written' }),
    },
  },
  StudentAttempt: {
    type: 'object',
    description: 'score, passed and feedback appear only once the status is graded; the student is never told the attempt is flagged.',
    properties: {
      ...attemptFields(studentAttemptStatus),
      score: { type: 'integer', example: 78 },
      passed: { type: 'boolean', example: true },
      feedback: nullable({ type: 'string', example: 'Good answers, watch the normalisation detail.' }),
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
      score: { type: 'integer', example: 78 },
      passed: nullable({ type: 'boolean', example: true, description: 'null while the attempt is not graded' }),
      feedback: nullable({ type: 'string', example: 'Good answers, watch the normalisation detail.' }),
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
      answer: { type: 'string', example: 'It removes the transitive dependency of a non key column on another non key column.' },
      optionIds: { type: 'array', items: id, description: 'Replaces the chosen options of that question; [] clears them' },
      typingDuration: { type: 'integer', minimum: 0, example: 240 },
      typingDurationUnit: timeUnit,
      textTyped: { type: 'integer', minimum: 0, example: 412 },
      textEdited: { type: 'integer', minimum: 0, example: 37 },
      textPasted: { type: 'integer', minimum: 0, example: 58 },
      startedAt: dateTime,
      answeredAt: dateTime,
    },
  },
  QuestionMark: {
    type: 'object',
    required: ['questionId', 'marks'],
    properties: {
      questionId: id,
      marks: { type: 'integer', minimum: 0, example: 8, description: 'Never more than exam_question.marks of that question' },
    },
  },
  AiQuestionReview: {
    type: 'object',
    properties: {
      question_id: id,
      percent_correct: { type: 'integer', example: 80, description: "AI's estimate of how much of the ideal answer this covers" },
      reasoning: { type: 'string', example: 'Covers the definition and one example, missing the edge case.' },
    },
  },
  AiReview: {
    type: 'object',
    description: 'A suggestion only - never writes to marks_awarded or the attempt score, which stay entirely the professor\'s own call via PUT .../grade.',
    properties: {
      cheating_likelihood: { type: 'string', enum: ['low', 'medium', 'high'], example: 'low' },
      cheating_reasoning: { type: 'string', example: 'Written in the student\'s own voice, typed steadily with no large pastes.' },
      per_question: { type: 'array', items: ref('AiQuestionReview') },
    },
  },
};

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
          schema: { type: 'string', enum: ['pending', 'in_progress', 'submitted', 'auto_submitted', 'graded', 'flagged'], example: 'submitted' },
        },
      ],
      responses: { '200': ok('Attempts of the exam', envelope({ attempts: { type: 'array', items: ref('StaffAttempt') } })), ...errors(400, 401, 403, 404) },
    },
  },
  '/api/assignments/summary': {
    get: {
      tags: ['Attempts'],
      summary: 'Attempt counts per exam (professor)',
      description:
        'Students/awaiting/graded counts for every exam the caller manages, in a fixed number of queries - built for the admin panel\'s Attempts ' +
        'overview, which used to call GET /api/assignments once per exam to build this same table.',
      ...authed,
      responses: {
        '200': ok(
          'Counts per exam',
          envelope({
            summary: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  exam_id: id,
                  students: { type: 'integer', example: 24, description: 'Students the exam is assigned to' },
                  awaiting: { type: 'integer', example: 3, description: 'Submitted or flagged, not graded yet' },
                  graded: { type: 'integer', example: 21 },
                },
              },
            },
          })
        ),
        ...errors(401, 403),
      },
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
        '200': ok('Answers written', envelope({ synced: { type: 'integer', example: 12 }, remaining_seconds: { type: 'integer', example: 2700 } })),
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
        '200': ok('Attempt submitted', envelope({ attempt: ref('StudentAttempt'), message: { type: 'string', example: 'Your answers have been submitted' } })),
        ...errors(401, 403, 404, 409),
      },
    },
  },
  '/api/assignments/{id}/grade': {
    put: {
      tags: ['Attempts'],
      summary: 'Grade an attempt (professor)',
      description:
        'Either `score` or `marks`, not both. `score` sets the whole attempt\'s total directly - one overall grade instead of marking each ' +
        'manually-graded question. `marks` marks the short answer and essay questions one at a time instead; the objective questions keep the marks given ' +
        'at submit, and the total is the sum of every awarded mark, never above `exams.max_marks`. Either way the status becomes `graded` and regrading is allowed.',
      ...authed,
      parameters: [attemptId],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          properties: {
            score: { type: 'integer', minimum: 0, example: 72, description: 'Sets the attempt\'s total directly, capped at exams.max_marks' },
            marks: { type: 'array', items: ref('QuestionMark') },
            feedback: { type: 'string', example: 'Good answers, watch the normalisation detail.', description: 'Note for the student, shown once the attempt is graded' },
          },
        }),
      },
      responses: { '200': ok('Attempt graded', envelope({ attempt: ref('StaffAttempt') })), ...errors(400, 401, 403, 404, 409) },
    },
  },
  '/api/assignments/{id}/ai-review': {
    post: {
      tags: ['Attempts'],
      summary: 'AI-assisted review of a submitted attempt (professor)',
      description:
        'Asks AI to estimate how correct each short answer/essay answer is against the question (and the question\'s model_answers, if any are set), and how ' +
        'likely the answers were AI-written, using both the writing itself and the typing/paste metrics already captured. Runs automatically right after the student submits; ' +
        'this endpoint re-reads that cached result, or redoes it when `force` is passed (e.g. the model answers changed since). A 503 when OPENAI_API_KEY is not set on the ' +
        'server - check GET /api/ai/status first. A 400 when there is nothing to review (no answered short answer/essay question in the exam).',
      ...authed,
      parameters: [attemptId],
      requestBody: { content: json({ type: 'object', properties: { force: { type: 'boolean', example: false } } }) },
      responses: { '200': ok('Review', envelope({ review: ref('AiReview') })), ...errors(400, 401, 403, 404, 409, 503) },
    },
  },
};
