import { describe, it, expect, vi } from 'vitest';
import { type Request, type Response, type NextFunction } from 'express';
import { type Role } from '../../../lib/types.js';

vi.mock('../../../lib/db.js', () => ({ database: { from: vi.fn() } }));

import router from '../../../features/modules/module.route.js';

type Layer = {
  name: string;
  route?: { path: string; methods: Record<string, boolean>; stack: { name: string; handle: Function }[] };
};

const ROLES: Role[] = ['professor', 'student', 'examiner'];
const layers = (router as unknown as { stack: Layer[] }).stack;

// each route is wired as requireRole(...) then the controller
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

describe('module routes', () => {
  it('checks the token before every route', () => {
    expect(layers[0].name).toBe('protectRoute');
    expect(layers[0].route).toBeUndefined();
  });

  it('wires every endpoint to its controller', () => {
    expect(routes.map((route) => `${route.key} ${route.controller}`)).toEqual([
      'POST / createModule',
      'POST /:id/professors addProfessor',
      'POST /:id/students addStudent',
      'GET / listModules',
      'GET /students/:studentId getStudentModules',
      'GET /:id getModule',
      'GET /:id/roster getRoster',
      'GET /:id/rating getModuleRating',
      'PATCH /:id updateModule',
      'DELETE /:id deleteModule',
      'DELETE /:id/professors/:professorId removeProfessor',
      'DELETE /:id/students/:studentId removeStudent',
    ]);
  });

  it('lets only the allowed roles through, examiners nowhere', () => {
    const byRoute = Object.fromEntries(routes.map((route) => [route.key, ROLES.filter((role) => passes(route.guard, role))]));

    expect(byRoute).toEqual({
      'POST /': ['professor'],
      'POST /:id/professors': ['professor'],
      'POST /:id/students': ['professor'],
      'GET /': ['professor', 'student'],
      'GET /students/:studentId': ['professor'],
      'GET /:id': ['professor', 'student'],
      'GET /:id/roster': ['professor'],
      'GET /:id/rating': ['professor', 'student'],
      'PATCH /:id': ['professor'],
      'DELETE /:id': ['professor'],
      'DELETE /:id/professors/:professorId': ['professor'],
      'DELETE /:id/students/:studentId': ['professor'],
    });
  });
});
