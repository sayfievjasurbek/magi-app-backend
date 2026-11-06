import { describe, it, expect, vi } from 'vitest';

// the routers pull in the controllers, which reach for the database and mailtrap at import time
vi.mock('../../lib/db.js', () => ({ database: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('../../email/email.js', () => ({
  sendVerificationEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendResetSuccessEmail: vi.fn(),
}));

import { mergePaths, mergeSchemas, openapi } from '../../docs/openapi.js';
import authRoutes from '../../features/auth/auth.route.js';
import moduleRoutes from '../../features/modules/module.route.js';
import examRoutes from '../../features/exams/exam.route.js';
import questionRoutes from '../../features/questions/question.route.js';
import attemptRoutes from '../../features/attempts/attempt.route.js';
import monitoringRoutes from '../../features/monitoring/monitoring.route.js';
import cheatingRoutes from '../../features/cheatings/cheating.route.js';
import notificationRoutes from '../../features/notifications/notification.route.js';
import aiRoutes from '../../features/ai/ai.route.js';
import attendanceRoutes from '../../features/attendance/attendance.route.js';

// the same mounting as server.ts
const mounted: [string, any][] = [
  ['/api/auth', authRoutes],
  ['/api/modules', moduleRoutes],
  ['/api/exams', examRoutes],
  ['/api/questions', questionRoutes],
  ['/api/assignments', attemptRoutes],
  ['/api/monitoring', monitoringRoutes],
  ['/api/cheatings', cheatingRoutes],
  ['/api/notifications', notificationRoutes],
  ['/api/ai', aiRoutes],
  ['/api/attendance', attendanceRoutes],
];

// express writes /:examId, OpenAPI writes /{examId}
const documentedPath = (prefix: string, path: string) =>
  `${prefix}${path === '/' ? '' : path}`.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

const wired = mounted.flatMap(([prefix, router]) =>
  router.stack
    .filter((layer: any) => layer.route)
    .flatMap((layer: any) =>
      Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${documentedPath(prefix, layer.route.path)}`)
    )
);

const documented = Object.entries(openapi.paths).flatMap(([path, operations]) =>
  Object.keys(operations as Record<string, object>).map((method) => `${method.toUpperCase()} ${path}`)
);

const refs = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    key === '$ref' && typeof child === 'string' ? [child] : refs(child)
  );
};

describe('the OpenAPI document', () => {
  it('refuses two domains claiming the same schema name', () => {
    expect(() => mergeSchemas([{ Exam: {} }, { Exam: {} }])).toThrow('Duplicate OpenAPI schema: Exam');
    expect(mergeSchemas([{ Exam: {} }, { StudentExam: {} }])).toEqual({ Exam: {}, StudentExam: {} });
  });

  it('refuses two domains claiming the same path and method', () => {
    expect(() => mergePaths([{ '/api/exams': { get: {} } }, { '/api/exams': { get: {} } }])).toThrow(
      'Duplicate OpenAPI operation: GET /api/exams'
    );
    // the same path with another method is how one resource is documented
    expect(mergePaths([{ '/api/exams': { get: {} } }, { '/api/exams': { post: {} } }])).toEqual({
      '/api/exams': { get: {}, post: {} },
    });
  });

  it('has no duplicate schema name and no duplicate operation of its own', () => {
    const names = Object.keys(openapi.components.schemas);
    expect(names).toEqual([...new Set(names)]);
    expect(documented).toEqual([...new Set(documented)]);
  });

  it('resolves every $ref it uses', () => {
    const components = openapi.components as Record<string, Record<string, object>>;

    for (const reference of refs(openapi)) {
      const [, , section, name] = reference.split('/');
      expect([reference, components[section]?.[name] !== undefined]).toEqual([reference, true]);
    };
  });

  it('documents every endpoint the routers wire, and wires every endpoint it documents', () => {
    expect(wired.filter((endpoint) => !documented.includes(endpoint))).toEqual([]);
    expect(documented.filter((endpoint) => !wired.includes(endpoint))).toEqual([]);
  });
});
