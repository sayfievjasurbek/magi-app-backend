import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { type Request, type Response, type NextFunction } from 'express';
import { sameOrigin } from '../../middleware/origin.middleware.js';

const makeRes = () => {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
};

const makeReq = (method: string, origin?: string) => ({
  method,
  headers: origin ? { origin } : {},
  protocol: 'https',
  get: () => 'api.magi.test',
}) as unknown as Request;

let next: NextFunction;

beforeEach(() => {
  next = vi.fn();
  vi.stubEnv('CLIENT_URL', 'https://app.magi.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sameOrigin', () => {
  it('lets requests without an Origin header through', () => {
    sameOrigin(makeReq('POST'), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('lets writes from the frontend origin through', () => {
    sameOrigin(makeReq('POST', 'https://app.magi.test'), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('lets writes from the API itself through (swagger ui)', () => {
    sameOrigin(makeReq('PUT', 'https://api.magi.test'), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('lets reads from any origin through', () => {
    sameOrigin(makeReq('GET', 'https://evil.test'), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects a %s from another origin with 403', (method) => {
    const res = makeRes();
    sameOrigin(makeReq(method, 'https://evil.test'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Origin not allowed' });
  });
});
