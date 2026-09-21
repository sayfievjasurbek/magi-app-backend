// Exams domain: document the endpoints of routes/exam.route.ts here, openapi.ts picks this file up.
import { authed, envelope, errors, id, json, messageOnly, ok, pathParam, ref } from '../common.js';
import { examStatus } from '../schemas/exam.js';

export const tags = [{ name: 'Exams', description: 'Exams, their schedule, modules, examiners, students, questions, monitored events and permitted urls' }];

const examParam = pathParam('examId', 'Id of the exam');
const created = (description: string, schema: object) => ({ '201': ok(description, schema) });

export const paths = {
  '/api/exams/events': {
    get: {
      tags: ['Exams'],
      summary: 'Catalog of the events an exam can monitor',
      description: 'One row per client event the proctoring app can report (seeded by migration 006). *professor, examiner*',
      ...authed,
      responses: { '200': ok('The catalog', envelope({ events: { type: 'array', items: ref('MonitoredEvent') } })), ...errors(401, 403) },
    },
  },
  '/api/exams': {
    get: {
      tags: ['Exams'],
      summary: 'List the exams of the current user',
      description:
        'A professor sees the exams they created plus the exams linked to a module they teach, an examiner the exams they are assigned to, ' +
        'a student the exams they are assigned to (in the reduced student shape). Ordered by scheduled start.',
      ...authed,
      responses: {
        '200': ok('The exams', envelope({ exams: { type: 'array', items: { oneOf: [ref('Exam'), ref('StudentExam')] } } })),
        ...errors(401),
      },
    },
    post: {
      tags: ['Exams'],
      summary: 'Create an exam',
      description: 'The professor who creates the exam becomes its owner (`created_by`). *professor*',
      ...authed,
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['name', 'scheduledStart', 'scheduledEnd'],
          properties: {
            name: { type: 'string', maxLength: 100, example: 'Databases, final' },
            scheduledStart: { type: 'string', format: 'date-time' },
            scheduledEnd: { type: 'string', format: 'date-time', description: 'Must be after scheduledStart' },
            status: { type: 'string', enum: ['scheduled', 'demo'], default: 'scheduled' },
            maxMarks: { type: 'integer', minimum: 0, default: 100 },
            passingMarks: { type: 'integer', minimum: 0, default: 0, description: 'Cannot be above maxMarks' },
            shuffleQuestions: { type: 'boolean', default: true },
          },
        }),
      },
      responses: { ...created('The exam', envelope({ exam: ref('Exam') })), ...errors(400, 401, 403) },
    },
  },
  '/api/exams/{examId}': {
    get: {
      tags: ['Exams'],
      summary: 'One exam',
      description:
        'A professor who manages the exam and an examiner assigned to it get everything: modules, examiners, students, monitored events, ' +
        'permitted urls and the questions with their options including `is_correct`. A student assigned to it only gets name, schedule, ' +
        'status, marks and permitted urls, never the questions.',
      ...authed,
      parameters: [examParam],
      responses: {
        '200': ok('The exam', envelope({ exam: { oneOf: [ref('ExamDetail'), ref('StudentExam')] } })),
        ...errors(401, 404),
      },
    },
    patch: {
      tags: ['Exams'],
      summary: 'Update an exam',
      description:
        'Only the fields that are sent change. The status has its own endpoint. Changing the schedule is a structural edit: 409 once the exam has attempts. *professor*',
      ...authed,
      parameters: [examParam],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 100 },
            scheduledStart: { type: 'string', format: 'date-time' },
            scheduledEnd: { type: 'string', format: 'date-time' },
            maxMarks: { type: 'integer', minimum: 0 },
            passingMarks: { type: 'integer', minimum: 0 },
            shuffleQuestions: { type: 'boolean' },
          },
        }),
      },
      responses: { '200': ok('The updated exam', envelope({ exam: ref('Exam') })), ...errors(400, 401, 403, 404, 409) },
    },
    delete: {
      tags: ['Exams'],
      summary: 'Soft delete an exam',
      description: 'Stamps `deleted_at` and keeps the reason; the row stays. *professor*',
      ...authed,
      parameters: [examParam],
      requestBody: { required: true, content: json({ type: 'object', required: ['reason'], properties: { reason: { type: 'string', example: 'replaced by the resit' } } }) },
      responses: { '200': ok('Deleted', messageOnly), ...errors(400, 401, 403, 404) },
    },
  },
  '/api/exams/{examId}/status': {
    patch: {
      tags: ['Exams'],
      summary: 'Move the exam to another status',
      description:
        'Allowed moves: scheduled → ongoing | delayed | cancelled, delayed → scheduled | ongoing | cancelled, ongoing → completed | cancelled, ' +
        'demo → ongoing | completed | cancelled. `completed` and `cancelled` are final, and anything else answers 409. ' +
        'Going `ongoing` also requires at least one question and a marks total equal to `max_marks`. *professor*',
      ...authed,
      parameters: [examParam],
      requestBody: { required: true, content: json({ type: 'object', required: ['status'], properties: { status: examStatus } }) },
      responses: { '200': ok('The updated exam', envelope({ exam: ref('Exam') })), ...errors(400, 401, 403, 404, 409) },
    },
  },
  '/api/exams/{examId}/modules': {
    post: {
      tags: ['Exams'],
      summary: 'Link a module to the exam',
      description: 'Only a module the professor teaches can be linked; any other module answers 404. Structural: 409 once the exam has attempts. *professor*',
      ...authed,
      parameters: [examParam],
      requestBody: { required: true, content: json({ type: 'object', required: ['moduleId'], properties: { moduleId: id } }) },
      responses: {
        ...created('Linked', envelope({ link: { type: 'object', properties: { exam_id: id, module_id: id } } })),
        ...errors(400, 401, 403, 404, 409),
      },
    },
  },
  '/api/exams/{examId}/modules/{moduleId}': {
    delete: {
      tags: ['Exams'],
      summary: 'Unlink a module from the exam',
      description: 'Structural: 409 once the exam has attempts. *professor*',
      ...authed,
      parameters: [examParam, pathParam('moduleId', 'Id of the module')],
      responses: { '200': ok('Unlinked', messageOnly), ...errors(401, 403, 404, 409) },
    },
  },
  '/api/exams/{examId}/examiners': {
    post: {
      tags: ['Exams'],
      summary: 'Assign an examiner to the exam',
      description: 'The user must have the examiner role. *professor*',
      ...authed,
      parameters: [examParam],
      requestBody: { required: true, content: json({ type: 'object', required: ['examinerId'], properties: { examinerId: id } }) },
      responses: {
        ...created('Assigned', envelope({ link: { type: 'object', properties: { exam_id: id, examiner_id: id } } })),
        ...errors(400, 401, 403, 404, 409),
      },
    },
  },
  '/api/exams/{examId}/examiners/{examinerId}': {
    delete: {
      tags: ['Exams'],
      summary: 'Remove an examiner from the exam',
      ...authed,
      parameters: [examParam, pathParam('examinerId', 'User id of the examiner')],
      responses: { '200': ok('Removed', messageOnly), ...errors(401, 403, 404) },
    },
  },
  '/api/exams/{examId}/students': {
    post: {
      tags: ['Exams'],
      summary: 'Assign one student, or every student of a linked module',
      description:
        'Send `studentId` for one student, who must be enrolled in one of the modules linked to the exam, or `moduleId` to assign every student ' +
        'of that module (students who are already assigned are skipped). Structural: 409 once the exam has attempts. *professor*',
      ...authed,
      parameters: [examParam],
      requestBody: {
        required: true,
        content: json({ type: 'object', properties: { studentId: id, moduleId: id }, description: 'Exactly one of studentId or moduleId' }),
      },
      responses: {
        ...created('Assigned', envelope({ added: { type: 'array', items: id, description: 'The students that were added' } })),
        ...errors(400, 401, 403, 404, 409),
      },
    },
  },
  '/api/exams/{examId}/students/{studentId}': {
    delete: {
      tags: ['Exams'],
      summary: 'Remove a student from the exam',
      description: 'Structural: 409 once the exam has attempts. *professor*',
      ...authed,
      parameters: [examParam, pathParam('studentId', 'User id of the student')],
      responses: { '200': ok('Removed', messageOnly), ...errors(401, 403, 404, 409) },
    },
  },
  '/api/exams/{examId}/questions': {
    get: {
      tags: ['Exams'],
      summary: 'The questions of the exam, with the marks total',
      description: 'Options carry `is_correct`. `marks_total` has to equal `max_marks` before the exam can go ongoing. *professor, examiner*',
      ...authed,
      parameters: [examParam],
      responses: {
        '200': ok('The questions', envelope({
          questions: { type: 'array', items: ref('ExamQuestion') },
          marks_total: { type: 'integer' },
          max_marks: { type: 'integer' },
        })),
        ...errors(401, 403, 404),
      },
    },
    post: {
      tags: ['Exams'],
      summary: 'Add a question to the exam',
      description:
        'The question must be one the professor owns or one that is already in an exam they manage. Without `position` the question is appended. ' +
        'A question that is already in the exam, or a position that is taken, answers 409. Structural: 409 once the exam has attempts. *professor*',
      ...authed,
      parameters: [examParam],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['questionId'],
          properties: { questionId: id, marks: { type: 'integer', minimum: 0, default: 1 }, position: { type: 'integer', minimum: 1 } },
        }),
      },
      responses: { ...created('Added', envelope({ question: ref('ExamQuestionLink') })), ...errors(400, 401, 403, 404, 409) },
    },
  },
  '/api/exams/{examId}/questions/order': {
    put: {
      tags: ['Exams'],
      summary: 'Reorder the questions of the exam',
      description:
        'Send every question of the exam exactly once; they are renumbered 1..n in that order. Structural: 409 once the exam has attempts. *professor*',
      ...authed,
      parameters: [examParam],
      requestBody: { required: true, content: json({ type: 'object', required: ['questionIds'], properties: { questionIds: { type: 'array', items: id } } }) },
      responses: { '200': ok('The new order', envelope({ questions: { type: 'array', items: ref('ExamQuestion') } })), ...errors(400, 401, 403, 404, 409) },
    },
  },
  '/api/exams/{examId}/questions/{questionId}': {
    patch: {
      tags: ['Exams'],
      summary: 'Change the marks a question carries in this exam',
      description: 'Structural: 409 once the exam has attempts. *professor*',
      ...authed,
      parameters: [examParam, pathParam('questionId', 'Id of the question')],
      requestBody: { required: true, content: json({ type: 'object', required: ['marks'], properties: { marks: { type: 'integer', minimum: 0 } } }) },
      responses: { '200': ok('The updated link', envelope({ question: ref('ExamQuestionLink') })), ...errors(400, 401, 403, 404, 409) },
    },
    delete: {
      tags: ['Exams'],
      summary: 'Remove a question from the exam',
      description: 'The question itself is untouched. Structural: 409 once the exam has attempts. *professor*',
      ...authed,
      parameters: [examParam, pathParam('questionId', 'Id of the question')],
      responses: { '200': ok('Removed', messageOnly), ...errors(401, 403, 404, 409) },
    },
  },
  '/api/exams/{examId}/events': {
    post: {
      tags: ['Exams'],
      summary: 'Monitor a catalog event during the exam',
      description: 'The event comes from `GET /api/exams/events`. *professor*',
      ...authed,
      parameters: [examParam],
      requestBody: { required: true, content: json({ type: 'object', required: ['eventId'], properties: { eventId: id } }) },
      responses: { ...created('Monitored', envelope({ event: ref('MonitoredEvent') })), ...errors(400, 401, 403, 404, 409) },
    },
  },
  '/api/exams/{examId}/events/{eventId}': {
    delete: {
      tags: ['Exams'],
      summary: 'Stop monitoring an event during the exam',
      ...authed,
      parameters: [examParam, pathParam('eventId', 'Id of the catalog event')],
      responses: { '200': ok('Removed', messageOnly), ...errors(401, 403, 404) },
    },
  },
  '/api/exams/{examId}/permitted-urls': {
    post: {
      tags: ['Exams'],
      summary: 'Permit a url during the exam',
      description: 'Only http and https addresses. An address that is already stored is reused instead of duplicated. *professor*',
      ...authed,
      parameters: [examParam],
      requestBody: { required: true, content: json({ type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri', example: 'https://docs.python.org/3/' } } }) },
      responses: { ...created('Permitted', envelope({ permitted_url: ref('PermittedUrl') })), ...errors(400, 401, 403, 404, 409) },
    },
  },
  '/api/exams/{examId}/permitted-urls/{permittedUrlId}': {
    delete: {
      tags: ['Exams'],
      summary: 'Stop permitting a url during the exam',
      description: 'The address itself stays, other exams may permit it too. *professor*',
      ...authed,
      parameters: [examParam, pathParam('permittedUrlId', 'Id of the permitted url')],
      responses: { '200': ok('Removed', messageOnly), ...errors(401, 403, 404) },
    },
  },
};
