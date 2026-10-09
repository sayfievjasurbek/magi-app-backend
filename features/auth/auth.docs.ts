// Auth domain: the endpoints of auth.route.ts and the schemas they use (helpers in docs/common.ts).
import { authed, envelope, errors, id, json, messageOnly, nullable, ok, ref } from '../../docs/common.js';

export const tags = [{ name: 'Auth', description: 'Sign up, verification, login, password reset' }];

export const schemas = {
  TokenPayload: {
    type: 'object',
    properties: {
      id,
      first_name: { type: 'string', example: 'Sarah' },
      last_name: nullable({ type: 'string', example: 'Chen' }),
      email: { type: 'string', format: 'email', example: 'sarah.chen@magi.edu' },
      role: { type: 'string', enum: ['student', 'professor', 'examiner'], example: 'professor' },
      iat: { type: 'integer', example: 1773306000 },
      exp: { type: 'integer', example: 1773910800 },
    },
  },
};

export const paths = {
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
            email: { type: 'string', format: 'email', example: 'sarah.chen@magi.edu' },
            password: { type: 'string', minLength: 6, example: 'Str0ngPass!23' },
            role: { type: 'string', enum: ['student', 'professor', 'examiner'], default: 'student', example: 'professor' },
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
      parameters: [{ name: 'token', in: 'path', required: true, description: 'Token from the verification email', schema: { type: 'string', example: 'd41f8c0a7b6e2593c1d84f0a9b3e7c25d6081af4' } }],
      responses: { '200': ok('Account verified', messageOnly), ...errors(400) },
    },
  },
  '/api/auth/verify-email': {
    post: {
      tags: ['Auth'],
      summary: 'Resend the verification email',
      description: 'Rate limited by the email_rules row of this email type (by default 3 per day, one per hour).',
      requestBody: { required: true, content: json({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email', example: 'sarah.chen@magi.edu' } } }) },
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
          properties: { email: { type: 'string', format: 'email', example: 'sarah.chen@magi.edu' }, password: { type: 'string', example: 'Str0ngPass!23' } },
        }),
      },
      responses: {
        '200': {
          ...ok('Logged in', envelope({ user: { type: 'object', properties: { id, first_name: { type: 'string', example: 'Sarah' }, last_name: nullable({ type: 'string', example: 'Chen' }), email: { type: 'string', example: 'sarah.chen@magi.edu' } } }, message: { type: 'string', example: 'User logged in successfully' } })),
          headers: { 'Set-Cookie': { description: 'jwt=...; HttpOnly', schema: { type: 'string', example: 'jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTJ9.0iQ4m2H1; Max-Age=604800; Path=/; HttpOnly; SameSite=None; Secure' } } },
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
      requestBody: { required: true, content: json({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email', example: 'sarah.chen@magi.edu' } } }) },
      responses: { '200': ok('Email sent', messageOnly), ...errors(400, 403, 404) },
    },
  },
  '/api/auth/reset-password/{token}': {
    post: {
      tags: ['Auth'],
      summary: 'Set a new password',
      parameters: [{ name: 'token', in: 'path', required: true, description: 'Token from the reset email', schema: { type: 'string', example: 'd41f8c0a7b6e2593c1d84f0a9b3e7c25d6081af4' } }],
      requestBody: { required: true, content: json({ type: 'object', required: ['newPassword'], properties: { newPassword: { type: 'string', minLength: 6, example: 'N3wStr0ngPass!' } } }) },
      responses: { '200': ok('Password changed', messageOnly), ...errors(400) },
    },
  },
  '/api/auth/create-student': {
    post: {
      tags: ['Auth'],
      summary: 'Create a student account directly (professor only)',
      description: 'Login email and a random 5-digit student code are both generated from the first name - no verification email, the account is active immediately. The password and student code are returned once, for the professor to hand to the student; a recoverable copy of the password is also kept for the professor to look up later (see GET .../credentials).',
      ...authed,
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['firstName'],
          properties: {
            firstName: { type: 'string', example: 'Sarah' },
            lastName: { type: 'string', example: 'Chen' },
            phone: { type: 'string', example: '+998901234567' },
            parentPhone: { type: 'string', example: '+998901234567' },
            parentRelation: { type: 'string', example: 'mother' },
          },
        }),
      },
      responses: {
        '201': ok(
          'Student created',
          envelope({
            student: { type: 'object', properties: { id, first_name: { type: 'string', example: 'Sarah' }, last_name: nullable({ type: 'string', example: 'Chen' }), email: { type: 'string', example: 'sarah@magi.com' } } },
            student_code: { type: 'string', example: '04213' },
            password: { type: 'string', example: 'xK9mPq2a' },
          })
        ),
        ...errors(400, 403, 409),
      },
    },
  },
  '/api/auth/students': {
    get: {
      tags: ['Auth'],
      summary: "List the students this professor created directly",
      description: 'Shows up here even before being linked to a module - the module roster endpoints only list enrolled students.',
      ...authed,
      responses: {
        '200': ok(
          'Students',
          envelope({
            students: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id,
                  first_name: { type: 'string', example: 'Sarah' },
                  last_name: nullable({ type: 'string', example: 'Chen' }),
                  email: { type: 'string', example: 'sarah@magi.com' },
                  student_code: nullable({ type: 'string', example: '04213' }),
                  phone: nullable({ type: 'string', example: '+998901234567' }),
                  parent_phone: nullable({ type: 'string', example: '+998901234567' }),
                  parent_relation: nullable({ type: 'string', example: 'mother' }),
                },
              },
            },
          })
        ),
        ...errors(403),
      },
    },
  },
  '/api/auth/students/{id}/credentials': {
    get: {
      tags: ['Auth'],
      summary: "Look up a student's login and password (professor only)",
      description: 'Only works for accounts createStudent made - self-signup accounts have no recoverable password and this returns 404 for them.',
      ...authed,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', example: 42 } }],
      responses: {
        '200': ok(
          'Credentials',
          envelope({
            email: { type: 'string', example: 'sarah@magi.com' },
            student_code: nullable({ type: 'string', example: '04213' }),
            password: { type: 'string', example: 'xK9mPq2a' },
          })
        ),
        ...errors(400, 403, 404),
      },
    },
  },
  '/api/auth/create-professor': {
    post: {
      tags: ['Auth'],
      summary: 'Create a professor account directly (professor only)',
      description: 'Mirrors create-student: login and a random 5-digit professor code are generated from the first name, the account is active immediately, and a recoverable copy of the password is kept (see GET .../credentials).',
      ...authed,
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['firstName'],
          properties: {
            firstName: { type: 'string', example: 'James' },
            lastName: { type: 'string', example: 'Okafor' },
            phone: { type: 'string', example: '+998901234567' },
          },
        }),
      },
      responses: {
        '201': ok(
          'Professor created',
          envelope({
            professor: { type: 'object', properties: { id, first_name: { type: 'string', example: 'James' }, last_name: nullable({ type: 'string', example: 'Okafor' }), email: { type: 'string', example: 'james@magi.com' } } },
            professor_code: { type: 'string', example: '04213' },
            password: { type: 'string', example: 'xK9mPq2a' },
          })
        ),
        ...errors(400, 403, 409),
      },
    },
  },
  '/api/auth/professors': {
    get: {
      tags: ['Auth'],
      summary: "List the professors this professor created directly",
      ...authed,
      responses: {
        '200': ok(
          'Professors',
          envelope({
            professors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id,
                  first_name: { type: 'string', example: 'James' },
                  last_name: nullable({ type: 'string', example: 'Okafor' }),
                  email: { type: 'string', example: 'james@magi.com' },
                  professor_code: nullable({ type: 'string', example: '04213' }),
                  phone: nullable({ type: 'string', example: '+998901234567' }),
                },
              },
            },
          })
        ),
        ...errors(403),
      },
    },
  },
  '/api/auth/professors/{id}/credentials': {
    get: {
      tags: ['Auth'],
      summary: "Look up a professor's login and password (professor only)",
      description: 'Only works for accounts createProfessor made - self-signup accounts have no recoverable password and this returns 404 for them.',
      ...authed,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', example: 42 } }],
      responses: {
        '200': ok(
          'Credentials',
          envelope({
            email: { type: 'string', example: 'james@magi.com' },
            professor_code: nullable({ type: 'string', example: '04213' }),
            password: { type: 'string', example: 'xK9mPq2a' },
          })
        ),
        ...errors(400, 403, 404),
      },
    },
  },
  '/api/auth/get-user': {
    get: { tags: ['Auth'], summary: 'Current user (from the token)', ...authed, responses: { '200': ok('Token payload', ref('TokenPayload')), ...errors(401) } },
  },
  '/api/auth/me/profile': {
    get: {
      tags: ['Auth'],
      summary: "The logged-in user's full profile",
      description: 'For students, includes student_code, phone, parent_phone, parent_relation and profile_photo_url on top of the base user fields.',
      ...authed,
      responses: {
        '200': ok(
          'Profile',
          envelope({
            profile: {
              type: 'object',
              properties: {
                id,
                first_name: { type: 'string', example: 'Sarah' },
                last_name: nullable({ type: 'string', example: 'Chen' }),
                email: { type: 'string', example: 'sarah@magi.com' },
                student_code: nullable({ type: 'string', example: '04213' }),
                phone: nullable({ type: 'string', example: '+998901234567' }),
                parent_phone: nullable({ type: 'string', example: '+998901234567' }),
                parent_relation: nullable({ type: 'string', example: 'mother' }),
                profile_photo_url: nullable({ type: 'string', example: 'https://xxxxx.supabase.co/storage/v1/object/public/proctoring/profiles/42/a1b2c3.jpg' }),
              },
            },
          })
        ),
        ...errors(401),
      },
    },
  },
  '/api/auth/me/password': {
    patch: {
      tags: ['Auth'],
      summary: 'Change your own password',
      description: 'Clears any recovery_secret a professor had on file for this account, since it would otherwise be stale.',
      ...authed,
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string', example: 'xK9mPq2a' },
            newPassword: { type: 'string', minLength: 6, example: 'N3wStr0ngPass!' },
          },
        }),
      },
      responses: { '200': ok('Password changed', messageOnly), ...errors(400, 401, 404) },
    },
  },
  '/api/auth/me/photo': {
    post: {
      tags: ['Auth'],
      summary: 'Set your own reference photo (student only)',
      description: "Gives staff something to compare an exam's identity_check photo against. Stored in the same Supabase Storage bucket as other proctoring media.",
      ...authed,
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['image'],
          properties: { image: { type: 'string', description: 'data:image/jpeg;base64,... or data:image/png;base64,...', example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...' } },
        }),
      },
      responses: {
        '200': ok('Photo set', envelope({ profile_photo_url: { type: 'string', example: 'https://xxxxx.supabase.co/storage/v1/object/public/proctoring/profiles/42/a1b2c3.jpg' } })),
        ...errors(400, 403),
      },
    },
  },
};
