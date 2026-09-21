import { ok, ref, sharedSchemas } from './common.js';
import * as authPaths from './paths/auth.js';
import * as modulePaths from './paths/module.js';
import * as examPaths from './paths/exam.js';
import * as questionPaths from './paths/question.js';
import * as attemptPaths from './paths/attempt.js';
import * as monitoringPaths from './paths/monitoring.js';
import * as cheatingPaths from './paths/cheating.js';
import { schemas as authSchemas } from './schemas/auth.js';
import { schemas as moduleSchemas } from './schemas/module.js';
import { schemas as examSchemas } from './schemas/exam.js';
import { schemas as questionSchemas } from './schemas/question.js';
import { schemas as attemptSchemas } from './schemas/attempt.js';
import { schemas as monitoringSchemas } from './schemas/monitoring.js';
import { schemas as cheatingSchemas } from './schemas/cheating.js';

// every domain owns its files under paths/ and schemas/, so adding endpoints never touches this one
const domains = [authPaths, modulePaths, examPaths, questionPaths, attemptPaths, monitoringPaths, cheatingPaths];

// two domains claiming the same name would otherwise silently keep the last one: a schema shared by
// several domains belongs in common.ts, an endpoint belongs to exactly one domain
export const mergeSchemas = (groups: Record<string, object>[]) => {
  const merged: Record<string, object> = {};
  for (const group of groups) {
    for (const [name, schema] of Object.entries(group)) {
      if (name in merged) throw new Error(`Duplicate OpenAPI schema: ${name}`);
      merged[name] = schema;
    };
  };
  return merged;
};

export const mergePaths = (groups: Record<string, Record<string, object>>[]) => {
  const merged: Record<string, Record<string, object>> = {};
  for (const group of groups) {
    for (const [path, operations] of Object.entries(group)) {
      const documented = merged[path] ?? (merged[path] = {});
      for (const [method, operation] of Object.entries(operations)) {
        if (method in documented) throw new Error(`Duplicate OpenAPI operation: ${method.toUpperCase()} ${path}`);
        documented[method] = operation;
      };
    };
  };
  return merged;
};

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'MAGI API',
    version: '1.0.0',
    description:
      'Backend of MAGI University: authentication, modules, exams, questions, monitored exam attempts and cheating findings.\n\n' +
      '**Authentication:** call `POST /api/auth/login` from this page. The server sets an httpOnly `jwt` cookie and the browser sends it on every following request. ' +
      'Endpoints marked *professor*, *examiner* or *student* return 403 for the other roles.\n\n' +
      '**Conventions:** ids are integers, request bodies are camelCase, responses are snake_case. Every response has a `success` flag; errors are `{ success: false, message }`. ' +
      'Resources that belong to someone else answer 404 instead of 403 so their existence is not leaked.',
  },
  servers: [{ url: '/' }],
  tags: domains.flatMap((domain) => domain.tags),
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
    schemas: mergeSchemas([
      sharedSchemas,
      authSchemas,
      moduleSchemas,
      examSchemas,
      questionSchemas,
      attemptSchemas,
      monitoringSchemas,
      cheatingSchemas,
    ]),
  },
  paths: mergePaths(domains.map((domain) => domain.paths)),
};
