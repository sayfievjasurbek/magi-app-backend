import { authed, envelope, errors, id, json, nullable, ok, pathParam, ref } from '../../docs/common.js';

export const tags = [{ name: 'Attendance', description: "A class's day-by-day attendance roster" }];

const dateParam = {
  name: 'date',
  in: 'query',
  required: true,
  description: 'YYYY-MM-DD',
  schema: { type: 'string', example: '2026-03-12' },
};

export const schemas = {
  AttendanceEntry: {
    type: 'object',
    properties: {
      student_id: id,
      present: nullable({ type: 'boolean', example: true }),
    },
  },
};

export const paths = {
  '/api/attendance/modules/{id}': {
    get: {
      tags: ['Attendance'],
      summary: "One day of a class's attendance (professor)",
      description:
        'Every student enrolled in the class, for the given day - `present` is `null` for a student nobody has marked yet. *professor*',
      ...authed,
      parameters: [pathParam('id', 'Module (classes.id)'), dateParam],
      responses: {
        '200': ok('Attendance for that day', envelope({ attendance: { type: 'array', items: ref('AttendanceEntry') } })),
        ...errors(400, 401, 403, 404),
      },
    },
  },
  '/api/attendance/modules/{id}/students/{studentId}': {
    put: {
      tags: ['Attendance'],
      summary: 'Mark one student present or absent for a day (professor)',
      ...authed,
      parameters: [pathParam('id', 'Module (classes.id)'), pathParam('studentId', 'Student (students.user_id)')],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['date', 'present'],
          properties: {
            date: { type: 'string', example: '2026-03-12', description: 'YYYY-MM-DD' },
            present: { type: 'boolean', example: true },
          },
        }),
      },
      responses: {
        '200': ok('Saved', envelope({ entry: ref('AttendanceEntry') })),
        ...errors(400, 401, 403, 404),
      },
    },
  },
};
