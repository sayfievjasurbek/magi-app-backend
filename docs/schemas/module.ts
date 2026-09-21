// Modules domain: the schemas used by docs/paths/module.ts (helpers in docs/common.ts).
import { dateTime, id, nullable, ref } from '../common.js';

export const schemas = {
  Module: {
    type: 'object',
    properties: {
      id,
      name: { type: 'string', example: 'Algorithms' },
      created_at: dateTime,
      updated_at: dateTime,
      deleted_at: nullable(dateTime),
      reason: nullable({ type: 'string' }),
    },
  },
  ManagedModule: {
    type: 'object',
    description: 'A module the professor manages, with the number of students enrolled in it',
    allOf: [ref('Module'), { type: 'object', properties: { student_count: { type: 'integer', example: 24 } } }],
  },
  ModuleMemberInput: {
    type: 'object',
    description: 'The member is named by email or by id; the id field is `professorId` or `studentId` depending on the list.',
    properties: {
      email: { type: 'string', format: 'email' },
      professorId: id,
      studentId: id,
    },
  },
};
