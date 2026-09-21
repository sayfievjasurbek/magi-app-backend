import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../../middleware/role.middleware.js';

const makeRes = () => {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
};

let next: NextFunction;

beforeEach(() => {
  next = vi.fn();
});

describe('requireRole', () => {
  it('calls next for the allowed role', () => {
    const res = makeRes();
    requireRole('professor')({ user: { role: 'professor' } } as Request, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects the wrong role with 403', () => {
    const res = makeRes();
    requireRole('professor')({ user: { role: 'student' } } as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Only professors can access this resource' });
  });

  it('rejects a request with no user', () => {
    const res = makeRes();
    requireRole('student')({} as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Only students can access this resource' });
  });

  it('rejects a user without a role', () => {
    const res = makeRes();
    requireRole('student')({ user: {} } as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('builds one middleware per role', () => {
    const res = makeRes();
    requireRole('student')({ user: { role: 'student' } } as Request, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('lets any of several roles through', () => {
    const res = makeRes();
    requireRole('professor', 'examiner')({ user: { role: 'examiner' } } as Request, res, next);
    requireRole('professor', 'examiner')({ user: { role: 'professor' } } as Request, res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('names every allowed role when it rejects', () => {
    const res = makeRes();
    requireRole('professor', 'examiner')({ user: { role: 'student' } } as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Only professors or examiners can access this resource' });
  });

  it('rejects everyone when no role is allowed', () => {
    const res = makeRes();
    requireRole()({ user: { role: 'professor' } } as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
