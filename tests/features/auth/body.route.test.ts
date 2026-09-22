import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { type Server } from 'node:http';

// the real auth router and controllers over http; only what they reach out to is stubbed
vi.mock('../../../lib/db.js', () => ({ database: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('../../../email/email.js', () => ({
  sendVerificationEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendResetSuccessEmail: vi.fn(),
}));

import authRoutes from '../../../features/auth/auth.route.js';
import { defaultBody } from '../../../middleware/body.middleware.js';

const listen = async (app: express.Express) => {
  const server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  const { port } = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${port}` };
};

// no content-type and no body at all: express.json leaves req.body undefined
const post = (url: string, path: string) => fetch(`${url}${path}`, { method: 'POST' });

const bodyless = [
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/verify-email',
  '/api/auth/reset-password/sometoken',
];

let guarded: { server: Server; url: string };
let bare: { server: Server; url: string };

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(defaultBody);
  app.use('/api/auth', authRoutes);
  guarded = await listen(app);

  // the same router without the middleware, to show what it is there for
  const raw = express();
  raw.use(express.json({ limit: '10mb' }));
  raw.use('/api/auth', authRoutes);
  bare = await listen(raw);
});

afterAll(async () => {
  await new Promise((resolve) => guarded.server.close(resolve));
  await new Promise((resolve) => bare.server.close(resolve));
});

describe('a request without a body', () => {
  it('answers 400 on every auth endpoint that reads one', async () => {
    for (const path of bodyless) {
      const response = await post(guarded.url, path);
      const body = await response.json() as { success: boolean };

      expect([path, response.status]).toEqual([path, 400]);
      expect(body.success).toBe(false);
    }
  });

  it('is a 500 without the middleware: express 5 leaves req.body undefined', async () => {
    const response = await post(bare.url, '/api/auth/login');

    expect(response.status).toBe(500);
  });

  it('still reads the body that was sent', async () => {
    const response = await fetch(`${guarded.url}/api/auth/reset-password/sometoken`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword: 'short' }),
    });

    expect(response.status).toBe(400);
    expect((await response.json() as { message: string }).message).toBe('Password must be at least 6 characters long');
  });
});
