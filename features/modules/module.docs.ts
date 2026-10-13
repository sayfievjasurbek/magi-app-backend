// Modules domain: the endpoints of module.route.ts and the schemas they use (helpers in docs/common.ts).
import { authed, dateTime, envelope, errors, id, json, messageOnly, nullable, ok, pathParam, ref } from '../../docs/common.js';

export const tags = [{ name: 'Modules', description: 'Modules with their students and professors' }];

export const schemas = {
  Module: {
    type: 'object',
    properties: {
      id,
      name: { type: 'string', example: 'Algorithms' },
      created_at: dateTime,
      updated_at: dateTime,
      deleted_at: nullable(dateTime),
      reason: nullable({ type: 'string', example: 'merged into Algorithms II' }),
    },
  },
  ManagedModule: {
    type: 'object',
    description: 'A module the professor manages, with its student count and its professors',
    allOf: [
      ref('Module'),
      {
        type: 'object',
        properties: {
          student_count: { type: 'integer', example: 24 },
          professors: { type: 'array', items: ref('Person') },
        },
      },
    ],
  },
  ModuleMemberInput: {
    type: 'object',
    description: 'The member is named by email or by id; the id field is `professorId` or `studentId` depending on the list.',
    properties: {
      email: { type: 'string', format: 'email', example: 'diego.ochoa@magi.edu' },
      professorId: id,
      studentId: id,
    },
  },
};

const moduleParam = pathParam('id', 'Module id');
const memberInput = { required: true, content: json(ref('ModuleMemberInput')) };

export const paths = {
  '/api/modules': {
    post: {
      tags: ['Modules'],
      summary: 'Create a module (professor)',
      description: 'The professor who creates the module becomes its first module_professor. The name must be unique (case-insensitive) among active classes - a 409 otherwise.',
      ...authed,
      requestBody: {
        required: true,
        content: json({ type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 100, example: 'Algorithms' } } }),
      },
      responses: { '201': ok('Module created', envelope({ module: ref('Module') })), ...errors(400, 401, 403, 409) },
    },
    get: {
      tags: ['Modules'],
      summary: 'List modules (professor, student)',
      description: 'A professor gets the modules they manage with their `student_count` and `professors`, a student the modules they are enrolled in. Examiners have no access to modules.',
      ...authed,
      responses: {
        '200': ok('Modules', envelope({ modules: { type: 'array', items: ref('ManagedModule') } })),
        ...errors(401, 403),
      },
    },
  },
  '/api/modules/{id}': {
    get: {
      tags: ['Modules'],
      summary: 'Get a module (professor, student)',
      description: 'Both get the module with its `student_count` and `professors`. A module the caller neither manages nor is enrolled in answers 404.',
      ...authed,
      parameters: [moduleParam],
      responses: { '200': ok('Module', envelope({ module: ref('ManagedModule') })), ...errors(401, 403, 404) },
    },
    patch: {
      tags: ['Modules'],
      summary: 'Rename a module (professor)',
      description: 'The new name must be unique (case-insensitive) among active classes - a 409 otherwise. Keeping the current name (just a different case) is fine.',
      ...authed,
      parameters: [moduleParam],
      requestBody: {
        required: true,
        content: json({ type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 100, example: 'Algorithms II' } } }),
      },
      responses: { '200': ok('Module updated', envelope({ module: ref('Module') })), ...errors(400, 401, 403, 404, 409) },
    },
    delete: {
      tags: ['Modules'],
      summary: 'Soft delete a module (professor)',
      ...authed,
      parameters: [moduleParam],
      requestBody: { content: json({ type: 'object', properties: { reason: { type: 'string', example: 'merged into Algorithms II' } } }) },
      responses: { '200': ok('Module deleted', messageOnly), ...errors(400, 401, 403, 404) },
    },
  },
  '/api/modules/students/{studentId}': {
    get: {
      tags: ['Modules'],
      summary: 'Modules one student belongs to (professor)',
      description: 'Not scoped to modules the caller manages - any professor can look this up, same as a student\'s credentials.',
      ...authed,
      parameters: [pathParam('studentId', 'User id of the student')],
      responses: { '200': ok('Modules', envelope({ modules: { type: 'array', items: ref('Module') } })), ...errors(401, 403) },
    },
  },
  '/api/modules/professors/{professorId}': {
    get: {
      tags: ['Modules'],
      summary: 'Modules one professor is attached to (professor)',
      description: 'Not scoped to modules the caller manages - any professor can look this up, same as GET /api/modules/students/{studentId}.',
      ...authed,
      parameters: [pathParam('professorId', 'User id of the professor')],
      responses: { '200': ok('Modules', envelope({ modules: { type: 'array', items: ref('Module') } })), ...errors(401, 403) },
    },
  },
  '/api/modules/{id}/roster': {
    get: {
      tags: ['Modules'],
      summary: 'Professors and students of a module (professor, student)',
      description: 'A professor sees the roster of any module they manage, a student the roster of a class they are enrolled in.',
      ...authed,
      parameters: [moduleParam],
      responses: { '200': ok('Roster', envelope({ professors: { type: 'array', items: ref('Person') }, students: { type: 'array', items: ref('Person') } })), ...errors(401, 403, 404) },
    },
  },
  '/api/modules/{id}/rating': {
    get: {
      tags: ['Modules'],
      summary: 'Leaderboard of the module (professor, student)',
      description:
        "Every member's total score summed across this module's own graded exams, highest first. " +
        'A student only sees a module they are enrolled in, same visibility as GET /api/modules/{id}.',
      ...authed,
      parameters: [moduleParam],
      responses: {
        '200': ok(
          'Rating',
          envelope({
            rating: {
              type: 'array',
              items: { type: 'object', properties: { student: ref('Person'), total_score: { type: 'integer', example: 145 } } },
            },
          })
        ),
        ...errors(401, 403, 404),
      },
    },
  },
  '/api/modules/{id}/professors': {
    post: {
      tags: ['Modules'],
      summary: 'Add a co-professor (professor)',
      description: 'The target is named by `email` or `professorId` and has to have the professor role (400 otherwise). Already managing the module answers 409.',
      ...authed,
      parameters: [moduleParam],
      requestBody: memberInput,
      responses: { '201': ok('Professor added', envelope({ professor: ref('Person') })), ...errors(400, 401, 403, 404, 409) },
    },
  },
  '/api/modules/{id}/professors/{professorId}': {
    delete: {
      tags: ['Modules'],
      summary: 'Remove a co-professor (professor)',
      ...authed,
      parameters: [moduleParam, pathParam('professorId', 'User id of the professor')],
      responses: { '200': ok('Professor removed', messageOnly), ...errors(401, 403, 404) },
    },
  },
  '/api/modules/{id}/students': {
    post: {
      tags: ['Modules'],
      summary: 'Enroll a student (professor)',
      description: 'The target is named by `email` or `studentId` and has to have the student role (400 otherwise). An already enrolled student answers 409.',
      ...authed,
      parameters: [moduleParam],
      requestBody: memberInput,
      responses: { '201': ok('Student enrolled', envelope({ student: ref('Person') })), ...errors(400, 401, 403, 404, 409) },
    },
  },
  '/api/modules/{id}/students/{studentId}': {
    delete: {
      tags: ['Modules'],
      summary: 'Remove a student (professor)',
      ...authed,
      parameters: [moduleParam, pathParam('studentId', 'User id of the student')],
      responses: { '200': ok('Student removed', messageOnly), ...errors(401, 403, 404) },
    },
  },
};
