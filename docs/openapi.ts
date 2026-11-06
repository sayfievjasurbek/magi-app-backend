import { ok, ref, sharedSchemas } from './common.js';
import * as authDocs from '../features/auth/auth.docs.js';
import * as moduleDocs from '../features/modules/module.docs.js';
import * as examDocs from '../features/exams/exam.docs.js';
import * as questionDocs from '../features/questions/question.docs.js';
import * as attemptDocs from '../features/attempts/attempt.docs.js';
import * as monitoringDocs from '../features/monitoring/monitoring.docs.js';
import * as cheatingDocs from '../features/cheatings/cheating.docs.js';
import * as notificationDocs from '../features/notifications/notification.docs.js';
import * as aiDocs from '../features/ai/ai.docs.js';
import * as attendanceDocs from '../features/attendance/attendance.docs.js';

// every domain owns its <domain>.docs.ts, so adding endpoints never touches this one
const domains = [authDocs, moduleDocs, examDocs, questionDocs, attemptDocs, monitoringDocs, cheatingDocs, notificationDocs, aiDocs, attendanceDocs];

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
      ServiceUnavailable: ok('The feature is not configured on the server', ref('Error')),
    },
    schemas: mergeSchemas([sharedSchemas, ...domains.map((domain) => domain.schemas)]),
  },
  paths: mergePaths(domains.map((domain) => domain.paths)),
};
