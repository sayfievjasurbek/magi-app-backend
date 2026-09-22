import { describe, it, expect, vi } from 'vitest';
import { type Request, type Response, type NextFunction } from 'express';
import { type Role } from '../../../lib/types.js';

vi.mock('../../../lib/db.js', () => ({ database: { from: vi.fn() } }));

import router from '../../../features/questions/question.route.js';

type Layer = {
  name: string;
  route?: { path: string; methods: Record<string, boolean>; stack: { name: string; handle: Function }[] };
};

const ROLES: Role[] = ['professor', 'student', 'examiner'];
const layers = (router as unknown as { stack: Layer[] }).stack;

const routes = layers
  .filter((layer) => layer.route)
  .map((layer) => ({
    key: `${Object.keys(layer.route!.methods)[0].toUpperCase()} ${layer.route!.path}`,
    guard: layer.route!.stack[0].handle,
    controller: layer.route!.stack[layer.route!.stack.length - 1].name,
  }));

const passes = (guard: Function, role: Role) => {
  const next = vi.fn();
  const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
  guard({ user: { role } } as Request, res as unknown as Response, next as NextFunction);
  return next.mock.calls.length === 1;
};

describe('question routes', () => {
  it('checks the token before every route', () => {
    expect(layers[0].name).toBe('protectRoute');
    expect(layers[0].route).toBeUndefined();
  });

  it('wires every endpoint to its controller', () => {
    expect(routes.map((route) => `${route.key} ${route.controller}`)).toEqual([
      'POST / createQuestion',
      'GET / listQuestions',
      'GET /:id getQuestion',
      'PATCH /:id updateQuestion',
      'DELETE /:id deleteQuestion',
    ]);
  });

  it('keeps students and examiners out of the whole domain', () => {
    const byRoute = Object.fromEntries(routes.map((route) => [route.key, ROLES.filter((role) => passes(route.guard, role))]));

    expect(byRoute).toEqual({
      'POST /': ['professor'],
      'GET /': ['professor'],
      'GET /:id': ['professor'],
      'PATCH /:id': ['professor'],
      'DELETE /:id': ['professor'],
    });
  });
});
