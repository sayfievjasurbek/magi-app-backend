import { describe, it, expect, vi } from 'vitest';
import { type Request, type Response } from 'express';

// the router only wires things up: the controller and the token check are stubbed out
vi.mock('../../../middleware/auth.middleware.js', () => ({ protectRoute: vi.fn((req, res, next) => next()) }));
vi.mock('../../../features/attempts/attempt.controller.js', () => ({
  startAttempt: vi.fn(),
  getMyAttempts: vi.fn(),
  getAttemptsSummary: vi.fn(),
  getExamAttempts: vi.fn(),
  getAttempt: vi.fn(),
  syncAnswers: vi.fn(),
  uploadAnswerFile: vi.fn(),
  submitAttempt: vi.fn(),
  gradeAttempt: vi.fn(),
  aiReviewAttempt: vi.fn(),
  setCheatingDisclosure: vi.fn(),
}));

import router from '../../../features/attempts/attempt.route.js';
import { protectRoute } from '../../../middleware/auth.middleware.js';
import * as controller from '../../../features/attempts/attempt.controller.js';

const layers = (router as any).stack;
const routes = layers
  .filter((layer: any) => layer.route)
  .map((layer: any) => ({
    path: layer.route.path,
    method: Object.keys(layer.route.methods)[0],
    handlers: layer.route.stack.map((entry: any) => entry.handle),
  }));

const route = (method: string, path: string) => {
  const found = routes.find((candidate: any) => candidate.method === method && candidate.path === path);
  if (!found) throw new Error(`no ${method} ${path}`);
  return found;
};

// runs everything the route has in front of its controller
const guard = (method: string, path: string, role: string) => {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res) } as unknown as Response & { status: any; json: any };
  const req = { user: { id: 1, role } } as Request;

  for (const handler of route(method, path).handlers.slice(0, -1)) {
    let passed = false;
    handler(req, res, () => { passed = true; });
    if (!passed) return { allowed: false, status: res.status.mock.calls[0]?.[0] };
  }
  return { allowed: true, status: undefined };
};

describe('attempt routes', () => {
  it('checks the token before any route', () => {
    expect(layers[0].handle).toBe(protectRoute);
    expect(layers[0].route).toBeUndefined();
  });

  it('wires every endpoint to its controller', () => {
    expect(route('post', '/').handlers.at(-1)).toBe(controller.startAttempt);
    expect(route('get', '/my').handlers.at(-1)).toBe(controller.getMyAttempts);
    expect(route('get', '/summary').handlers.at(-1)).toBe(controller.getAttemptsSummary);
    expect(route('get', '/').handlers.at(-1)).toBe(controller.getExamAttempts);
    expect(route('get', '/:id').handlers.at(-1)).toBe(controller.getAttempt);
    expect(route('put', '/:id/answers').handlers.at(-1)).toBe(controller.syncAnswers);
    expect(route('post', '/:id/file').handlers.at(-1)).toBe(controller.uploadAnswerFile);
    expect(route('post', '/:id/submit').handlers.at(-1)).toBe(controller.submitAttempt);
    expect(route('put', '/:id/grade').handlers.at(-1)).toBe(controller.gradeAttempt);
    expect(route('post', '/:id/ai-review').handlers.at(-1)).toBe(controller.aiReviewAttempt);
    expect(route('put', '/:id/cheating-disclosure').handlers.at(-1)).toBe(controller.setCheatingDisclosure);
  });

  it('matches /my and /summary before /:id', () => {
    const paths = routes.filter((candidate: any) => candidate.method === 'get').map((candidate: any) => candidate.path);
    expect(paths.indexOf('/my')).toBeLessThan(paths.indexOf('/:id'));
    expect(paths.indexOf('/summary')).toBeLessThan(paths.indexOf('/:id'));
  });

  it('keeps the student endpoints for students', () => {
    for (const [method, path] of [['post', '/'], ['get', '/my'], ['put', '/:id/answers'], ['post', '/:id/file'], ['post', '/:id/submit']]) {
      expect(guard(method, path, 'student').allowed).toBe(true);
      expect(guard(method, path, 'professor')).toEqual({ allowed: false, status: 403 });
      expect(guard(method, path, 'examiner')).toEqual({ allowed: false, status: 403 });
    }
  });

  it('lets only professors see the attempts summary', () => {
    expect(guard('get', '/summary', 'professor').allowed).toBe(true);
    expect(guard('get', '/summary', 'examiner')).toEqual({ allowed: false, status: 403 });
    expect(guard('get', '/summary', 'student')).toEqual({ allowed: false, status: 403 });
  });

  it('lets professors and examiners list the attempts of an exam', () => {
    expect(guard('get', '/', 'professor').allowed).toBe(true);
    expect(guard('get', '/', 'examiner').allowed).toBe(true);
    expect(guard('get', '/', 'student')).toEqual({ allowed: false, status: 403 });
  });

  it('lets only professors grade', () => {
    expect(guard('put', '/:id/grade', 'professor').allowed).toBe(true);
    expect(guard('put', '/:id/grade', 'examiner')).toEqual({ allowed: false, status: 403 });
    expect(guard('put', '/:id/grade', 'student')).toEqual({ allowed: false, status: 403 });
  });

  it('opens one attempt to all three roles, the service decides what they see', () => {
    for (const role of ['student', 'professor', 'examiner']) {
      expect(guard('get', '/:id', role).allowed).toBe(true);
    }
  });

  it('lets only professors ask for an AI review', () => {
    expect(guard('post', '/:id/ai-review', 'professor').allowed).toBe(true);
    expect(guard('post', '/:id/ai-review', 'examiner')).toEqual({ allowed: false, status: 403 });
    expect(guard('post', '/:id/ai-review', 'student')).toEqual({ allowed: false, status: 403 });
  });
});
