import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../lib/db.js', () => ({ database: { from: vi.fn() } }));
vi.mock('../../../middleware/auth.middleware.js', () => ({ protectRoute: vi.fn() }));
// requireRole is covered by its own test, here it only has to say which roles a route was wired with
vi.mock('../../../middleware/role.middleware.js', () => ({
  requireRole: (...roles: string[]) => Object.assign(() => {}, { roles }),
}));

import router from '../../../features/monitoring/monitoring.route.js';
import { protectRoute } from '../../../middleware/auth.middleware.js';

const endpoints = (router as any).stack
  .filter((layer: any) => layer.route)
  .map((layer: any) => [
    Object.keys(layer.route.methods)[0].toUpperCase(),
    layer.route.path,
    layer.route.stack[0].handle.roles ?? null,
  ]);

describe('monitoring routes', () => {
  it('protects every route with the token middleware', () => {
    expect((router as any).stack[0].handle).toBe(protectRoute);
  });

  it('wires each endpoint to the roles that may use it', () => {
    expect(endpoints).toEqual([
      ['POST', '/attempts/:attemptId/:kind', ['student']],
      ['GET', '/attempts/:attemptId/:kind', ['professor', 'examiner']],
      ['DELETE', '/:kind/:mediaId', ['professor']],
    ]);
  });

  it('never lets a student read media back', () => {
    for (const [method, , roles] of endpoints) {
      if (method !== 'POST') expect(roles).not.toContain('student');
    }
  });
});
