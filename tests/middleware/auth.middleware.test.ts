import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const { from, results } = vi.hoisted(() => {
  const results: { data: unknown; error: unknown }[] = [];
  const take = () => results.shift() ?? { data: null, error: null };
  const builder: any = { maybeSingle: () => Promise.resolve(take()) };
  for (const method of ['select', 'eq']) builder[method] = () => builder;
  const from = vi.fn(() => builder);
  return { from, results };
});

vi.mock('../../lib/db.js', () => ({ database: { from } }));

import { protectRoute } from '../../middleware/auth.middleware.js';

const makeRes = () => {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
};

const SECRET = 'auth-middleware-test-secret';
const sign = (payload: object) => jwt.sign(payload, SECRET, { expiresIn: '1h' });
const makeReq = (token?: string) => ({ cookies: token ? { jwt: token } : {} }) as unknown as Request;
const makeBearerReq = (token: string) => ({ cookies: {}, headers: { authorization: `Bearer ${token}` } }) as unknown as Request;
const ok = (data: unknown) => ({ data, error: null });

let next: NextFunction;

beforeEach(() => {
  next = vi.fn();
  results.length = 0;
  from.mockClear();
  vi.stubEnv('JWT_SECRET', SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('protectRoute', () => {
  it('rejects a request with no cookie', async () => {
    const res = makeRes();
    await protectRoute(makeReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects an invalid token', async () => {
    const res = makeRes();
    await protectRoute(makeReq('not-a-real-token'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('lets a token through when its session is live and not revoked', async () => {
    const token = sign({ id: 1, role: 'student' });
    const res = makeRes();
    results.push(ok({ revoked: false }));

    const req = makeReq(token);
    await protectRoute(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ id: 1, role: 'student' });
    expect(from).toHaveBeenCalledWith('tokens');
  });

  it('rejects a token whose session was revoked by logout', async () => {
    const token = sign({ id: 1, role: 'student' });
    const res = makeRes();
    results.push(ok({ revoked: true }));

    await protectRoute(makeReq(token), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Not authorized, session has been logged out' });
  });

  it('rejects a token whose session row no longer exists', async () => {
    const token = sign({ id: 1, role: 'student' });
    const res = makeRes();
    results.push(ok(null));

    await protectRoute(makeReq(token), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("lets a bearer token through for a client with no cookie jar (the desktop app)", async () => {
    const token = sign({ id: 1, role: 'student' });
    const res = makeRes();
    results.push(ok({ revoked: false }));

    const req = makeBearerReq(token);
    await protectRoute(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ id: 1, role: 'student' });
  });

  it('rejects a revoked session the same way whether it arrives as a bearer token or a cookie', async () => {
    const token = sign({ id: 1, role: 'student' });
    const res = makeRes();
    results.push(ok({ revoked: true }));

    await protectRoute(makeBearerReq(token), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('falls back to the cookie when the Authorization header is present but not a bearer token', async () => {
    const token = sign({ id: 1, role: 'student' });
    const res = makeRes();
    results.push(ok({ revoked: false }));

    const req = { cookies: { jwt: token }, headers: { authorization: 'Basic somebase64' } } as unknown as Request;
    await protectRoute(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ id: 1 });
  });
});
