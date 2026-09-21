const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const uuid = { type: 'string', format: 'uuid' };
const dateTime = { type: 'string', format: 'date-time' };
// siblings of $ref are ignored in OpenAPI 3.0, so a nullable reference (always an object here) is wrapped in allOf,
// nullable only takes effect next to an explicit type, and a nullable enum has to list null itself
const nullable = (schema: Record<string, any>) => {
  if ('$ref' in schema) return { type: 'object', allOf: [schema], nullable: true };
  return { ...schema, nullable: true, ...('enum' in schema ? { enum: [...schema.enum, null] } : {}) };
};

const envelope = (properties: Record<string, object> = {}) => ({
  type: 'object',
  properties: { success: { type: 'boolean', example: true }, ...properties },
});

const json = (schema: object) => ({ 'application/json': { schema } });
const ok = (description: string, schema: object) => ({ description, content: json(schema) });
const errorResponse = (name: string) => ({ $ref: `#/components/responses/${name}` });

const pathParam = (name: string, description: string) => ({
  name, in: 'path', required: true, description, schema: uuid,
});

const authed = { security: [{ cookieAuth: [] }] };
const errors = (...statuses: number[]) => {
  const names: Record<number, string> = { 400: 'BadRequest', 401: 'Unauthorized', 403: 'Forbidden', 404: 'NotFound', 409: 'Conflict' };
  return Object.fromEntries(statuses.map((status) => [String(status), errorResponse(names[status] as string)]));
};

