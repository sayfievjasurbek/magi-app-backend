import { describe, it, expect } from 'vitest';
import { HttpError } from '../../lib/errors.js';

describe('HttpError', () => {
  it('keeps the status and message', () => {
    const error = new HttpError(404, 'Class not found');
    expect(error.status).toBe(404);
    expect(error.message).toBe('Class not found');
  });

  it('is a real Error', () => {
    const error = new HttpError(409, 'Already enrolled');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.stack).toBeDefined();
  });

  it('is catchable as HttpError after being thrown', () => {
    expect(() => {
      throw new HttpError(400, 'Bad request');
    }).toThrow(HttpError);
  });
});
