import { describe, it, expect } from 'vitest';
import { envError } from '../../lib/env.js';

const env = (overrides: Record<string, string | undefined> = {}) => ({
  DATABASE_URL: 'https://project.supabase.co',
  DATABASE_KEY: 'service-role-key',
  JWT_SECRET: 'x'.repeat(32),
  EMAIL_TOKEN: 'mail-token',
  SENDER_EMAIL: 'no-reply@magi.test',
  CLIENT_URL: 'https://magi.test',
  ...overrides,
});

describe('envError', () => {
  it('accepts a complete environment', () => {
    expect(envError(env({ NODE_ENV: 'production' }))).toBeNull();
    expect(envError(env({ NODE_ENV: 'development' }))).toBeNull();
    expect(envError(env())).toBeNull();
  });

  it('does not need PORT', () => {
    expect(envError(env({ PORT: undefined }))).toBeNull();
  });

  it('lists every missing variable in one message', () => {
    const message = envError(env({ DATABASE_URL: undefined, JWT_SECRET: undefined, CLIENT_URL: undefined }))!;
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('CLIENT_URL');
    expect(message).not.toContain('DATABASE_KEY');
    expect(message).not.toContain('EMAIL_TOKEN');
    expect(message).not.toContain('SENDER_EMAIL');
    expect(message).not.toContain('\n');
  });

  it('reports all six when nothing is set', () => {
    const message = envError({})!;
    for (const name of ['DATABASE_URL', 'DATABASE_KEY', 'JWT_SECRET', 'EMAIL_TOKEN', 'SENDER_EMAIL', 'CLIENT_URL']) {
      expect(message).toContain(name);
    };
  });

  it('treats an empty or blank value as missing', () => {
    const message = envError(env({ EMAIL_TOKEN: '', SENDER_EMAIL: '   ' }))!;
    expect(message).toContain('EMAIL_TOKEN');
    expect(message).toContain('SENDER_EMAIL');
  });

  it('rejects the placeholder JWT secret in production', () => {
    const message = envError(env({ NODE_ENV: 'production', JWT_SECRET: 'the_jwt_secret_is_empty_for_now' }))!;
    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('placeholder');
  });

  it('accepts the placeholder JWT secret in development', () => {
    expect(envError(env({ NODE_ENV: 'development', JWT_SECRET: 'the_jwt_secret_is_empty_for_now' }))).toBeNull();
    expect(envError(env({ JWT_SECRET: 'the_jwt_secret_is_empty_for_now' }))).toBeNull();
  });

  it('rejects a JWT secret shorter than 32 characters in production', () => {
    const message = envError(env({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(31) }))!;
    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('32');
  });

  it('accepts a JWT secret of exactly 32 characters in production', () => {
    expect(envError(env({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) }))).toBeNull();
  });

  it('accepts a short JWT secret in development', () => {
    expect(envError(env({ NODE_ENV: 'development', JWT_SECRET: 'short' }))).toBeNull();
  });

  it('reports a missing variable and a weak secret together', () => {
    const message = envError(env({ NODE_ENV: 'production', DATABASE_KEY: undefined, JWT_SECRET: 'short' }))!;
    expect(message).toContain('DATABASE_KEY');
    expect(message).toContain('shorter than 32');
  });

  it('only reports a missing secret as missing', () => {
    const message = envError(env({ NODE_ENV: 'production', JWT_SECRET: undefined }))!;
    expect(message).toContain('missing JWT_SECRET');
    expect(message).not.toContain('placeholder');
    expect(message).not.toContain('shorter');
  });

  it('never puts a value in the message', () => {
    const message = envError(env({ NODE_ENV: 'production', JWT_SECRET: 'super-secret-value', DATABASE_KEY: undefined }))!;
    expect(message).not.toContain('super-secret-value');
    expect(message).not.toContain('supabase.co');
  });

  it('reads process.env when no environment is passed', () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(envError()).toContain('DATABASE_URL');
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    };
  });
});