const messageOnly = envelope({ message: { type: 'string' } });

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'MAGI API',
    version: '1.0.0',
    description:
      'Backend of MAGI University: authentication, classes, assignments, forensic submissions, grading and dashboards.\n\n' +
      '**Authentication:** call `POST /api/auth/login` from this page. The server sets an httpOnly `jwt` cookie and the browser sends it on every following request. ' +
      'Endpoints marked *professor* or *student* return 403 for the other role.\n\n' +
      '**Conventions:** request bodies are camelCase, responses are snake_case. Every response has a `success` flag; errors are `{ success: false, message }`. ' +
      'Resources that belong to someone else answer 404 instead of 403 so their existence is not leaked.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Auth', description: 'Sign up, verification, login, password reset' },
    { name: 'Classes', description: 'Classrooms and enrollment' },
    { name: 'Assignments', description: 'Assignments of a class' },
    { name: 'Submissions', description: 'Student submissions, forensic dossier and grading' },
    { name: 'Dashboards', description: 'Aggregated views for the dashboards' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'jwt', description: 'Set by POST /api/auth/login' },
    },
    responses: {
      BadRequest: ok('Invalid input', ref('Error')),
      Unauthorized: ok('Missing, invalid or expired token', ref('Error')),
      Forbidden: ok('The role of the current user is not allowed here', ref('Error')),
      NotFound: ok('Not found (or not visible to the current user)', ref('Error')),
      Conflict: ok('Already exists', ref('Error')),
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { success: { type: 'boolean', example: false }, message: { type: 'string' } },
      },
      TokenPayload: {
        type: 'object',
        properties: {
          id: uuid,
          first_name: { type: 'string' },
          last_name: nullable({ type: 'string' }),
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['student', 'professor'] },
          iat: { type: 'integer' },
          exp: { type: 'integer' },
        },
      },
      Person: {
        type: 'object',
        properties: { id: uuid, first_name: { type: 'string' }, last_name: nullable({ type: 'string' }) },
      },
      ClassRef: {
        type: 'object',
        properties: { id: uuid, code: { type: 'string' }, name: { type: 'string' } },
      },
      Class: {
        type: 'object',
        properties: {
          id: uuid,
          code: { type: 'string', example: 'CS-301' },
          name: { type: 'string', example: 'Cryptography Standards' },
          description: nullable({ type: 'string' }),
          cycle: nullable({ type: 'string', example: 'Fall 2026' }),
          credits: nullable({ type: 'integer', minimum: 1 }),
          status: { type: 'string', enum: ['draft', 'synced', 'audited', 'pending_update'] },
          professor_id: uuid,
          created_at: dateTime,
          updated_at: dateTime,
        },
      },
      ClassInput: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'CS-301' },
          name: { type: 'string', example: 'Cryptography Standards' },
          description: nullable({ type: 'string' }),
          cycle: nullable({ type: 'string' }),
          credits: nullable({ type: 'integer', minimum: 1 }),
          status: { type: 'string', enum: ['draft', 'synced', 'audited', 'pending_update'] },
        },
      },
      ProfessorClassItem: {
        allOf: [ref('Class'), { type: 'object', properties: { students: { type: 'integer', description: 'Enrolled students' } } }],
      },
      StudentClassItem: {
        allOf: [
          ref('Class'),
          {
            type: 'object',
            properties: {
              professor: ref('Person'),
              grade: nullable({ type: 'number', description: 'Average of the graded submissions in this class' }),
            },
          },
        ],
      },
      RosterStudent: {
        type: 'object',
        properties: {
          id: uuid,
          first_name: { type: 'string' },
          last_name: nullable({ type: 'string' }),
          email: { type: 'string' },
          completed: { type: 'integer', description: 'Assignments the student has submitted' },
          total_assignments: { type: 'integer' },
          average_grade: nullable({ type: 'number' }),
          integrity_risk: nullable({ type: 'string', enum: ['low', 'medium', 'high'], description: 'Worst risk over the student\'s submissions' }),
        },
      },
      Assignment: {
        type: 'object',
        properties: {
          id: uuid,
          class_id: uuid,
          title: { type: 'string' },
          description: { type: 'string' },
          monitoring_level: { type: 'integer', enum: [1, 2, 3] },
          allowed_sources: { type: 'array', items: { type: 'string' } },
          due_date: dateTime,
          weight: { type: 'number', minimum: 0, maximum: 100, description: 'Percent of the final grade' },
          behavioral_audit: { type: 'boolean', description: 'When true a submission must carry a forensic dossier' },
          created_by: uuid,
          created_at: dateTime,
          updated_at: dateTime,
        },
      },
      AssignmentInput: {
        type: 'object',
        properties: {
          classId: { ...uuid, description: 'Required on create, not accepted on update' },
          title: { type: 'string' },
          description: { type: 'string' },
          dueDate: { type: 'string', description: 'ISO date-time, or a plain date (YYYY-MM-DD) meaning the end of that day (UTC)', example: '2026-06-05' },
          monitoringLevel: { type: 'integer', enum: [1, 2, 3], default: 1 },
          allowedSources: { type: 'array', items: { type: 'string' }, example: ['wikipedia.org', 'nist.gov'] },
          weight: { type: 'number', minimum: 0, maximum: 100, default: 0 },
          behavioralAudit: { type: 'boolean', default: true },
        },
      },
      ProfessorAssignmentItem: {
        allOf: [
          ref('Assignment'),
          {
            type: 'object',
            properties: {
              class: ref('ClassRef'),
              submissions_count: { type: 'integer' },
              pending_grading: { type: 'integer' },
            },
          },
        ],
      },
      StudentAssignmentItem: {
        allOf: [
          ref('Assignment'),
          {
            type: 'object',
            properties: {
              class: ref('ClassRef'),
              status: ref('TaskStatus'),
              grade: nullable({ type: 'number' }),
              priority: ref('Priority'),
            },
          },
        ],
      },
      TaskStatus: {
        type: 'string',
        enum: ['not_started', 'pending_review', 'graded', 'lapsed'],
        description: 'lapsed = the deadline passed without a submission',
      },
      Priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'High when due within 3 days, medium within 7' },
      DossierInput: {
        type: 'object',
        description: 'Behavioral data collected by the MAGI desktop app. Every field is optional.',
        properties: {
          humanTypingScore: { type: 'number', minimum: 0, maximum: 100, example: 94 },
          volumeScore: { type: 'number', minimum: 0, maximum: 100, example: 98 },
          rhythmScore: { type: 'number', minimum: 0, maximum: 100, example: 92 },
          editingScore: { type: 'number', minimum: 0, maximum: 100, example: 76 },
          aiProbability: { type: 'number', minimum: 0, maximum: 100, example: 12.4 },
          sessionDurationSeconds: { type: 'integer', minimum: 0, example: 13320 },
          activeTypingSeconds: { type: 'integer', minimum: 0, example: 6480 },
          pausingSeconds: { type: 'integer', minimum: 0, example: 4620 },
          editingSeconds: { type: 'integer', minimum: 0, example: 2700 },
          editCycles: { type: 'integer', minimum: 0, example: 47 },
          charactersTyped: { type: 'integer', minimum: 0, example: 14892 },
          pasteEvents: { type: 'integer', minimum: 0, example: 3 },
          charactersPasted: { type: 'integer', minimum: 0, example: 412 },
          correctionKeystrokes: { type: 'integer', minimum: 0, example: 2104 },
          researchLog: {
            type: 'array',
            maxItems: 200,
            items: {
              type: 'object',
              required: ['title'],
              properties: {
                title: { type: 'string', example: 'Wikipedia: Cryptographic hash function' },
                url: { type: 'string' },
                visitedAt: dateTime,
              },
            },
          },
          verdict: { type: 'string', example: 'Low risk: consistent human typing behaviour.' },
        },
      },
      SubmissionInput: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', description: 'The written work' },
          dossier: { allOf: [ref('DossierInput')], description: 'Required when the assignment has behavioral_audit = true' },
        },
      },
      Receipt: {
        type: 'object',
        properties: {
          receipt_id: { type: 'string', example: 'rcpt-4c9b3a728e' },
          content_hash: { type: 'string', example: 'sha256-4c9b3a72...' },
          submitted_at: dateTime,
          status: { type: 'string', enum: ['pending_review', 'graded'] },
          assignment_id: uuid,
        },
      },
      MySubmission: {
        type: 'object',
        properties: {
          receipt_id: { type: 'string' },
          content_hash: { type: 'string' },
          submitted_at: dateTime,
          status: { type: 'string', enum: ['pending_review', 'graded'] },
          grade: nullable({ type: 'number' }),
          feedback: nullable({ type: 'string' }),
          graded_at: nullable(dateTime),
          assignment_id: uuid,
        },
      },
      SubmissionRosterRow: {
        type: 'object',
        properties: {
          student_id: uuid,
          name: { type: 'string' },
          email: { type: 'string' },
          status: ref('TaskStatus'),
          submitted_at: nullable(dateTime),
          integrity_risk: nullable({ type: 'string', enum: ['low', 'medium', 'high'] }),
          grade: nullable({ type: 'number' }),
        },
      },
      SubmissionDetail: {
        type: 'object',
        properties: {
          id: uuid,
          assignment_id: uuid,
          student: {
            type: 'object',
            properties: { id: uuid, first_name: { type: 'string' }, last_name: nullable({ type: 'string' }), email: { type: 'string' }, name: { type: 'string' } },
          },
          submitted_at: dateTime,
          receipt_id: { type: 'string' },
          content_hash: { type: 'string' },
          content: { type: 'string' },
          status: { type: 'string', enum: ['pending_review', 'graded'] },
          grade: nullable({ type: 'number' }),
          feedback: nullable({ type: 'string' }),
          graded_at: nullable(dateTime),
          dossier: {
            type: 'object',
            properties: {
              human_typing_score: nullable({ type: 'number' }),
              session_duration_seconds: nullable({ type: 'integer' }),
              edit_cycles: nullable({ type: 'integer' }),
              sub_scores: {
                type: 'object',
                properties: { volume: nullable({ type: 'number' }), rhythm: nullable({ type: 'number' }), editing: nullable({ type: 'number' }) },
              },
              writing_statistics: {
                type: 'object',
                properties: {
                  characters_typed: nullable({ type: 'integer' }),
                  paste_events: nullable({ type: 'integer' }),
                  characters_pasted: nullable({ type: 'integer' }),
                  correction_keystrokes: nullable({ type: 'integer' }),
                  paste_ratio: nullable({ type: 'number', description: 'pasted / (typed + pasted), 0..1' }),
                  active_typing_seconds: nullable({ type: 'integer' }),
                  session_duration_seconds: nullable({ type: 'integer' }),
                },
              },
              timeline: {
                type: 'object',
                properties: {
                  typing_seconds: nullable({ type: 'integer' }),
                  pausing_seconds: nullable({ type: 'integer' }),
                  editing_seconds: nullable({ type: 'integer' }),
                },
              },
              ai_probability: nullable({ type: 'number' }),
              research_log: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { title: { type: 'string' }, url: nullable({ type: 'string' }), visited_at: nullable(dateTime) },
                },
              },
              verdict: nullable({ type: 'string' }),
              integrity_risk: nullable({ type: 'string', enum: ['low', 'medium', 'high'], description: 'Computed by the server from ai_probability, human_typing_score and the paste ratio' }),
            },
          },
        },
      },
      GradeInput: {
        type: 'object',
        required: ['grade'],
        properties: { grade: { type: 'number', minimum: 0, maximum: 100, example: 88 }, feedback: nullable({ type: 'string', example: 'Solid structure, cite more.' }) },
      },
      GradeResult: {
        type: 'object',
        properties: {
          student_id: uuid,
          status: { type: 'string', example: 'graded' },
          grade: { type: 'number' },
          feedback: nullable({ type: 'string' }),
          graded_at: dateTime,
          assignment_id: uuid,
        },
      },
    },
  },
  paths: {
    '/api/auth/signup': {
      post: {
        tags: ['Auth'],
        summary: 'Create an account',
        description: 'Sends a verification email. The role is stored immediately, the account can log in after the email is verified.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['firstName', 'email', 'password'],
            properties: {
              firstName: { type: 'string', example: 'Sarah' },
              lastName: { type: 'string', example: 'Chen' },
              email: { type: 'string', format: 'email' },
              password: { type: 'string', minLength: 6 },
              role: { type: 'string', enum: ['student', 'professor'], default: 'student' },
            },
          }),
        },
        responses: { '200': ok('Account created, verification email sent', messageOnly), ...errors(400, 409) },
      },
    },
    '/api/auth/email-verification/{token}': {
      post: {
        tags: ['Auth'],
        summary: 'Verify an email address',
        parameters: [{ name: 'token', in: 'path', required: true, description: 'Token from the verification email', schema: { type: 'string' } }],
        responses: { '200': ok('Account verified', messageOnly), ...errors(400) },
      },
    },
    '/api/auth/verify-email': {
      post: {
        tags: ['Auth'],
        summary: 'Resend the verification email',
        description: 'Limited to one email per minute and five per hour.',
        requestBody: { required: true, content: json({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } }) },
        responses: { '200': ok('Email sent', messageOnly), ...errors(400, 404) },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in',
        description: 'Sets the httpOnly `jwt` cookie (valid for 7 days).',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['email', 'password'],
            properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
          }),
        },
        responses: {
          '200': {
            ...ok('Logged in', envelope({ user: { type: 'object', properties: { id: uuid, first_name: { type: 'string' }, last_name: nullable({ type: 'string' }), email: { type: 'string' } } }, message: { type: 'string' } })),
            headers: { 'Set-Cookie': { description: 'jwt=...; HttpOnly', schema: { type: 'string' } } },
          },
          ...errors(400, 403),
        },
      },
    },
    '/api/auth/logout': {
      post: { tags: ['Auth'], summary: 'Log out (clears the cookie)', responses: { '200': ok('Logged out', messageOnly) } },
    },
    '/api/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Send a password reset email',
        requestBody: { required: true, content: json({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } }) },
        responses: { '200': ok('Email sent', messageOnly), ...errors(400, 403, 404) },
      },
    },
    '/api/auth/reset-password/{token}': {
      post: {
        tags: ['Auth'],
        summary: 'Set a new password',
        parameters: [{ name: 'token', in: 'path', required: true, description: 'Token from the reset email', schema: { type: 'string' } }],
        requestBody: { required: true, content: json({ type: 'object', required: ['newPassword'], properties: { newPassword: { type: 'string', minLength: 6 } } }) },
        responses: { '200': ok('Password changed', messageOnly), ...errors(400) },
      },
    },
    '/api/auth/get-user': {
      get: { tags: ['Auth'], summary: 'Current user (from the token)', ...authed, responses: { '200': ok('Token payload', ref('TokenPayload')), ...errors(401) } },
    },

    '/api/classes': {
      get: {
        tags: ['Classes'],
        summary: 'List classes',
        description: 'Professor: own classes with the number of students. Student: enrolled classes with the professor and the average grade.',
        ...authed,
        responses: {
          '200': ok('Classes', envelope({ classes: { type: 'array', items: { anyOf: [ref('ProfessorClassItem'), ref('StudentClassItem')] } } })),
          ...errors(401),
        },
      },
      post: {
        tags: ['Classes'],
        summary: 'Create a class (professor)',
        ...authed,
        requestBody: { required: true, content: json({ allOf: [ref('ClassInput'), { type: 'object', required: ['code', 'name'] }] }) },
        responses: { '201': ok('Created', envelope({ class: ref('Class') })), ...errors(400, 401, 403, 409) },
      },
    },
    '/api/classes/{id}': {
      get: {
        tags: ['Classes'],
        summary: 'Class details',
        description: 'Professor (owner): the class, the roster with progress and statistics. Student (enrolled): the class and its professor.',
        ...authed,
        parameters: [pathParam('id', 'Class id')],
        responses: {
          '200': ok('Class', {
            anyOf: [
              envelope({
                class: ref('Class'),
                students: { type: 'array', items: ref('RosterStudent') },
                stats: { type: 'object', properties: { enrollment: { type: 'integer' }, assignments: { type: 'integer' }, average_grade: nullable({ type: 'number' }) } },
              }),
              envelope({ class: ref('StudentClassItem') }),
            ],
          }),
          ...errors(401, 404),
        },
      },
      patch: {
        tags: ['Classes'],
        summary: 'Update a class (professor, owner)',
        ...authed,
        parameters: [pathParam('id', 'Class id')],
        requestBody: { required: true, content: json(ref('ClassInput')) },
        responses: { '200': ok('Updated', envelope({ class: ref('Class') })), ...errors(400, 401, 403, 404, 409) },
      },
      delete: {
        tags: ['Classes'],
        summary: 'Delete a class with its assignments and submissions (professor, owner)',
        ...authed,
        parameters: [pathParam('id', 'Class id')],
        responses: { '200': ok('Deleted', messageOnly), ...errors(401, 403, 404) },
      },
    },
    '/api/classes/{id}/students': {
      post: {
        tags: ['Classes'],
        summary: 'Enroll a student by email (professor, owner)',
        ...authed,
        parameters: [pathParam('id', 'Class id')],
        requestBody: { required: true, content: json({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } }) },
        responses: {
          '201': ok('Enrolled', envelope({ student: { type: 'object', properties: { id: uuid, first_name: { type: 'string' }, last_name: nullable({ type: 'string' }), email: { type: 'string' }, name: { type: 'string' } } } })),
          ...errors(400, 401, 403, 404, 409),
        },
      },
    },
    '/api/classes/{id}/students/{studentId}': {
      delete: {
        tags: ['Classes'],
        summary: 'Remove a student from a class (professor, owner)',
        ...authed,
        parameters: [pathParam('id', 'Class id'), pathParam('studentId', 'Student id')],
        responses: { '200': ok('Removed', messageOnly), ...errors(401, 403, 404) },
      },
    },

    '/api/assignments': {
      get: {
        tags: ['Assignments'],
        summary: 'List assignments ordered by due date',
        description: 'Professor: assignments of own classes with submission counters. Student: assignments of enrolled classes with own status, grade and priority.',
        ...authed,
        parameters: [{ name: 'classId', in: 'query', required: false, description: 'Only this class', schema: uuid }],
        responses: {
          '200': ok('Assignments', envelope({ assignments: { type: 'array', items: { anyOf: [ref('ProfessorAssignmentItem'), ref('StudentAssignmentItem')] } } })),
          ...errors(400, 401, 404),
        },
      },
      post: {
        tags: ['Assignments'],
        summary: 'Create an assignment (professor)',
        ...authed,
        requestBody: { required: true, content: json({ allOf: [ref('AssignmentInput'), { type: 'object', required: ['classId', 'title', 'description', 'dueDate'] }] }) },
        responses: { '201': ok('Created', envelope({ assignment: ref('Assignment') })), ...errors(400, 401, 403, 404) },
      },
    },
    '/api/assignments/{id}': {
      get: {
        tags: ['Assignments'],
        summary: 'Assignment details',
        description: 'Professor (owner): with statistics. Student (enrolled): with own submission status.',
        ...authed,
        parameters: [pathParam('id', 'Assignment id')],
        responses: {
          '200': ok('Assignment', {
            anyOf: [
              envelope({
                assignment: { allOf: [ref('Assignment'), { type: 'object', properties: { class: ref('ClassRef') } }] },
                stats: {
                  type: 'object',
                  properties: { enrolled: { type: 'integer' }, submitted: { type: 'integer' }, pending_grading: { type: 'integer' }, graded: { type: 'integer' }, lapsed: { type: 'integer' } },
                },
              }),
              envelope({
                assignment: { allOf: [ref('Assignment'), { type: 'object', properties: { class: ref('ClassRef') } }] },
                status: ref('TaskStatus'),
                submission: nullable({ type: 'object', properties: { status: { type: 'string' }, grade: nullable({ type: 'number' }), submitted_at: dateTime } }),
              }),
            ],
          }),
          ...errors(401, 404),
        },
      },
      patch: {
        tags: ['Assignments'],
        summary: 'Update an assignment (professor, owner)',
        ...authed,
        parameters: [pathParam('id', 'Assignment id')],
        requestBody: { required: true, content: json(ref('AssignmentInput')) },
        responses: { '200': ok('Updated', envelope({ assignment: ref('Assignment') })), ...errors(400, 401, 403, 404) },
      },
      delete: {
        tags: ['Assignments'],
        summary: 'Delete an assignment with its submissions (professor, owner)',
        ...authed,
        parameters: [pathParam('id', 'Assignment id')],
        responses: { '200': ok('Deleted', messageOnly), ...errors(401, 403, 404) },
      },
    },

    '/api/assignments/{id}/submissions': {
      post: {
        tags: ['Submissions'],
        summary: 'Submit the work (student, enrolled)',
        description:
          'Called by the MAGI desktop app. One submission per student; rejected after the deadline. ' +
          'The server hashes the content (SHA-256), issues a receipt and computes `integrity_risk` from the dossier.',
        ...authed,
        parameters: [pathParam('id', 'Assignment id')],
        requestBody: { required: true, content: json(ref('SubmissionInput')) },
        responses: { '201': ok('Receipt', envelope({ receipt: ref('Receipt') })), ...errors(400, 401, 403, 404, 409) },
      },
      get: {
        tags: ['Submissions'],
        summary: 'Roster of the assignment (professor, owner)',
        description: 'Every enrolled student with the state of their submission.',
        ...authed,
        parameters: [pathParam('id', 'Assignment id')],
        responses: { '200': ok('Roster', envelope({ submissions: { type: 'array', items: ref('SubmissionRosterRow') } })), ...errors(401, 403, 404) },
      },
    },
    '/api/assignments/{id}/submissions/me': {
      get: {
        tags: ['Submissions'],
        summary: 'Own submission with grade and feedback (student)',
        ...authed,
        parameters: [pathParam('id', 'Assignment id')],
        responses: { '200': ok('Submission', envelope({ submission: ref('MySubmission') })), ...errors(401, 403, 404) },
      },
    },
    '/api/assignments/{id}/submissions/{studentId}': {
      get: {
        tags: ['Submissions'],
        summary: 'Submission with the full forensic dossier (professor, owner)',
        ...authed,
        parameters: [pathParam('id', 'Assignment id'), pathParam('studentId', 'Student id')],
        responses: { '200': ok('Submission', envelope({ submission: ref('SubmissionDetail') })), ...errors(401, 403, 404) },
      },
    },
    '/api/assignments/{id}/submissions/{studentId}/grade': {
      put: {
        tags: ['Submissions'],
        summary: 'Grade a submission (professor, owner)',
        description: 'Can be called again to change the grade.',
        ...authed,
        parameters: [pathParam('id', 'Assignment id'), pathParam('studentId', 'Student id')],
        requestBody: { required: true, content: json(ref('GradeInput')) },
        responses: { '200': ok('Graded', envelope({ submission: ref('GradeResult') })), ...errors(400, 401, 403, 404) },
      },
    },

    '/api/dashboard/professor': {
      get: {
        tags: ['Dashboards'],
        summary: 'Professor dashboard',
        description: '`integrity_flags` counts submissions with medium or high risk. `assignments` are the 20 latest by due date.',
        ...authed,
        responses: {
          '200': ok('Dashboard', envelope({
            metrics: {
              type: 'object',
              properties: { active_classes: { type: 'integer' }, enrolled_students: { type: 'integer' }, unmarked_submissions: { type: 'integer' }, integrity_flags: { type: 'integer' } },
            },
            classes: {
              type: 'array',
              items: { type: 'object', properties: { id: uuid, code: { type: 'string' }, name: { type: 'string' }, status: { type: 'string' }, students: { type: 'integer' } } },
            },
            assignments: {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: uuid, title: { type: 'string' }, due_date: dateTime, class: ref('ClassRef'), submissions_count: { type: 'integer' }, pending_grading: { type: 'integer' } },
              },
            },
          })),
          ...errors(401, 403),
        },
      },
    },
    '/api/dashboard/student': {
      get: {
        tags: ['Dashboards'],
        summary: 'Student dashboard',
        description: '`tasks` lists open work first (earliest deadline first) and graded work last.',
        ...authed,
        responses: {
          '200': ok('Dashboard', envelope({
            metrics: {
              type: 'object',
              properties: {
                enrolled_classes: { type: 'integer' },
                average_grade: nullable({ type: 'number' }),
                submissions_made: { type: 'object', properties: { submitted: { type: 'integer' }, total: { type: 'integer' } } },
                pending_deadlines: { type: 'integer', description: 'Assignments not started and not yet due' },
              },
            },
            courses: {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: uuid, code: { type: 'string' }, name: { type: 'string' }, credits: nullable({ type: 'integer' }), professor: ref('Person'), grade: nullable({ type: 'number' }) },
              },
            },
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: uuid, title: { type: 'string' }, class: nullable(ref('ClassRef')), due_date: dateTime, status: ref('TaskStatus'), grade: nullable({ type: 'number' }), priority: ref('Priority') },
              },
            },
          })),
          ...errors(401, 403),
        },
      },
    },
  },
};
