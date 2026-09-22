// Auth domain: the endpoints of auth.route.ts and the schemas they use (helpers in docs/common.ts).
import { authed, envelope, errors, id, json, messageOnly, nullable, ok, ref } from '../../docs/common.js';

export const tags = [{ name: 'Auth', description: 'Sign up, verification, login, password reset' }];

export const schemas = {
  TokenPayload: {
    type: 'object',
    properties: {
      id,
      first_name: { type: 'string' },
      last_name: nullable({ type: 'string' }),
      email: { type: 'string', format: 'email' },
      role: { type: 'string', enum: ['student', 'professor', 'examiner'] },
      iat: { type: 'integer' },
      exp: { type: 'integer' },
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
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 },
            role: { type: 'string', enum: ['student', 'professor', 'examiner'], default: 'student' },
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
      description: 'Rate limited by the email_rules row of this email type (by default 3 per day, one per hour).',
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
          ...ok('Logged in', envelope({ user: { type: 'object', properties: { id, first_name: { type: 'string' }, last_name: nullable({ type: 'string' }), email: { type: 'string' } } }, message: { type: 'string' } })),
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
};
