import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { type Response } from 'express';
import { parseId, activeOnly, softDelete, handleControllerError } from '../../lib/utils.js';
import { HttpError } from '../../lib/errors.js';

describe('parseId', () => {
  it('accepts a positive integer', () => {
    expect(parseId(1)).toBe(1);
    expect(parseId(4096)).toBe(4096);
    expect(parseId(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('accepts a digit-only string', () => {
    expect(parseId('1')).toBe(1);
    expect(parseId('007')).toBe(7);
  });

  it('rejects zero and negative ids', () => {
    expect(parseId(0)).toBeNull();
    expect(parseId(-1)).toBeNull();
    expect(parseId('0')).toBeNull();
    expect(parseId('-3')).toBeNull();
  });

  it('rejects anything that is not a whole number', () => {
    expect(parseId(1.5)).toBeNull();
    expect(parseId('1.5')).toBeNull();
    expect(parseId(NaN)).toBeNull();
    expect(parseId(Infinity)).toBeNull();
  });

  it('rejects ids past the safe integer range', () => {
    expect(parseId('9007199254740993')).toBeNull();
    expect(parseId(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
  });

  it('rejects malformed strings and other types', () => {
    expect(parseId('')).toBeNull();
    expect(parseId(' 1')).toBeNull();
    expect(parseId('1a')).toBeNull();
    expect(parseId('0x10')).toBeNull();
    expect(parseId('1e3')).toBeNull();
    expect(parseId(null)).toBeNull();
    expect(parseId(undefined)).toBeNull();
    expect(parseId(['1'])).toBeNull();
    expect(parseId({})).toBeNull();
  });
});

describe('activeOnly', () => {
  it('filters out the soft deleted rows and returns the query', () => {
    const query = { is: vi.fn(() => query) };
    expect(activeOnly(query)).toBe(query);
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
  });
});

describe('softDelete', () => {
  it('stamps deleted_at and keeps the reason', () => {
    const patch = softDelete('duplicate exam');
    expect(patch.reason).toBe('duplicate exam');
    expect(Number.isNaN(Date.parse(patch.deleted_at))).toBe(false);
  });

  it('defaults the reason to null', () => {
    expect(softDelete().reason).toBeNull();
  });
});

describe('handleControllerError', () => {
  let res: Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const fake = {
      status: vi.fn(() => fake),
      json: vi.fn(() => fake),
    };
    res = fake as unknown as typeof res;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the status of an HttpError', () => {
    handleControllerError(res, new HttpError(404, 'Assignment not found'), 'assignment controller');

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Assignment not found' });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('turns a plain Error into a 500 with its message', () => {
    handleControllerError(res, new Error('column does not exist'), 'class controller');

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'column does not exist' });
    expect(consoleError).toHaveBeenCalledWith('Error in class controller:', 'column does not exist');
  });

  it('hides anything that is not an Error behind a generic 500', () => {
    handleControllerError(res, 'boom', 'class controller');

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'An unknown error occurred' });
    expect(consoleError).toHaveBeenCalledWith('Unknown error in class controller:', 'boom');
  });

  it('handles null and undefined', () => {
    handleControllerError(res, null, 'ctx');
    handleControllerError(res, undefined, 'ctx');

    expect(res.status).toHaveBeenNthCalledWith(1, 500);
    expect(res.status).toHaveBeenNthCalledWith(2, 500);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: 'An unknown error occurred' });
  });

  it('falls back to a default context', () => {
    handleControllerError(res, new Error('nope'));
    expect(consoleError).toHaveBeenCalledWith('Error in controller:', 'nope');
  });

  it('returns what res.json returns', () => {
    expect(handleControllerError(res, new HttpError(400, 'bad'))).toBe(res);
  });
});

// JWT_SECRET is read once at import time, so each case re-imports the module
const loadUtils = async (secret?: string) => {
  vi.resetModules();
  vi.stubEnv('JWT_SECRET', secret);
  return import('../../lib/utils.js');
};

describe('generateToken', () => {
  const SECRET = 'test-secret';

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('signs a token carrying the user payload for 7 days', async () => {
    const { generateToken } = await loadUtils(SECRET);
    const res = { cookie: vi.fn() } as unknown as Response;

    const token = await generateToken(1, 'Ada', 'Lovelace', 'ada@magi.edu', 'professor', res);
    const payload = jwt.verify(token, SECRET) as Record<string, unknown>;

    expect(payload).toMatchObject({
      id: 1,
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@magi.edu',
      role: 'professor',
    });
    expect((payload.exp as number) - (payload.iat as number)).toBe(7 * 24 * 60 * 60);
  });

  it('keeps a null last name in the payload', async () => {
    const { generateToken } = await loadUtils(SECRET);
    const res = { cookie: vi.fn() } as unknown as Response;

    const token = await generateToken(2, 'Ada', null, 'ada@magi.edu', 'student', res);
    const payload = jwt.verify(token, SECRET) as Record<string, unknown>;

    expect(payload.last_name).toBeNull();
  });

  it('does not verify with a different secret', async () => {
    const { generateToken } = await loadUtils(SECRET);
    const res = { cookie: vi.fn() } as unknown as Response;

    const token = await generateToken(1, 'Ada', null, 'ada@magi.edu', 'student', res);
    expect(() => jwt.verify(token, 'other-secret')).toThrow();
  });

  it('sets a lax, insecure cookie outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { generateToken } = await loadUtils(SECRET);
    const res = { cookie: vi.fn() } as unknown as Response & { cookie: ReturnType<typeof vi.fn> };

    const token = await generateToken(1, 'Ada', null, 'ada@magi.edu', 'student', res);

    expect(res.cookie).toHaveBeenCalledWith('jwt', token, {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
    });
  });

  it('sets a strict, secure cookie in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { generateToken } = await loadUtils(SECRET);
    const res = { cookie: vi.fn() } as unknown as Response & { cookie: ReturnType<typeof vi.fn> };

    const token = await generateToken(1, 'Ada', null, 'ada@magi.edu', 'student', res);

    expect(res.cookie).toHaveBeenCalledWith('jwt', token, {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'strict',
      secure: true,
      path: '/',
    });
  });

  it('throws and sets no cookie when JWT_SECRET is missing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { generateToken } = await loadUtils(undefined);
    const res = { cookie: vi.fn() } as unknown as Response & { cookie: ReturnType<typeof vi.fn> };

    await expect(generateToken(1, 'Ada', null, 'ada@magi.edu', 'student', res)).rejects.toThrow(
      'JWT_SECRET is not defined'
    );
    expect(res.cookie).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });
});
