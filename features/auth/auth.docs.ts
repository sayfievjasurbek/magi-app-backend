// Auth domain: the endpoints of auth.route.ts and the schemas they use (helpers in docs/common.ts).
import { authed, dateTime, envelope, errors, id, json, messageOnly, nullable, ok, ref } from '../../docs/common.js';

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
      description:
        'Login email, password and a random 5-digit student code are all generated from the first name by default - no verification email, the account ' +
        "is active immediately. A professor can instead supply email/password/idNumber themselves (e.g. an email the student already uses, or an ID card " +
        "number already on file) and only the fields left out get generated. The password, student code and ID number are returned once, for the " +
        "professor to hand to the student; a recoverable copy of the password is also kept for the professor to look up later (see GET .../credentials). " +
        "idNumber is what the desktop app's pre-exam check compares against what the student types - set it to the number on their actual ID card if you " +
        "want that check to mean something. The optional photo becomes the student's reference photo (same as POST /api/auth/me/photo) - rejected with " +
        "400 if no face is detected in it, same as the student setting it themselves. They can no longer set their own after this.",
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
            age: { type: 'integer', minimum: 1, maximum: 100, example: 17 },
            photo: { type: 'string', description: 'data:image/jpeg;base64,... or data:image/png;base64,...', example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...' },
            email: { type: 'string', description: 'Generated from firstName when left out', example: 'sarah@gmail.com' },
            password: { type: 'string', minLength: 6, description: 'Generated when left out', example: 'sarahS3cure' },
            idNumber: { type: 'string', description: 'The number on the student\'s own ID card; a random code is generated when left out', example: 'AB1234567' },
          },
        }),
      },
      responses: {
        '201': ok(
          'Student created',
          envelope({
            student: { type: 'object', properties: { id, first_name: { type: 'string', example: 'Sarah' }, last_name: nullable({ type: 'string', example: 'Chen' }), email: { type: 'string', example: 'sarah@magi.com' } } },
            student_code: { type: 'string', example: '04213' },
            id_number: { type: 'string', example: 'AB1234567' },
            password: { type: 'string', example: 'xK9mPq2a' },
            profile_photo_url: nullable({ type: 'string', example: 'https://xxxxx.supabase.co/storage/v1/object/public/proctoring/profiles/42/a1b2c3.jpg' }),
          })
        ),
        ...errors(400, 403, 409),
      },
    },
  },
  '/api/auth/students': {
    get: {
      tags: ['Auth'],
      summary: "List every student this professor can manage",
      description:
        'Every student this professor created directly (shows up here even before being linked to a module) plus every student in a module ' +
        'they manage - the admin panel used to build this same list client-side with one roster call per module, which got slow with more than a few.',
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
                  id_number: nullable({ type: 'string', example: 'AB1234567' }),
                  phone: nullable({ type: 'string', example: '+998901234567' }),
                  parent_phone: nullable({ type: 'string', example: '+998901234567' }),
                  parent_relation: nullable({ type: 'string', example: 'mother' }),
                  age: nullable({ type: 'integer', example: 17 }),
                  profile_photo_url: nullable({ type: 'string', example: 'https://xxxxx.supabase.co/storage/v1/object/public/proctoring/profiles/42/a1b2c3.jpg' }),
                  has_group: { type: 'boolean', example: true, description: 'Whether this student is in any module at all, not just ones you manage' },
                },
              },
            },
          })
        ),
        ...errors(403),
      },
    },
  },
  '/api/auth/students/{id}': {
    get: {
      tags: ['Auth'],
      summary: "One student's full profile (professor only)",
      description: 'The same fields as GET /api/auth/students, for a single student - the Students detail page in the admin panel.',
      ...authed,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', example: 42 } }],
      responses: {
        '200': ok(
          'Student',
          envelope({
            student: {
              type: 'object',
              properties: {
                id,
                first_name: { type: 'string', example: 'Sarah' },
                last_name: nullable({ type: 'string', example: 'Chen' }),
                email: { type: 'string', example: 'sarah@magi.com' },
                created_at: dateTime,
                student_code: nullable({ type: 'string', example: '04213' }),
                id_number: nullable({ type: 'string', example: 'AB1234567' }),
                phone: nullable({ type: 'string', example: '+998901234567' }),
                parent_phone: nullable({ type: 'string', example: '+998901234567' }),
                parent_relation: nullable({ type: 'string', example: 'mother' }),
                age: nullable({ type: 'integer', example: 17 }),
                profile_photo_url: nullable({ type: 'string', example: 'https://xxxxx.supabase.co/storage/v1/object/public/proctoring/profiles/42/a1b2c3.jpg' }),
              },
            },
          })
        ),
        ...errors(400, 403, 404),
      },
    },
    patch: {
      tags: ['Auth'],
      summary: "Correct a student's profile data (professor only)",
      description: 'Every field is optional and only touched when present - the same fields createStudent accepts, minus photo. Setting password also refreshes the recovery_secret shown on the Credentials panel, unlike the student-initiated changePassword/resetPassword which clear it instead.',
      ...authed,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', example: 42 } }],
      requestBody: {
        content: json({
          type: 'object',
          properties: {
            firstName: { type: 'string', example: 'Sarah' },
            lastName: { type: 'string', example: 'Chen' },
            email: { type: 'string', example: 'sarah@magi.com' },
            phone: { type: 'string', example: '+998901234567' },
            parentPhone: { type: 'string', example: '+998901234567' },
            parentRelation: { type: 'string', example: 'mother' },
            age: { type: 'integer', minimum: 1, maximum: 100, example: 17 },
            idNumber: { type: 'string', example: 'AB1234567' },
            studentCode: { type: 'string', example: '74571' },
            password: { type: 'string', minLength: 6, maxLength: 100, example: 'qkpceFnL' },
          },
        }),
      },
      responses: {
        '200': ok(
          'Student',
          envelope({
            student: {
              type: 'object',
              properties: {
                id,
                first_name: { type: 'string', example: 'Sarah' },
                last_name: nullable({ type: 'string', example: 'Chen' }),
                email: { type: 'string', example: 'sarah@magi.com' },
                created_at: dateTime,
                student_code: nullable({ type: 'string', example: '04213' }),
                id_number: nullable({ type: 'string', example: 'AB1234567' }),
                phone: nullable({ type: 'string', example: '+998901234567' }),
                parent_phone: nullable({ type: 'string', example: '+998901234567' }),
                parent_relation: nullable({ type: 'string', example: 'mother' }),
                age: nullable({ type: 'integer', example: 17 }),
                profile_photo_url: nullable({ type: 'string', example: 'https://xxxxx.supabase.co/storage/v1/object/public/proctoring/profiles/42/a1b2c3.jpg' }),
              },
            },
          })
        ),
        ...errors(400, 403, 404, 409),
      },
    },
    delete: {
      tags: ['Auth'],
      summary: 'Delete a student account (professor only)',
      description: 'Soft delete - the account can no longer log in, but its attempts and other records stay in place.',
      ...authed,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', example: 42 } }],
      requestBody: { content: json({ type: 'object', properties: { reason: { type: 'string', maxLength: 1000, example: 'Graduated' } } }) },
      responses: {
        '200': ok('Student deleted', messageOnly),
        ...errors(400, 403, 404),
      },
    },
  },
  '/api/auth/students/{id}/photo': {
    delete: {
      tags: ['Auth'],
      summary: "Clear a student's reference photo (professor only)",
      description:
        "For a photo that's unusable despite passing the upload checks (e.g. too dark to actually show a face clearly). " +
        'Once cleared, the student can set a new one themselves - POST /api/auth/me/photo only refuses while one is already set.',
      ...authed,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', example: 42 } }],
      responses: { '200': ok('Photo cleared', messageOnly), ...errors(400, 403, 404) },
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
            id_number: nullable({ type: 'string', example: 'AB1234567' }),
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
            position: { type: 'string', description: 'Job title shown in the admin panel - display only, not an auth role.', example: 'Teacher' },
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
            position: nullable({ type: 'string', example: 'Teacher' }),
          })
        ),
        ...errors(400, 403, 409),
      },
    },
  },
  '/api/auth/professors': {
    get: {
      tags: ['Auth'],
      summary: "List every professor this professor can manage",
      description:
        'Every professor this professor created directly plus every co-professor on a module they manage (never themself) - the admin panel used ' +
        'to build this same list client-side with one roster call per module, which got slow with more than a few.',
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
                  position: nullable({ type: 'string', example: 'Teacher' }),
                },
              },
            },
          })
        ),
        ...errors(403),
      },
    },
  },
  '/api/auth/professors/{id}': {
    get: {
      tags: ['Auth'],
      summary: "One professor's full profile (professor only)",
      description: 'The same fields as GET /api/auth/professors, for a single professor - the Professors detail page in the admin panel.',
      ...authed,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', example: 42 } }],
      responses: {
        '200': ok(
          'Professor',
          envelope({
            professor: {
              type: 'object',
              properties: {
                id,
                first_name: { type: 'string', example: 'James' },
                last_name: nullable({ type: 'string', example: 'Okafor' }),
                email: { type: 'string', example: 'james@magi.com' },
                created_at: dateTime,
                professor_code: nullable({ type: 'string', example: '04213' }),
                phone: nullable({ type: 'string', example: '+998901234567' }),
                position: nullable({ type: 'string', example: 'Teacher' }),
              },
            },
          })
        ),
        ...errors(400, 403, 404),
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
      description:
        'For students, includes student_code, id_number, phone, parent_phone, parent_relation, profile_photo_url and profile_photo_locked on top of the base ' +
        'user fields - id_number is what the desktop app\'s pre-exam identity check compares against what the student types, and profile_photo_locked is ' +
        'whether the current photo still meets setMyProfilePhoto\'s own checks and so can no longer be retaken. For professors, includes professor_code, ' +
        'phone and position instead.',
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
                role: { type: 'string', enum: ['student', 'professor', 'examiner'], example: 'student' },
                student_code: nullable({ type: 'string', example: '04213' }),
                id_number: nullable({ type: 'string', example: 'AB1234567' }),
                phone: nullable({ type: 'string', example: '+998901234567' }),
                parent_phone: nullable({ type: 'string', example: '+998901234567' }),
                parent_relation: nullable({ type: 'string', example: 'mother' }),
                profile_photo_url: nullable({ type: 'string', example: 'https://xxxxx.supabase.co/storage/v1/object/public/proctoring/profiles/42/a1b2c3.jpg' }),
                profile_photo_locked: { type: 'boolean', example: true },
                professor_code: nullable({ type: 'string', example: '04213' }),
                position: nullable({ type: 'string', example: 'Teacher' }),
              },
            },
          })
        ),
        ...errors(401),
      },
    },
    patch: {
      tags: ['Auth'],
      summary: 'Edit your own name/phone',
      description:
        'Email and role are not editable here - changing email would need its own re-verification flow, and role is never self-service. ' +
        'phone only applies to students and professors; ignored for other roles. Returns the updated profile, same shape as GET.',
      ...authed,
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          properties: {
            firstName: { type: 'string', example: 'Sarah' },
            lastName: nullable({ type: 'string', example: 'Chen' }),
            phone: nullable({ type: 'string', example: '+998901234567' }),
          },
        }),
      },
      responses: { '200': ok('Updated profile, same shape as GET /me/profile', envelope({ profile: { type: 'object' } })), ...errors(400, 401) },
    },
  },
  '/api/auth/me/password': {
    get: {
      tags: ['Auth'],
      summary: 'Your own current password, if recoverable',
      description:
        "So a password-change form can pre-fill it instead of asking the user to recall it. Only set for accounts created directly by a " +
        "professor (same recovery_secret they'd look up for you) - null once you've changed your password yourself, or if you signed up directly.",
      ...authed,
      responses: {
        '200': ok('Current password, if any', envelope({ password: nullable({ type: 'string', example: 'xK9mPq2a' }) })),
        ...errors(401),
      },
    },
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
      description:
        "Gives staff something to compare an exam's identity_check photo against. Stored in the same Supabase Storage bucket as other proctoring media. " +
        'One-time while the existing photo is still usable: rejected with 409 in that case. If the existing photo would itself now fail these same ' +
        "checks (e.g. it predates them), it can be replaced. Rejected with 400 if no face is detected in it, or if it is over 3MB.",
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
        ...errors(400, 403, 409),
      },
    },
  },
  '/api/auth/me/identity-check': {
    post: {
      tags: ['Auth'],
      summary: 'Check a photo against your own reference photo (student only)',
      description:
        'The desktop app calls this right before an exam starts, as an entry gate: if a reference photo is on file, the submitted photo must match it ' +
        '(`matched: true`) or the app should refuse to start the exam. `hasReference: false` means the student never set one up - nothing to gate on, ' +
        'so `matched` is reported true and the app should proceed.',
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
        '200': ok(
          'Check result',
          envelope({
            hasReference: { type: 'boolean', example: true },
            matched: { type: 'boolean', example: true },
            outcome: { type: 'string', enum: ['matched', 'mismatched', 'no_face_in_photo', 'no_face_in_reference', 'no_reference'], example: 'matched' },
          })
        ),
        ...errors(400, 403),
      },
    },
  },
};
